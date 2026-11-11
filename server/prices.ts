// Live H100 rental prices from two public sources, no keys. Owner: the backend conversation.
// Listed prices, not trades. The reference price is the median of the sources.
import type { PriceFeed, PriceSource } from '../src/lib/types';
import { readJson, writeJson } from './store';

export const RUNPOD_URL = 'https://api.runpod.io/graphql';
export const RUNPOD_QUERY = 'query { gpuTypes { id displayName lowestPrice(input:{gpuCount:1}) { uninterruptablePrice } } }';
export const RUNPOD_GPU_ID = 'NVIDIA H100 80GB HBM3';
export const AKASH_URL = 'https://console-api.akash.network/v1/gpu-prices';

const USER_AGENT = 'h100-price-feed/0.1';
const TIMEOUT_MS = 10_000;
const REFRESH_MS = 60_000;
const HISTORY_MS = 6 * 3_600_000;
const MAX_TICKS = 2_880; // two days at one tick a minute; the page shows six hours

export interface Quote { price: number; detail: string }
export interface Tick { t: string; price: number; sources: Record<string, number> }

type Json = Record<string, any> | null | undefined;

/** RunPod: the lowest on-demand price of the H100 SXM. */
export function parseRunpod(body: unknown): Quote | null {
  const types = (body as Json)?.data?.gpuTypes;
  if (!Array.isArray(types)) return null;
  const hit = types.find((t) => t?.id === RUNPOD_GPU_ID);
  const price = hit?.lowestPrice?.uninterruptablePrice;
  if (typeof price !== 'number' || !(price > 0)) return null;
  return { price, detail: `lowest on-demand price, ${typeof hit.displayName === 'string' ? hit.displayName : 'H100 SXM'}` };
}

/** Akash: the weighted average price of the H100 SXM5, with how many are listed and free. */
export function parseAkash(body: unknown): Quote | null {
  const models = (body as Json)?.models;
  if (!Array.isArray(models)) return null;
  const hit = models.find((m) => String(m?.model).toLowerCase() === 'h100' && String(m?.interface).toUpperCase() === 'SXM5');
  const price = hit?.price?.weightedAverage;
  if (typeof price !== 'number' || !(price > 0)) return null;
  const total = hit?.availability?.total, free = hit?.availability?.available;
  const counts = typeof total === 'number' && typeof free === 'number' ? `, ${total} listed, ${free} available` : '';
  return { price, detail: `weighted average, H100 SXM5${counts}` };
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, z) => a - z), mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface SourceDef { name: string; url: string; get: (fetchImpl: FetchLike) => Promise<Quote | null> }

async function getJson(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const SOURCES: SourceDef[] = [
  {
    name: 'RunPod', url: 'https://www.runpod.io/pricing',
    get: async (f) => parseRunpod(await getJson(f, RUNPOD_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: RUNPOD_QUERY }) })),
  },
  { name: 'Akash', url: 'https://akash.network/pricing/gpus/', get: async (f) => parseAkash(await getJson(f, AKASH_URL)) },
];

/** What the server answers before anything was ever fetched: the two prices as read on 2026-11-11. */
export const SAMPLE_FEED: PriceFeed = {
  asOf: '2026-11-11T10:55:00.000Z',
  reference: { model: 'H100', price: 2.71, unit: '$/GPU-hour', method: 'median of sources' },
  sources: [
    { name: 'RunPod', price: 2.69, detail: 'lowest on-demand price, H100 SXM', asOf: '2026-11-11T10:55:00.000Z', url: 'https://www.runpod.io/pricing' },
    { name: 'Akash', price: 2.73, detail: 'weighted average, H100 SXM5, 56 listed, 12 available', asOf: '2026-11-11T10:55:00.000Z', url: 'https://akash.network/pricing/gpus/' },
  ],
  history: [],
  live: false,
};

export interface PriceFeedOptions {
  fetchImpl?: FetchLike;
  file?: string | null;      // where ticks are kept between restarts; null keeps them in memory only
  now?: () => Date;
  sources?: SourceDef[];
}

export function createPriceFeed(opts: PriceFeedOptions = {}) {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? (() => new Date());
  const sources = opts.sources ?? SOURCES;
  const file = opts.file ?? null;
  const lastGood = new Map<string, PriceSource>();
  let ticks: Tick[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Read the ticks saved by an earlier run. A missing or broken file means: start empty. */
  async function load(): Promise<void> {
    const saved = readJson<unknown>(file, []);
    if (!Array.isArray(saved)) return;
    const good = saved.filter((x): x is Tick => typeof x?.t === 'string' && typeof x?.price === 'number' && x.price > 0 && !Number.isNaN(Date.parse(x.t)));
    ticks = [...good.map((x) => ({ t: x.t, price: x.price, sources: x.sources ?? {} })), ...ticks].sort((a, z) => Date.parse(a.t) - Date.parse(z.t)).slice(-MAX_TICKS);
  }

  /** Ask every source once. A source that fails keeps its last good value and its time. Returns how many answered. */
  async function refresh(): Promise<number> {
    const t = now().toISOString();
    const results = await Promise.all(sources.map(async (s) => { try { return await s.get(fetchImpl); } catch { return null; } }));
    let answered = 0;
    results.forEach((q, i) => {
      if (!q) return;
      answered++;
      lastGood.set(sources[i].name, { name: sources[i].name, price: q.price, detail: q.detail, asOf: t, url: sources[i].url });
    });
    if (answered > 0) {
      const current = sources.map((s) => lastGood.get(s.name)).filter((x): x is PriceSource => !!x);
      ticks.push({ t, price: reference(current), sources: Object.fromEntries(current.map((s) => [s.name, s.price])) });
      if (ticks.length > MAX_TICKS) ticks = ticks.slice(-MAX_TICKS);
      writeJson(file, ticks); // a disk that cannot be written does not stop the feed
    }
    return answered;
  }

  const reference = (current: PriceSource[]) => Math.round(median(current.map((s) => s.price)) * 10_000) / 10_000;

  /** The feed as the page reads it. Before the first answer from any source it is the stored sample, marked not live. */
  function feed(): PriceFeed {
    const current = sources.map((s) => lastGood.get(s.name)).filter((x): x is PriceSource => !!x);
    if (current.length === 0) return SAMPLE_FEED;
    const since = now().getTime() - HISTORY_MS;
    return {
      asOf: current.map((s) => s.asOf).sort().at(-1)!,
      reference: { model: 'H100', price: reference(current), unit: '$/GPU-hour', method: current.length > 1 ? 'median of sources' : 'one source' },
      sources: current,
      history: ticks.filter((x) => Date.parse(x.t) >= since).map((x) => ({ t: x.t, price: x.price })),
      live: true,
    };
  }

  /** Read saved ticks, fetch now, then every minute. */
  async function start(): Promise<void> {
    await load();
    void refresh();
    if (!timer) { timer = setInterval(() => { void refresh(); }, REFRESH_MS); timer.unref?.(); }
  }
  function stop(): void { if (timer) clearInterval(timer); timer = null; }

  return { load, refresh, feed, start, stop, ticks: () => ticks };
}

export type PriceFeedService = ReturnType<typeof createPriceFeed>;
