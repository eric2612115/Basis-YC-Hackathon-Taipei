// The shared bid board: the seeded sample ladder plus bids posted by visitors. Everyone who opens the site sees the
// same board. Posted bids are indicative, not binding. Owner: the backend conversation.
import crypto from 'node:crypto';
import { gpuBids, gpuCluster, robotBids, weldingRobot } from '../src/data/samples';
import type { AssetKind, Bid, BidBook } from '../src/lib/types';
import { InputError, looksLikeEmail, plain, readJson, writeJson } from './store';

export const MAX_BIDS_PER_BOARD = 200;
export const MAX_PRICE_MULTIPLE = 3;   // a bid may be at most three times today's resale price
export const MAX_VALID_MONTHS = 60;

/** The lot each board is for: how many units, today's resale price, and the sample ladder it starts with. */
const LOTS: Record<AssetKind, { units: number; priceToday: number; unitLabel: string; seeds: Bid[] }> = {
  gpu: { units: gpuCluster.units, priceToday: gpuCluster.usedPriceToday, unitLabel: gpuCluster.unitLabel, seeds: gpuBids },
  robot: { units: weldingRobot.units, priceToday: weldingRobot.usedPriceToday, unitLabel: weldingRobot.unitLabel, seeds: robotBids },
};

/** What is kept for a posted bid. `contact` and `tokenHash` never leave the server. */
interface StoredBid { asset: AssetKind; bid: Bid; contact?: string; tokenHash: string }

const isAsset = (x: unknown): x is AssetKind => x === 'gpu' || x === 'robot';
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createBidBoard(opts: { file?: string | null; now?: () => Date } = {}) {
  const file = opts.file ?? null, now = opts.now ?? (() => new Date());
  const loaded = readJson<unknown>(file, []);
  let posted: StoredBid[] = (Array.isArray(loaded) ? loaded : []).filter((x): x is StoredBid =>
    !!x && isAsset(x.asset) && typeof x.tokenHash === 'string' && !!x.bid && typeof x.bid.id === 'string' && typeof x.bid.buyer === 'string'
    && Number.isFinite(x.bid.units) && Number.isFinite(x.bid.pricePerUnit) && Number.isFinite(x.bid.validThroughMonth));

  /** The board for one kind of asset: sample ladder first, then visitors' bids in the order they were posted. */
  function book(asset: AssetKind): BidBook {
    return { asset, bids: [...LOTS[asset].seeds, ...posted.filter((p) => p.asset === asset).map((p) => p.bid)], asOf: now().toISOString() };
  }

  /** Check and store a visitor's bid. Returns the bid as everyone will see it, and the token that lets its poster remove it. */
  function post(input: unknown): { bid: Bid; token: string } {
    const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (!isAsset(b.asset)) throw new InputError('Choose what the bid is for: gpu or robot.');
    const lot = LOTS[b.asset];
    const buyer = typeof b.buyer === 'string' ? plain(b.buyer) : '';
    if (buyer.length < 2 || buyer.length > 60) throw new InputError('Give a name of 2 to 60 characters.');
    if (/[<>]/.test(buyer)) throw new InputError('Use plain text for the name.');
    if (typeof b.units !== 'number' || !Number.isInteger(b.units) || b.units < 1 || b.units > lot.units) {
      throw new InputError(lot.units === 1 ? 'This lot is 1 unit.' : `Units must be a whole number from 1 to ${lot.units}.`);
    }
    const maxPrice = lot.priceToday * MAX_PRICE_MULTIPLE;
    if (typeof b.pricePerUnit !== 'number' || !Number.isFinite(b.pricePerUnit) || b.pricePerUnit <= 0 || b.pricePerUnit > maxPrice) {
      throw new InputError(`The price per ${lot.unitLabel} must be above $0 and at most $${maxPrice.toLocaleString('en-US')}.`);
    }
    if (typeof b.validThroughMonth !== 'number' || !Number.isInteger(b.validThroughMonth) || b.validThroughMonth < 1 || b.validThroughMonth > MAX_VALID_MONTHS) {
      throw new InputError(`The promise must last a whole number of months, from 1 to ${MAX_VALID_MONTHS}.`);
    }
    let contact: string | undefined;
    if (b.contact !== undefined && b.contact !== null && b.contact !== '') {
      contact = typeof b.contact === 'string' ? b.contact.trim() : '';
      if (!looksLikeEmail(contact)) throw new InputError('The email does not look right. Leave it empty or fix it.');
    }
    if (book(b.asset).bids.length >= MAX_BIDS_PER_BOARD) throw new InputError('The board is full for now. Try again later.');

    const token = crypto.randomBytes(16).toString('hex');
    const bid: Bid = {
      id: `v-${crypto.randomBytes(6).toString('hex')}`, buyer, units: b.units, pricePerUnit: Math.round(b.pricePerUnit * 100) / 100,
      validThroughMonth: b.validThroughMonth, fundedPct: 1, postedAt: now().toISOString(),
    };
    posted.push({ asset: b.asset, bid, ...(contact ? { contact } : {}), tokenHash: hash(token) });
    writeJson(file, posted);
    return { bid, token };
  }

  /** Remove a posted bid. Only the browser that posted it holds the token; sample bids stay. */
  function remove(id: string, token: string): 'removed' | 'not found' | 'forbidden' {
    if (Object.values(LOTS).some((lot) => lot.seeds.some((s) => s.id === id))) return 'forbidden';
    const at = posted.findIndex((p) => p.bid.id === id);
    if (at < 0) return 'not found';
    if (!token || !sameHash(posted[at].tokenHash, hash(token))) return 'forbidden';
    posted.splice(at, 1);
    writeJson(file, posted);
    return 'removed';
  }

  /** Take every visitor's bid off one board, or off both: back to the sample ladder. Returns how many were removed. */
  function clear(asset?: AssetKind): number {
    const before = posted.length;
    posted = asset ? posted.filter((p) => p.asset !== asset) : [];
    writeJson(file, posted);
    return before - posted.length;
  }

  return { book, post, remove, clear };
}

export type BidBoard = ReturnType<typeof createBidBoard>;
