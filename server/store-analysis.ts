// Rewrites src/data/analysis.sample.json, the stored analysis of the sample records that the server answers with
// when no file is uploaded. Run it after changing the sample records or the rules:
//
//   npx tsx server/store-analysis.ts
//
// With AI_API_KEY set (and optionally AI_BASE_URL, AI_MODEL) the flags and the memo come from the model, checked
// against the records as always; without a key they come from the rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Analysis } from '../src/lib/types';
import { analyzeRecords } from './analyze';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csv = fs.readFileSync(path.join(root, 'src', 'data', 'records.sample.csv'), 'utf8');

const result = await analyzeRecords(csv, { log: (m) => console.log(m) });
const stored: Analysis = { summary: result.summary, flags: result.flags, memo: result.memo, source: 'stored', ...(result.source === 'model' && result.model ? { model: result.model } : {}) };
fs.writeFileSync(path.join(root, 'src', 'data', 'analysis.sample.json'), `${JSON.stringify(stored, null, 2)}\n`);
console.log(`stored ${stored.flags.length} flags, written by ${stored.model ?? 'the rules'}`);
