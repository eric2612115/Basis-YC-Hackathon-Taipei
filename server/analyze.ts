// Reading a cluster's rental records for a lender. The summary is always computed in code. The flags and the memo come
// from a model when a key is set and its answer survives the checks; otherwise from rules in code.
// Owner: the backend conversation. The key never leaves this file.
import { checkModelAnswer, DEFAULT_UNITS, modelInput, parseRecords, ruleFlags, ruleMemo, summarize } from '../src/lib/records';
import type { Analysis } from '../src/lib/types';

export interface AiConfig { baseUrl: string; apiKey: string; model: string }

export function aiConfigFromEnv(env: Record<string, string | undefined> = process.env): AiConfig {
  return {
    baseUrl: (env.AI_BASE_URL || 'https://api.gmi-serving.com/v1').replace(/\/+$/, ''),
    apiKey: (env.AI_API_KEY || '').trim(),
    model: (env.AI_MODEL || '').trim(),
  };
}

/** Thrown when the file holds no records we can read; the message is safe to show. */
export class RecordsError extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const MODEL_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = [
  'You review the rental records of a GPU cluster for a lender who may lend against the machines.',
  'Find what the lender should worry about: one customer carrying too much revenue, contracts about to end, late payments, refunds, downtime, price cuts, falling use.',
  'Use only the summary and the table you are given. Copy every number exactly as it is written there. Never calculate, round or invent a number.',
  'Cite the rows that show each problem in "rows", by their row number. Do not write row numbers in the title, the detail or the memo.',
  'Say "risk grade" if you need the idea; never write "credit rating" or "insurance".',
  'Answer with JSON only, no other text:',
  '{"flags":[{"id":"short-id","severity":"high|medium|low","title":"at most 8 words","detail":"one plain sentence","rows":[row numbers]}],"memo":"one paragraph for the lender, at most 60 words"}',
  'At most 6 flags, the most serious first.',
].join('\n');

/** The first JSON object in a model's reply, with reasoning blocks and code fences removed. */
export function extractJson(text: string): unknown {
  const body = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in the answer');
  return JSON.parse(body.slice(start, end + 1));
}

const PREFERRED = ['claude', 'gpt-5', 'gpt-4', 'deepseek-v3', 'llama-3.3-70b', 'qwen', 'deepseek', 'llama'];
const pickedModel = new Map<string, string>();

/** The model to call: the one named in AI_MODEL, else the first one this provider lists that we know how to use. */
async function resolveModel(ai: AiConfig, fetchImpl: FetchLike): Promise<string> {
  if (ai.model) return ai.model;
  const cached = pickedModel.get(ai.baseUrl);
  if (cached) return cached;
  const res = await fetchImpl(`${ai.baseUrl}/models`, { headers: { authorization: `Bearer ${ai.apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`model list: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id?: unknown }[] };
  const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
  const pick = PREFERRED.map((p) => ids.find((id) => id.toLowerCase().includes(p))).find(Boolean) ?? ids[0];
  if (!pick) throw new Error('the provider lists no model');
  pickedModel.set(ai.baseUrl, pick);
  return pick;
}

async function askModel(ai: AiConfig, input: string, fetchImpl: FetchLike): Promise<{ answer: unknown; model: string }> {
  const model = await resolveModel(ai, fetchImpl);
  const res = await fetchImpl(`${ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 1500, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: input }] }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`model call: HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('the model returned no text');
  return { answer: extractJson(content), model };
}

export interface AnalyzeOptions { units?: number; ai?: AiConfig; fetchImpl?: FetchLike; log?: (message: string) => void }

/** Analyse uploaded records. Never throws for a model problem: it falls back to the rules. */
export async function analyzeRecords(csv: string, opts: AnalyzeOptions = {}): Promise<Analysis> {
  const { rows, missing } = parseRecords(csv);
  if (missing.length > 0) throw new RecordsError(`The file needs these columns: ${missing.join(', ')}.`);
  if (rows.length === 0) throw new RecordsError('No records could be read from the file.');
  const units = opts.units && opts.units > 0 ? opts.units : DEFAULT_UNITS;
  const summary = summarize(rows, units);
  const ai = opts.ai ?? aiConfigFromEnv();
  const log = opts.log ?? (() => {});

  if (ai.apiKey) {
    try {
      const input = modelInput(rows, summary);
      const { answer, model } = await askModel(ai, input, opts.fetchImpl ?? ((url, init) => fetch(url, init)));
      const checked = checkModelAnswer(answer, rows, input);
      if (checked.dropped > 0) log(`analyze: dropped ${checked.dropped} flag(s) the records do not support`);
      if (checked.flags.length > 0) {
        return { summary, flags: checked.flags, memo: checked.memo ?? ruleMemo(summary, checked.flags), source: 'model', model };
      }
      log('analyze: no flag from the model survived the checks; using the rules');
    } catch (err) {
      log(`analyze: model call failed (${err instanceof Error ? err.message : 'unknown error'}); using the rules`);
    }
  }
  const flags = ruleFlags(rows, summary);
  return { summary, flags, memo: ruleMemo(summary, flags), source: 'rules' };
}

/** Allow `max` calls per `windowMs` for each key (an address). */
export function createLimiter(max: number = 30, windowMs: number = 3_600_000, now: () => number = Date.now) {
  const calls = new Map<string, number[]>();
  return (key: string): { ok: boolean; retryAfterSec: number } => {
    const t = now(), recent = (calls.get(key) ?? []).filter((x) => t - x < windowMs);
    if (calls.size > 5_000) for (const [k, v] of calls) if (v.every((x) => t - x >= windowMs)) calls.delete(k);
    if (recent.length >= max) { calls.set(key, recent); return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) }; }
    recent.push(t); calls.set(key, recent);
    return { ok: true, retryAfterSec: 0 };
  };
}
