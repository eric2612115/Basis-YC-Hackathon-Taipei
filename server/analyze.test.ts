import express from 'express';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Analysis } from '../src/lib/types';
import { aiConfigFromEnv, analyzeRecords, createLimiter, extractJson, RecordsError, type AiConfig } from './analyze';
import { createApi } from './api';
import { SAMPLE_FEED } from './prices';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const sampleCsv = fs.readFileSync(path.join(dataDir, 'records.sample.csv'), 'utf8');
const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'analysis.sample.json'), 'utf8')) as Analysis;

const KEY = 'test-key-not-real';
const ai: AiConfig = { baseUrl: 'https://ai.test/v1', apiKey: KEY, model: 'test-model' };
const noKey: AiConfig = { ...ai, apiKey: '' };

/** A stand-in for the model API: answers /chat/completions with `content`, and records what it was sent. */
function fakeModel(content: string | (() => Response)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'tiny-embed' }, { id: 'vendor/Llama-3.3-70B-Instruct' }] }), { status: 200 });
    if (typeof content === 'function') return content();
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  return { fetchImpl, calls };
}

const goodFlag = { id: 'concentration', severity: 'high', title: 'One customer is 41% of revenue', detail: 'C-07 brings 41% of revenue and its contract ends 2026-12-31.', rows: [99, 107, 115] };
const inventedFlag = { id: 'trend', severity: 'medium', title: 'Revenue fell 23.7% this year', detail: 'Revenue is down 23.7% from last year.', rows: [115] };
const ruleIds = ['concentration', 'price-cut', 'late', 'refund', 'downtime'];

describe('analysing uploaded records', () => {
  it('with no key it does not call anything and answers from the rules', async () => {
    const model = fakeModel('{}');
    const a = await analyzeRecords(sampleCsv, { ai: noKey, fetchImpl: model.fetchImpl });
    expect(model.calls).toHaveLength(0);
    expect(a.summary).toEqual(stored.summary);
    expect(a.flags.map((f) => f.id)).toEqual(ruleIds);
    expect(a.source).toBe('rules'); expect(a.model).toBeUndefined();
  });
  it('with a key it sends the records to the model and keeps the flags the records support', async () => {
    const model = fakeModel(JSON.stringify({ flags: [goodFlag, inventedFlag], memo: 'One customer brings 41% of revenue and its contract ends 2026-12-31.' }));
    const logs: string[] = [];
    const a = await analyzeRecords(sampleCsv, { ai, fetchImpl: model.fetchImpl, log: (m) => logs.push(m) });
    expect(a.source).toBe('model'); expect(a.model).toBe('test-model');
    expect(a.flags).toEqual([goodFlag]);                      // the invented 23.7% is dropped
    expect(logs.join(' ')).toMatch(/dropped 1 flag/);
    expect(a.memo).toBe('One customer brings 41% of revenue and its contract ends 2026-12-31.');
    expect(a.summary).toEqual(stored.summary);                // the summary never comes from the model

    const call = model.calls[0], sent = JSON.parse(String(call.init?.body));
    expect(call.url).toBe('https://ai.test/v1/chat/completions');
    expect((call.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(sent.model).toBe('test-model');
    expect(sent.messages[1].content).toContain('91,2026-07-31,C-07,MSA-07,2.15');
    expect(JSON.stringify(a)).not.toContain(KEY);
  });
  it('replaces a memo the records do not support with one written by code', async () => {
    const model = fakeModel(JSON.stringify({ flags: [goodFlag], memo: 'Annual revenue is about $1.3 million.' }));
    const a = await analyzeRecords(sampleCsv, { ai, fetchImpl: model.fetchImpl });
    expect(a.source).toBe('model'); expect(a.memo).toMatch(/^Over 14 months the cluster was in use 72% of the time/);
  });
  it('falls back to the rules when nothing the model said survives, when the call fails, or when the answer is not JSON', async () => {
    const cases = [
      fakeModel(JSON.stringify({ flags: [inventedFlag] })),
      fakeModel(() => new Response('upstream error', { status: 500 })),
      fakeModel('I could not find any problems.'),
      fakeModel(() => { throw new Error('timeout'); }),
      fakeModel(() => new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    ];
    for (const model of cases) {
      const a = await analyzeRecords(sampleCsv, { ai, fetchImpl: model.fetchImpl });
      expect(a.flags.map((f) => f.id)).toEqual(ruleIds); expect(a.source).toBe('rules');
    }
  });
  it('with no AI_MODEL it picks a chat model the provider lists', async () => {
    const model = fakeModel(JSON.stringify({ flags: [goodFlag] }));
    const a = await analyzeRecords(sampleCsv, { ai: { ...ai, baseUrl: 'https://other.test/v1', model: '' }, fetchImpl: model.fetchImpl });
    expect(model.calls[0].url).toBe('https://other.test/v1/models');
    expect(a.model).toBe('vendor/Llama-3.3-70B-Instruct');
  });
  it('refuses a file with no records it can read, in words that can be shown', async () => {
    await expect(analyzeRecords('a,b\n1,2\n', { ai: noKey })).rejects.toThrow(RecordsError);
    await expect(analyzeRecords('a,b\n1,2\n', { ai: noKey })).rejects.toThrow('The file needs these columns: date, customer_id, gpu_hours, revenue.');
    await expect(analyzeRecords('date,customer_id,gpu_hours,revenue\n', { ai: noKey })).rejects.toThrow('No records could be read from the file.');
  });
  it('use depends on how many units the cluster has', async () => {
    const a = await analyzeRecords(sampleCsv, { ai: noKey, units: 128 });
    expect(a.summary.avgUtilization).toBeCloseTo(stored.summary.avgUtilization / 2, 3);
  });
});

describe('the pieces around the model call', () => {
  it('reads the JSON out of a chatty answer', () => {
    expect(extractJson('<think>let me look {not this}</think>Here you go:\n```json\n{"flags":[],"memo":"ok"}\n```')).toEqual({ flags: [], memo: 'ok' });
    expect(() => extractJson('no braces here')).toThrow();
  });
  it('reads its settings from the environment, with the default base URL', () => {
    expect(aiConfigFromEnv({})).toEqual({ baseUrl: 'https://api.gmi-serving.com/v1', apiKey: '', model: '' });
    expect(aiConfigFromEnv({ AI_BASE_URL: 'https://x.test/v1/', AI_API_KEY: ' k ', AI_MODEL: 'm' })).toEqual({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' });
  });
  it('the limiter allows 30 calls an hour per address', () => {
    let t = 0;
    const allow = createLimiter(30, 3_600_000, () => t);
    for (let i = 0; i < 30; i++) { expect(allow('1.2.3.4').ok).toBe(true); t += 1_000; }
    expect(allow('1.2.3.4')).toEqual({ ok: false, retryAfterSec: 3_570 });
    expect(allow('5.6.7.8').ok).toBe(true);           // another address is not affected
    t = 3_600_000;                                      // an hour after the first call
    expect(allow('1.2.3.4').ok).toBe(true);
  });
});

describe('the API', () => {
  let base = '';
  let close: () => void = () => {};
  const model = fakeModel(JSON.stringify({ flags: [goodFlag], memo: 'One customer brings 41% of revenue.' }));

  beforeAll(async () => {
    const app = express();
    app.use('/api', createApi({
      prices: { feed: () => SAMPLE_FEED },
      analyze: (csv, opts) => analyzeRecords(csv, { ...opts, ai, fetchImpl: model.fetchImpl }),
      limiter: createLimiter(4, 3_600_000),
      log: () => {},
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    close = () => { server.close(); };
  });
  afterAll(() => close());

  const post = (body: unknown) => fetch(`${base}/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('GET /health', async () => { expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true }); });
  it('GET /prices answers in the shape of PriceFeed', async () => {
    const res = await fetch(`${base}/prices`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(SAMPLE_FEED);
  });
  it('GET /sample-records returns the sample CSV', async () => {
    const res = await fetch(`${base}/sample-records`);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(await res.text()).toBe(sampleCsv);
  });
  it('POST /analyze with no csv returns the stored analysis of the sample', async () => {
    for (const body of [{}, { csv: '' }, { csv: null }]) expect(await (await post(body)).json()).toEqual(stored);
    expect(model.calls).toHaveLength(0);
  });
  it('POST /analyze with a csv returns the checked answer, and never the key', async () => {
    const res = await post({ csv: sampleCsv }), text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ source: 'model', model: 'test-model', flags: [goodFlag], summary: stored.summary });
    expect(text).not.toContain(KEY);
  });
  it('says what is wrong with a bad request', async () => {
    expect([(await post({ csv: 42 })).status, (await post('{"csv": ')).status]).toEqual([400, 400]);
    const res = await post({ csv: 'a,b\n1,2\n' });
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: 'The file needs these columns: date, customer_id, gpu_hours, revenue.' });
    expect((await fetch(`${base}/nothing-here`)).status).toBe(404);
  });
  it('refuses a body over 2 MB', async () => {
    const res = await post({ csv: 'x'.repeat(2 * 1024 * 1024 + 10) });
    expect(res.status).toBe(413); expect(await res.json()).toEqual({ error: 'The file is larger than 2 MB.' });
  });
  it('limits how many files one address may send in an hour', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ csv: sampleCsv })).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2); // the limit in this test is 4 an hour
    const refused = await post({ csv: sampleCsv });
    expect(refused.status).toBe(429); expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await refused.json()).error).toMatch(/Too many files from this address/);
    expect((await post({})).status).toBe(200); // the stored sample is not limited
  });
});
