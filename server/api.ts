// API routes: live prices, the sample records, and the analysis of rental records.
// Owner: the backend conversation. Shapes are in src/lib/types.ts.
import express, { Router } from 'express';
import type { ErrorRequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Analysis, PriceFeed } from '../src/lib/types';
import { analyzeRecords, createLimiter, RecordsError, type AnalyzeOptions } from './analyze';
import { createPriceFeed } from './prices';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = (name: string) => path.join(root, 'src', 'data', name);

export const BODY_LIMIT = '2mb';

export interface ApiDeps {
  prices: { feed: () => PriceFeed };
  sampleCsv?: string;
  storedAnalysis?: Analysis;
  analyze?: (csv: string, opts: AnalyzeOptions) => Promise<Analysis>;
  limiter?: (key: string) => { ok: boolean; retryAfterSec: number };
  log?: (message: string) => void;
}

export function createApi(deps: ApiDeps): Router {
  const sampleCsv = deps.sampleCsv ?? fs.readFileSync(dataFile('records.sample.csv'), 'utf8');
  const stored = deps.storedAnalysis ?? (JSON.parse(fs.readFileSync(dataFile('analysis.sample.json'), 'utf8')) as Analysis);
  const analyze = deps.analyze ?? analyzeRecords;
  const limiter = deps.limiter ?? createLimiter(30, 3_600_000);
  const log = deps.log ?? ((message: string) => console.log(message));

  const router = Router();
  router.use(express.json({ limit: BODY_LIMIT }));

  router.get('/health', (_req, res) => { res.json({ ok: true }); });

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
    const gate = limiter(req.ip ?? 'unknown');
    if (!gate.ok) {
      res.set('retry-after', String(gate.retryAfterSec));
      res.status(429).json({ error: `Too many files from this address. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minutes.` });
      return;
    }
    try {
      const units = typeof body.units === 'number' && body.units > 0 ? body.units : undefined;
      res.json(await analyze(body.csv, { units, log }));
    } catch (err) {
      if (err instanceof RecordsError) { res.status(400).json({ error: err.message }); return; }
      log(`analyze: ${err instanceof Error ? err.message : 'unknown error'}`);
      res.status(500).json({ error: 'The analysis failed.' });
    }
  });

  router.use((_req, res) => { res.status(404).json({ error: 'Not found.' }); });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.too.large') { res.status(413).json({ error: 'The file is larger than 2 MB.' }); return; }
    if (type === 'entity.parse.failed') { res.status(400).json({ error: 'The request is not valid JSON.' }); return; }
    res.status(500).json({ error: 'Something went wrong.' });
  };
  router.use(onError);
  return router;
}

/** The price feed of the running server; index.ts starts it. Ticks are kept in data/ticks.json (git-ignored). */
export const prices = createPriceFeed({ file: path.join(root, 'data', 'ticks.json') });
export const api = createApi({ prices });
