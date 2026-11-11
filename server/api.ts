// API routes: live prices, the sample records and their analysis, the shared bid board, and requests from visitors.
// Owner: the backend conversation. Shapes are in src/lib/types.ts.
import express, { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Analysis, AssetKind, PriceFeed } from '../src/lib/types';
import { analyzeRecords, createLimiter, RecordsError, type AnalyzeOptions } from './analyze';
import { createBidBoard, type BidBoard } from './bids';
import { createLeadBook, type LeadBook } from './leads';
import { InputError } from './store';
import { createCheckout, type CheckoutInput } from './stripe';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = (name: string) => path.join(root, 'src', 'data', name);

export const BODY_LIMIT = '2mb';

type Limiter = (key: string) => { ok: boolean; retryAfterSec: number };

export interface ApiDeps {
  prices: { feed: () => PriceFeed };
  bids?: BidBoard;                 // default: a board kept in memory only
  leads?: LeadBook;                // default: kept in memory only
  sampleCsv?: string;
  storedAnalysis?: Analysis;
  analyze?: (csv: string, opts: AnalyzeOptions) => Promise<Analysis>;
  limiter?: Limiter;               // files analysed: 30 an hour per address
  bidLimiter?: Limiter;            // bids posted: 20 an hour per address
  leadLimiter?: Limiter;           // requests sent: 10 an hour per address
  adminToken?: string;             // when set, DELETE /bids with this token clears visitors' bids
  stripeKey?: string;              // when set, POST /checkout opens a Stripe payment page for the fee
  log?: (message: string) => void;
}

export function createApi(deps: ApiDeps): Router {
  const sampleCsv = deps.sampleCsv ?? fs.readFileSync(dataFile('records.sample.csv'), 'utf8');
  const stored = deps.storedAnalysis ?? (JSON.parse(fs.readFileSync(dataFile('analysis.sample.json'), 'utf8')) as Analysis);
  const analyze = deps.analyze ?? analyzeRecords;
  const board = deps.bids ?? createBidBoard();
  const leads = deps.leads ?? createLeadBook();
  const limiter = deps.limiter ?? createLimiter(30, 3_600_000);
  const bidLimiter = deps.bidLimiter ?? createLimiter(20, 3_600_000);
  const leadLimiter = deps.leadLimiter ?? createLimiter(10, 3_600_000);
  const log = deps.log ?? ((message: string) => console.log(message));

  const address = (req: Request) => req.ip ?? 'unknown';
  /** Answers 429 and returns false when this address has used up its allowance. */
  const allow = (gate: { ok: boolean; retryAfterSec: number }, res: express.Response, what: string): boolean => {
    if (gate.ok) return true;
    res.set('retry-after', String(gate.retryAfterSec));
    res.status(429).json({ error: `Too many ${what} from this address. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minutes.` });
    return false;
  };
  const assetOf = (x: unknown): AssetKind | null => (x === 'gpu' || x === 'robot' ? x : null);

  const router = Router();
  router.use(express.json({ limit: BODY_LIMIT }));

  router.get('/health', (_req, res) => { res.json({ ok: true }); });

  // Paying the fee: whether it is switched on, and a Stripe payment page for one promise.
  router.get('/checkout', (_req, res) => { res.json({ enabled: Boolean(deps.stripeKey) }); });
  router.post('/checkout', async (req, res) => {
    if (!deps.stripeKey) { res.status(404).json({ error: 'Payments are not switched on.' }); return; }
    if (!allow(bidLimiter(address(req)), res, 'payments')) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const asset = assetOf(b.asset);
    if (!asset) { res.status(400).json({ error: 'Say which machines: gpu or robot.' }); return; }
    const input: CheckoutInput = { asset, units: Number(b.units), pricePerUnit: Number(b.pricePerUnit), months: Number(b.months) };
    const proto = (req.get('x-forwarded-proto') ?? req.protocol).split(',')[0].trim();
    try {
      res.json({ url: await createCheckout(deps.stripeKey, input, `${proto}://${req.get('host')}`) });
    } catch (e) {
      if (e instanceof InputError) { res.status(400).json({ error: e.message }); return; }
      log(`checkout: ${e instanceof Error ? e.message : String(e)}`);
      res.status(502).json({ error: 'The payment page could not be opened.' });
    }
  });

  router.get('/prices', (_req, res) => { res.set('cache-control', 'no-store'); res.json(deps.prices.feed()); });

  router.get('/sample-records', (_req, res) => {
    res.set('content-disposition', 'inline; filename="records.sample.csv"');
    res.type('text/csv').send(sampleCsv);
  });

  // No csv: the stored analysis of the sample. With csv: the summary in code, then a model or the rules.
  router.post('/analyze', async (req, res) => {
    const body = (req.body ?? {}) as { csv?: unknown; units?: unknown };
    if (body.csv === undefined || body.csv === null || body.csv === '') { res.json(stored); return; }
    if (typeof body.csv !== 'string') { res.status(400).json({ error: 'csv must be text.' }); return; }
    if (!allow(limiter(address(req)), res, 'files')) return;
    try {
      const units = typeof body.units === 'number' && body.units > 0 ? body.units : undefined;
      res.json(await analyze(body.csv, { units, log }));
    } catch (err) {
      if (err instanceof RecordsError) { res.status(400).json({ error: err.message }); return; }
      log(`analyze: ${err instanceof Error ? err.message : 'unknown error'}`);
      res.status(500).json({ error: 'The analysis failed.' });
    }
  });

  // The shared bid board. Everyone sees the same bids; `contact` is kept on the server and never returned.
  router.get('/bids', (req, res) => {
    const asset = assetOf(req.query.asset ?? 'gpu');
    if (!asset) { res.status(400).json({ error: 'asset must be gpu or robot.' }); return; }
    res.set('cache-control', 'no-store');
    res.json(board.book(asset));
  });

  router.post('/bids', (req, res) => {
    if (!allow(bidLimiter(address(req)), res, 'bids')) return;
    try {
      const { bid, token } = board.post(req.body);
      res.status(201).json({ bid, token });
    } catch (err) {
      if (err instanceof InputError) { res.status(400).json({ error: err.message }); return; }
      throw err;
    }
  });

  router.delete('/bids/:id', (req, res) => {
    const outcome = board.remove(String(req.params.id), String(req.get('x-bid-token') ?? ''));
    if (outcome === 'removed') { res.json({ ok: true }); return; }
    if (outcome === 'not found') { res.status(404).json({ error: 'That bid is not on the board.' }); return; }
    res.status(403).json({ error: 'Only the browser that posted a bid can remove it. Sample bids stay.' });
  });

  // For the people running the demo: clear visitors' bids, back to the sample ladder. Off unless ADMIN_TOKEN is set.
  router.delete('/bids', (req, res) => {
    if (!deps.adminToken || req.get('x-admin-token') !== deps.adminToken) { res.status(404).json({ error: 'Not found.' }); return; }
    const asset = req.query.asset === undefined ? undefined : assetOf(req.query.asset);
    if (asset === null) { res.status(400).json({ error: 'asset must be gpu or robot.' }); return; }
    res.json({ ok: true, removed: board.clear(asset) });
  });

  // Someone asking for this on their own machines. Kept on the server; nothing returns it.
  router.post('/leads', (req, res) => {
    if (!allow(leadLimiter(address(req)), res, 'requests')) return;
    try {
      leads.add(req.body);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof InputError) { res.status(400).json({ error: err.message }); return; }
      throw err;
    }
  });

  router.use((_req, res) => { res.status(404).json({ error: 'Not found.' }); });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.too.large') { res.status(413).json({ error: 'The file is larger than 2 MB.' }); return; }
    if (type === 'entity.parse.failed') { res.status(400).json({ error: 'The request is not valid JSON.' }); return; }
    log(`api: ${err instanceof Error ? err.message : 'unknown error'}`);
    res.status(500).json({ error: 'Something went wrong.' });
  };
  router.use(onError);
  return router;
}
