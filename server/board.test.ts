import express from 'express';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assumptions, gpuBids, gpuCluster, loanTerms, noStress, robotBids } from '../src/data/samples';
import { underwrite } from '../src/lib/engine';
import type { Bid, BidBook } from '../src/lib/types';
import { createLimiter } from './analyze';
import { createApi } from './api';
import { createBidBoard, MAX_BIDS_PER_BOARD } from './bids';
import { createLeadBook } from './leads';
import { SAMPLE_FEED } from './prices';
import { InputError } from './store';

const good = { asset: 'gpu', buyer: 'Night Owl Labs', units: 16, pricePerUnit: 9_000, validThroughMonth: 12 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));

describe('the shared bid board', () => {
  it('starts with the sample ladder of each lot', () => {
    const board = createBidBoard({ now: () => new Date('2026-11-11T12:00:00Z') });
    expect(board.book('gpu')).toEqual({ asset: 'gpu', bids: gpuBids, asOf: '2026-11-11T12:00:00.000Z' });
    expect(board.book('robot').bids).toEqual(robotBids);
    expect(board.book('gpu').bids.every((b) => b.sample)).toBe(true);
  });
  it('a posted bid is fully funded, dated, not a sample, and shown to everyone after the ladder', () => {
    const board = createBidBoard({ now: () => new Date('2026-11-11T12:00:00Z') });
    const { bid, token } = board.post({ ...good, buyer: '  Night   Owl\tLabs ', pricePerUnit: 9_000.004, contact: 'owl@example.com' });
    expect(bid).toEqual({ id: bid.id, buyer: 'Night Owl Labs', units: 16, pricePerUnit: 9_000, validThroughMonth: 12, fundedPct: 1, postedAt: '2026-11-11T12:00:00.000Z' });
    expect(bid.id).toMatch(/^v-[0-9a-f]{12}$/); expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(board.book('gpu').bids).toEqual([...gpuBids, bid]);
    expect(board.book('robot').bids).toEqual(robotBids);
    expect(JSON.stringify(board.book('gpu'))).not.toMatch(/owl@example\.com|contact|token/i);
  });
  it('the engine reads the board as it is: a better price for the first months lifts the largest covered loan', () => {
    const board = createBidBoard();
    const before = underwrite(gpuCluster, board.book('gpu').bids, loanTerms, assumptions, noStress).committedLoan;
    board.post({ ...good, units: 64, pricePerUnit: 12_500, validThroughMonth: 6 });
    const after = underwrite(gpuCluster, board.book('gpu').bids, loanTerms, assumptions, noStress);
    expect(before).toBe(704_000); expect(after.committedLoan).toBeGreaterThan(before);
    for (const p of after.path) if (p.month < loanTerms.months) expect(p.balance).toBeLessThanOrEqual(p.cover! + 1e-6);
  });
  it('checks and caps everything a visitor sends', () => {
    const board = createBidBoard();
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ ...good, asset: 'car' }, /gpu or robot/],
      [{ ...good, buyer: 'A' }, /2 to 60 characters/], [{ ...good, buyer: 'x'.repeat(61) }, /2 to 60 characters/], [{ ...good, buyer: 42 }, /2 to 60 characters/],
      [{ ...good, buyer: '<b>Bold</b>' }, /plain text/],
      [{ ...good, units: 0 }, /1 to 64/], [{ ...good, units: 65 }, /1 to 64/], [{ ...good, units: 1.5 }, /1 to 64/], [{ ...good, units: '16' }, /1 to 64/],
      [{ ...good, asset: 'robot', units: 2, pricePerUnit: 500_000 }, /This lot is 1 unit/],
      [{ ...good, pricePerUnit: 0 }, /at most \$45,000/], [{ ...good, pricePerUnit: 45_000.01 }, /at most \$45,000/], [{ ...good, pricePerUnit: Number.NaN }, /at most \$45,000/],
      [{ ...good, validThroughMonth: 0 }, /from 1 to 60/], [{ ...good, validThroughMonth: 61 }, /from 1 to 60/], [{ ...good, validThroughMonth: 2.5 }, /from 1 to 60/],
      [{ ...good, contact: 'not an email' }, /email does not look right/], [{ ...good, contact: `${'x'.repeat(120)}@example.com` }, /email does not look right/],
    ];
    for (const [input, message] of bad) { expect(() => board.post(input)).toThrow(InputError); expect(() => board.post(input)).toThrow(message); }
    for (const junk of [null, undefined, 'text', 7, []]) expect(() => board.post(junk)).toThrow(InputError);
    expect(board.book('gpu').bids).toEqual(gpuBids); // nothing got in
    expect(board.post({ ...good, pricePerUnit: 45_000, units: 64, validThroughMonth: 60, contact: '' }).bid.pricePerUnit).toBe(45_000); // the limits themselves are allowed
  });
  it('holds at most 200 bids per board', () => {
    const board = createBidBoard();
    for (let i = gpuBids.length; i < MAX_BIDS_PER_BOARD; i++) board.post(good);
    expect(board.book('gpu').bids).toHaveLength(200);
    expect(() => board.post(good)).toThrow(/board is full/);
    expect(board.post({ ...good, asset: 'robot', units: 1, pricePerUnit: 300_000 }).bid.units).toBe(1); // the other board has room
  });
  it('only the token removes a posted bid; sample bids stay', () => {
    const board = createBidBoard();
    const { bid, token } = board.post(good);
    expect(board.remove(bid.id, 'wrong')).toBe('forbidden'); expect(board.remove(bid.id, '')).toBe('forbidden');
    expect(board.remove('b1', token)).toBe('forbidden'); expect(board.remove('no-such-bid', token)).toBe('not found');
    expect(board.book('gpu').bids).toHaveLength(gpuBids.length + 1);
    expect(board.remove(bid.id, token)).toBe('removed');
    expect(board.book('gpu').bids).toEqual(gpuBids);
    expect(board.remove(bid.id, token)).toBe('not found');
  });
  it('keeps posted bids in a file, with the contact, and reads them back after a restart', () => {
    const dir = tmp(), file = path.join(dir, 'data', 'bids.json');
    try {
      const first = createBidBoard({ file });
      const { bid, token } = first.post({ ...good, contact: 'owl@example.com' });
      const saved = fs.readFileSync(file, 'utf8');
      expect(saved).toContain('owl@example.com'); expect(saved).not.toContain(token); // only a hash of the token is kept
      expect(fs.readFileSync(path.join(dir, 'data', '.gitignore'), 'utf8')).toMatch(/^\*$/m); // the folder is never committed

      const second = createBidBoard({ file });
      expect(second.book('gpu').bids).toEqual([...gpuBids, bid]);
      expect(second.remove(bid.id, token)).toBe('removed');
      expect(createBidBoard({ file }).book('gpu').bids).toEqual(gpuBids);

      fs.writeFileSync(file, '{"broken": true');
      expect(createBidBoard({ file }).book('gpu').bids).toEqual(gpuBids); // a broken file is ignored
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('can be cleared back to the sample ladder', () => {
    const board = createBidBoard();
    board.post(good); board.post(good); board.post({ ...good, asset: 'robot', units: 1, pricePerUnit: 300_000 });
    expect(board.clear('gpu')).toBe(2);
    expect(board.book('gpu').bids).toEqual(gpuBids); expect(board.book('robot').bids).toHaveLength(robotBids.length + 1);
    expect(board.clear()).toBe(1);
  });
});

describe('requests from visitors', () => {
  it('keeps a valid request on the server', () => {
    const dir = tmp(), file = path.join(dir, 'data', 'leads.json');
    try {
      const leads = createLeadBook({ file, now: () => new Date('2026-11-11T12:00:00Z') });
      leads.add({ name: ' Ada  Lovelace ', email: ' ada@example.com ', note: 'We run 120 H100s\nin two halls.' });
      leads.add({ name: 'Bo', email: 'bo@example.org' });
      expect(leads.count()).toBe(2);
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([
        { name: 'Ada Lovelace', email: 'ada@example.com', note: 'We run 120 H100s in two halls.', at: '2026-11-11T12:00:00.000Z' },
        { name: 'Bo', email: 'bo@example.org', at: '2026-11-11T12:00:00.000Z' },
      ]);
      expect(createLeadBook({ file }).count()).toBe(2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('says what is missing', () => {
    const leads = createLeadBook();
    expect(() => leads.add({ name: 'A', email: 'a@example.com' })).toThrow(/2 to 80 characters/);
    expect(() => leads.add({ name: 'Ada', email: 'ada at example' })).toThrow(/email does not look right/);
    expect(() => leads.add({ name: 'Ada', email: 'ada@example.com', note: 'x'.repeat(501) })).toThrow(/under 500 characters/);
    for (const junk of [null, 'text', {}, []]) expect(() => leads.add(junk)).toThrow(InputError);
    expect(leads.count()).toBe(0);
  });
});

describe('the API for the board and for requests', () => {
  let base = '';
  let close: () => void = () => {};
  const leads = createLeadBook();

  beforeAll(async () => {
    const app = express();
    app.use('/api', createApi({
      prices: { feed: () => SAMPLE_FEED }, bids: createBidBoard(), leads,
      bidLimiter: createLimiter(6, 3_600_000), leadLimiter: createLimiter(3, 3_600_000), adminToken: 'admin-test', log: () => {},
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    close = () => { server.close(); };
  });
  afterAll(() => close());

  const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('GET /bids returns the board for one kind of asset', async () => {
    const book = (await (await send('GET', '/bids?asset=gpu')).json()) as BidBook;
    expect(book.asset).toBe('gpu'); expect(book.bids).toEqual(gpuBids); expect(Number.isNaN(Date.parse(book.asOf))).toBe(false);
    expect(((await (await send('GET', '/bids?asset=robot')).json()) as BidBook).bids).toEqual(robotBids);
    expect(((await (await send('GET', '/bids')).json()) as BidBook).asset).toBe('gpu');
    expect((await send('GET', '/bids?asset=car')).status).toBe(400);
  });
  it('POST /bids stores the bid and returns it with a token; DELETE /bids/:id needs that token', async () => {
    const res = await send('POST', '/bids', { ...good, contact: 'owl@example.com' });
    expect(res.status).toBe(201);
    const { bid, token } = (await res.json()) as { bid: Bid; token: string };
    expect(bid).toMatchObject({ buyer: 'Night Owl Labs', units: 16, pricePerUnit: 9_000, validThroughMonth: 12, fundedPct: 1 });
    expect(bid.sample).toBeUndefined(); expect(JSON.stringify(bid)).not.toContain('owl@example.com');

    const text = await (await send('GET', '/bids?asset=gpu')).text();
    expect((JSON.parse(text) as BidBook).bids.at(-1)).toEqual(bid);
    expect(text).not.toMatch(/owl@example\.com|contact/);

    expect((await send('DELETE', `/bids/${bid.id}`)).status).toBe(403);
    expect((await send('DELETE', `/bids/${bid.id}`, undefined, { 'x-bid-token': 'wrong' })).status).toBe(403);
    expect((await send('DELETE', '/bids/b1', undefined, { 'x-bid-token': token })).status).toBe(403);
    const gone = await send('DELETE', `/bids/${bid.id}`, undefined, { 'x-bid-token': token });
    expect(gone.status).toBe(200); expect(await gone.json()).toEqual({ ok: true });
    expect((await send('DELETE', `/bids/${bid.id}`, undefined, { 'x-bid-token': token })).status).toBe(404);
    expect(((await (await send('GET', '/bids?asset=gpu')).json()) as BidBook).bids).toEqual(gpuBids);
  });
  it('POST /bids says what is wrong, and limits how many one address may post in an hour', async () => {
    const bad = await send('POST', '/bids', { ...good, units: 500 });
    expect(bad.status).toBe(400); expect(await bad.json()).toEqual({ error: 'Units must be a whole number from 1 to 64.' });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await send('POST', '/bids', good)).status); // the limit in this test is 6 an hour; 2 are used above
    expect(statuses).toEqual([201, 201, 201, 201, 429, 429]);
    const refused = await send('POST', '/bids', good);
    expect((await refused.json()).error).toMatch(/Too many bids from this address/);
  });
  it('DELETE /bids clears visitors bids only with the admin token', async () => {
    expect((await send('DELETE', '/bids')).status).toBe(404);
    expect((await send('DELETE', '/bids', undefined, { 'x-admin-token': 'guess' })).status).toBe(404);
    const res = await send('DELETE', '/bids?asset=gpu', undefined, { 'x-admin-token': 'admin-test' });
    expect(await res.json()).toEqual({ ok: true, removed: 4 });
    expect(((await (await send('GET', '/bids?asset=gpu')).json()) as BidBook).bids).toEqual(gpuBids);
  });
  it('POST /leads answers { ok: true }, says what is wrong, limits each address, and nothing returns the list', async () => {
    const ok = await send('POST', '/leads', { name: 'Ada Lovelace', email: 'ada@example.com', note: 'Two halls of H100s.' });
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ ok: true });
    const bad = await send('POST', '/leads', { name: 'Ada', email: 'nope' });
    expect(bad.status).toBe(400); expect(await bad.json()).toEqual({ error: 'The email does not look right.' });
    expect((await send('POST', '/leads', { name: 'Bo', email: 'bo@example.org' })).status).toBe(200);
    expect((await send('POST', '/leads', { name: 'Cy', email: 'cy@example.org' })).status).toBe(429); // the limit in this test is 3 an hour
    expect(leads.count()).toBe(2);
    expect((await send('GET', '/leads')).status).toBe(404);
  });
});
