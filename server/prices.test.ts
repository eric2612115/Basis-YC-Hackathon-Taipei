import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AKASH_URL, createPriceFeed, median, parseAkash, parseRunpod, RUNPOD_QUERY, RUNPOD_URL, SAMPLE_FEED } from './prices';

// Saved answers of the two public price APIs, fetched 2026-11-11 about 18:55 Taipei.
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8'));
const runpod = fixture('runpod.sample.json'), akash = fixture('akash.sample.json');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A stand-in for the network: answers each source from a table that a test can change. */
function fakeNet(state: { runpod: unknown | 'fail'; akash: unknown | 'fail' }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url === RUNPOD_URL ? state.runpod : url === AKASH_URL ? state.akash : 'fail';
    if (body === 'fail') throw new Error('network down');
    return json(body);
  };
  return { fetchImpl, calls };
}
const clock = (start: string) => { let t = Date.parse(start); return { now: () => new Date(t), advance: (ms: number) => { t += ms; } }; };

describe('reading the saved answers', () => {
  it('RunPod: the lowest on-demand price of the H100 SXM', () => {
    expect(parseRunpod(runpod)).toEqual({ price: 2.69, detail: 'lowest on-demand price, H100 SXM' });
  });
  it('Akash: the weighted average of the H100 SXM5, with how many are listed and available', () => {
    expect(parseAkash(akash)).toEqual({ price: 2.73, detail: 'weighted average, H100 SXM5, 56 listed, 12 available' });
  });
  it('gives nothing when the answer is not what we expect', () => {
    for (const bad of [null, {}, { data: {} }, { data: { gpuTypes: [] } }, { data: { gpuTypes: [{ id: 'NVIDIA H100 80GB HBM3', lowestPrice: { uninterruptablePrice: null } }] } }, { errors: [{ message: 'rate limited' }] }]) expect(parseRunpod(bad)).toBeNull();
    for (const bad of [null, {}, { models: 'none' }, { models: [{ model: 'h100', interface: 'PCIe', price: { weightedAverage: 2.5 } }] }, { models: [{ model: 'h100', interface: 'SXM5', price: { weightedAverage: 0 } }] }]) expect(parseAkash(bad)).toBeNull();
  });
  it('median', () => {
    expect(median([2.69, 2.73])).toBeCloseTo(2.71, 10); expect(median([3, 1, 2])).toBe(2); expect(median([5])).toBe(5); expect(median([])).toBeNaN();
  });
});

describe('the price feed', () => {
  it('answers with the stored sample, marked not live, before anything was fetched', () => {
    const feed = createPriceFeed({ fetchImpl: fakeNet({ runpod: 'fail', akash: 'fail' }).fetchImpl });
    expect(feed.feed()).toEqual(SAMPLE_FEED);
    expect(feed.feed().live).toBe(false);
    expect(SAMPLE_FEED.reference.price).toBe(2.71);
  });
  it('after a fetch it is live: two sources, the median as the reference, one tick of history', async () => {
    const net = fakeNet({ runpod, akash }), time = clock('2026-11-11T11:00:00.000Z');
    const feed = createPriceFeed({ fetchImpl: net.fetchImpl, now: time.now });
    expect(await feed.refresh()).toBe(2);
    const f = feed.feed();
    expect(f.live).toBe(true);
    expect(f.reference).toEqual({ model: 'H100', price: 2.71, unit: '$/GPU-hour', method: 'median of sources' });
    expect(f.sources.map((s) => [s.name, s.price, s.asOf])).toEqual([['RunPod', 2.69, '2026-11-11T11:00:00.000Z'], ['Akash', 2.73, '2026-11-11T11:00:00.000Z']]);
    expect(f.sources.every((s) => s.url.startsWith('https://'))).toBe(true);
    expect(f.history).toEqual([{ t: '2026-11-11T11:00:00.000Z', price: 2.71 }]);
    expect(f.asOf).toBe('2026-11-11T11:00:00.000Z');
  });
  it('asks RunPod with the query from the contract and sends a User-Agent to both', async () => {
    const net = fakeNet({ runpod, akash });
    await createPriceFeed({ fetchImpl: net.fetchImpl }).refresh();
    const rp = net.calls.find((c) => c.url === RUNPOD_URL)!, ak = net.calls.find((c) => c.url === AKASH_URL)!;
    expect(rp.init?.method).toBe('POST'); expect(JSON.parse(String(rp.init?.body))).toEqual({ query: RUNPOD_QUERY });
    for (const c of [rp, ak]) { expect((c.init?.headers as Record<string, string>)['user-agent']).toMatch(/\S/); expect(c.init?.signal).toBeInstanceOf(AbortSignal); }
  });
  it('a source that fails keeps its last good value and its time', async () => {
    const state: { runpod: unknown; akash: unknown } = { runpod, akash }, time = clock('2026-11-11T11:00:00.000Z');
    const feed = createPriceFeed({ fetchImpl: fakeNet(state).fetchImpl, now: time.now });
    await feed.refresh();
    time.advance(60_000);
    state.runpod = 'fail';
    state.akash = { models: [{ model: 'h100', interface: 'SXM5', availability: { total: 56, available: 9 }, price: { weightedAverage: 2.81 } }] };
    expect(await feed.refresh()).toBe(1);
    const f = feed.feed();
    expect(f.sources.map((s) => [s.name, s.price, s.asOf])).toEqual([['RunPod', 2.69, '2026-11-11T11:00:00.000Z'], ['Akash', 2.81, '2026-11-11T11:01:00.000Z']]);
    expect(f.reference.price).toBe(2.75);
    expect(f.asOf).toBe('2026-11-11T11:01:00.000Z');
    expect(f.history.map((h) => h.price)).toEqual([2.71, 2.75]);
  });
  it('a round where every source fails adds no tick and keeps the feed live on the last values', async () => {
    const state: { runpod: unknown; akash: unknown } = { runpod, akash };
    const feed = createPriceFeed({ fetchImpl: fakeNet(state).fetchImpl });
    await feed.refresh();
    state.runpod = 'fail'; state.akash = { models: [] };
    expect(await feed.refresh()).toBe(0);
    expect(feed.feed().history).toHaveLength(1); expect(feed.feed().live).toBe(true);
  });
  it('with one source only, the reference is that source', async () => {
    const feed = createPriceFeed({ fetchImpl: fakeNet({ runpod: 'fail', akash }).fetchImpl });
    await feed.refresh();
    expect(feed.feed().reference).toMatchObject({ price: 2.73, method: 'one source' });
  });
  it('returns the last six hours of history', async () => {
    const time = clock('2026-11-11T00:00:00.000Z');
    const feed = createPriceFeed({ fetchImpl: fakeNet({ runpod, akash }).fetchImpl, now: time.now });
    for (let i = 0; i < 8; i++) { await feed.refresh(); time.advance(3_600_000); } // ticks at 00:00 … 07:00; now 08:00
    expect(feed.ticks()).toHaveLength(8);
    expect(feed.feed().history.map((h) => h.t.slice(11, 16))).toEqual(['02:00', '03:00', '04:00', '05:00', '06:00', '07:00']);
  });
  it('keeps every tick in a file and reads it back after a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticks-')), file = path.join(dir, 'data', 'ticks.json');
    try {
      const time = clock('2026-11-11T11:00:00.000Z'), net = fakeNet({ runpod, akash });
      const first = createPriceFeed({ fetchImpl: net.fetchImpl, now: time.now, file });
      await first.refresh(); time.advance(60_000); await first.refresh();
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toHaveLength(2);

      time.advance(60_000);
      const second = createPriceFeed({ fetchImpl: net.fetchImpl, now: time.now, file });
      await second.load();
      expect(second.feed().live).toBe(false); // nothing fetched by this process yet
      await second.refresh();
      expect(second.feed().history.map((h) => h.t.slice(11, 16))).toEqual(['11:00', '11:01', '11:02']);

      fs.writeFileSync(file, 'not json');
      const third = createPriceFeed({ fetchImpl: net.fetchImpl, now: time.now, file });
      await third.load(); await third.refresh();
      expect(third.feed().history).toHaveLength(1); // a broken file is ignored, then replaced
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toHaveLength(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
