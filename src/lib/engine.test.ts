import { describe, expect, it } from 'vitest';
import {
  balanceAt, black76Put, earningsValuePerUnit, expectedUnitValue, gradeRisk, gradeTable, guaranteedAt, ladderFee,
  maxCommittedLoan, monthlyPayment, normCdf, quoteBid, underwrite,
} from './engine';
import { assumptions, gpuBids, gpuCluster, loanTerms, noStress, robotBids, robotLoanTerms, weldingRobot } from '../data/samples';
import type { Asset, Bid, LoanTerms, RecordsSummary } from './types';

/** A small seeded random number generator, so the property tests repeat exactly. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('the sample cluster', () => {
  it('a bank lends $480K', () => { expect(underwrite(gpuCluster, [], loanTerms, assumptions, noStress).bankLoan).toBe(480_000); });
  it('committed buyers support $704K, bound in month 0', () => {
    const r = maxCommittedLoan(gpuCluster, gpuBids, loanTerms);
    expect(r.loan).toBe(704_000); expect(r.bindingMonth).toBe(0);
  });
  it('the balance stays under the guaranteed amount every month', () => {
    for (let m = 0; m < loanTerms.months; m++) expect(balanceAt(704_000, loanTerms, m)).toBeLessThanOrEqual(guaranteedAt(gpuBids, 64, m) + 1e-6);
  });
  it('underwrite reports the same loan, its payment and the fee per year', () => {
    const u = underwrite(gpuCluster, gpuBids, loanTerms, assumptions, noStress);
    expect(u.committedLoan).toBe(704_000);
    expect(u.monthlyPayment).toBeCloseTo(monthlyPayment(704_000, loanTerms), 6);
    expect(u.fee).toBeCloseTo(ladderFee(gpuCluster, gpuBids, loanTerms, assumptions), 6);
    expect(u.feePerYearPct).toBeCloseTo(u.fee / 704_000 / 3, 9);
    expect(u.path).toHaveLength(loanTerms.months + 1);
    expect(u.stress).toBeNull();
  });
  it('the robot cell: a bank lends $450K, the maker buy-back supports $700K', () => {
    const u = underwrite(weldingRobot, robotBids, robotLoanTerms, assumptions, noStress);
    expect(u.bankLoan).toBe(450_000); expect(u.committedLoan).toBe(700_000);
  });
});

describe('value from income', () => {
  const flat: Asset = { ...gpuCluster, ratePerHour: 2, utilization: 0.5, hoursPerMonth: 700, opexPerUnitMonth: 0, rentDeclinePerYear: 0, lifeMonthsRemaining: 24 };
  it('with no decline, no cost and no discount it is rent × hours × use × months', () => {
    expect(earningsValuePerUnit(flat, { ...assumptions, discountRate: 0 })).toBeCloseTo(2 * 700 * 0.5 * 24, 6);
  });
  it('discounts each month at the yearly rate ÷ 12', () => {
    const i = 0.12 / 12, net = 2 * 700 * 0.5 - 100;
    expect(earningsValuePerUnit({ ...flat, opexPerUnitMonth: 100 }, { ...assumptions, discountRate: 0.12 })).toBeCloseTo((net * (1 - Math.pow(1 + i, -24))) / i, 6);
  });
  it('rent falls each year by the decline', () => {
    const a = { ...flat, rentDeclinePerYear: 0.2, lifeMonthsRemaining: 12 };
    let want = 0; for (let k = 1; k <= 12; k++) want += 700 * Math.pow(0.8, k / 12);
    expect(earningsValuePerUnit(a, { ...assumptions, discountRate: 0 })).toBeCloseTo(want, 6);
  });
  it('a month that would lose money counts as zero', () => {
    expect(earningsValuePerUnit({ ...flat, opexPerUnitMonth: 5_000 }, assumptions)).toBe(0);
    // rent falls below the running cost after about three years: the later months add nothing
    const fading = { ...flat, opexPerUnitMonth: 350, rentDeclinePerYear: 0.2 };
    expect(earningsValuePerUnit({ ...fading, lifeMonthsRemaining: 120 }, assumptions)).toBeCloseTo(earningsValuePerUnit({ ...fading, lifeMonthsRemaining: 60 }, assumptions), 6);
  });
  it('one sample H100 is worth more from its income than a forced sale would bring, and less than three times its price', () => {
    const v = earningsValuePerUnit(gpuCluster, assumptions);
    expect(v).toBeGreaterThan(gpuCluster.usedPriceToday * (1 - assumptions.forcedSaleHaircut)); expect(v).toBeLessThan(gpuCluster.usedPriceToday * 3);
  });
});

describe('the normal distribution and Black-76', () => {
  it('normCdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7); expect(normCdf(1.96)).toBeCloseTo(0.975002, 5); expect(normCdf(-1)).toBeCloseTo(0.158655, 5);
    for (const x of [0.3, 1.2, 2.5]) expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 9);
  });
  it('a put on forward 15000 × 0.75^1.5, strike 8000, vol 0.45, 18 months, 4% is about $1,105', () => {
    const { price, probUsed } = black76Put(15_000 * Math.pow(0.75, 1.5), 8_000, 0.45, 1.5, 0.04);
    expect(Math.abs(price - 1_105)).toBeLessThan(1); expect(probUsed).toBeCloseTo(0.4673, 3);
  });
  it('handles the edges: no time left, no volatility', () => {
    expect(black76Put(9_000, 10_000, 0.45, 0, 0.04)).toEqual({ price: 1_000, probUsed: 1 });
    expect(black76Put(11_000, 10_000, 0, 1, 0)).toEqual({ price: 0, probUsed: 0 });
  });
});

describe('the fee for the ladder', () => {
  const oneBid: Bid[] = [{ id: 'x', buyer: 'x', units: 64, pricePerUnit: 8_000, validThroughMonth: 18, fundedPct: 1 }];

  it('with one sale date the tree is within 1.5% of Black-76', () => {
    const perUnit = ladderFee(gpuCluster, oneBid, loanTerms, assumptions, { onlyMonth: 18 }) / 64;
    const exact = black76Put(15_000 * Math.pow(0.75, 1.5), 8_000, 0.45, 1.5, 0.04).price;
    expect(Math.abs(perUnit / exact - 1)).toBeLessThan(0.015);
    expect(Math.abs(perUnit - 1_105)).toBeLessThan(1_105 * 0.015);
  });
  it('the sample ladder costs about $98.8K at volatility 0.45, $51.6K at 0.30, $145.9K at 0.60', () => {
    const fee = (vol: number) => ladderFee({ ...gpuCluster, volatility: vol }, gpuBids, loanTerms, assumptions);
    expect(Math.abs(fee(0.45) - 98_800)).toBeLessThan(2_000);
    expect(Math.abs(fee(0.30) - 51_600)).toBeLessThan(2_000);
    expect(Math.abs(fee(0.60) - 145_900)).toBeLessThan(2_000);
  });
  it('rises with volatility and is zero with no bids', () => {
    let last = -1;
    for (const vol of [0.1, 0.2, 0.3, 0.45, 0.6, 0.8]) { const f = ladderFee({ ...gpuCluster, volatility: vol }, gpuBids, loanTerms, assumptions); expect(f).toBeGreaterThan(last); last = f; }
    expect(ladderFee(gpuCluster, [], loanTerms, assumptions)).toBe(0);
    expect(underwrite(gpuCluster, [], loanTerms, assumptions, noStress).fee).toBe(0);
  });
  it('the right to sell in any month is worth at least the right to sell in one month', () => {
    const any = ladderFee(gpuCluster, gpuBids, loanTerms, assumptions);
    for (const m of [6, 12, 18, 24, 36]) expect(any).toBeGreaterThanOrEqual(ladderFee(gpuCluster, gpuBids, loanTerms, assumptions, { onlyMonth: m }) - 1e-6);
  });
  it('is never below what selling today would gain', () => {
    const rich: Bid[] = [{ id: 'r', buyer: 'r', units: 64, pricePerUnit: 16_000, validThroughMonth: 3, fundedPct: 1 }];
    expect(ladderFee(gpuCluster, rich, loanTerms, assumptions)).toBeGreaterThanOrEqual(64 * 1_000);
  });
  it('more steps change it by less than half a percent', () => {
    const f8 = ladderFee(gpuCluster, gpuBids, loanTerms, assumptions), f32 = ladderFee(gpuCluster, gpuBids, loanTerms, assumptions, { stepsPerMonth: 32 });
    expect(Math.abs(f8 / f32 - 1)).toBeLessThan(0.005);
  });
  it('a promise for half the units costs half as much', () => {
    const half = oneBid.map((b) => ({ ...b, units: 32 }));
    expect(ladderFee(gpuCluster, half, loanTerms, assumptions)).toBeCloseTo(ladderFee(gpuCluster, oneBid, loanTerms, assumptions) / 2, 6);
  });
  it('counts only the funded part of a promise', () => {
    const halfFunded = oneBid.map((b) => ({ ...b, fundedPct: 0.5 })), halfPrice = oneBid.map((b) => ({ ...b, pricePerUnit: 4_000 }));
    expect(ladderFee(gpuCluster, halfFunded, loanTerms, assumptions)).toBeCloseTo(ladderFee(gpuCluster, halfPrice, loanTerms, assumptions), 6);
  });
  it('with no volatility it is the best discounted gain along the expected path', () => {
    const still = { ...gpuCluster, volatility: 0 };
    const high: Bid[] = [{ id: 'h', buyer: 'h', units: 64, pricePerUnit: 13_000, validThroughMonth: 24, fundedPct: 1 }];
    let best = 0;
    for (let m = 0; m <= 24; m++) best = Math.max(best, Math.exp((-assumptions.riskFree * m) / 12) * 64 * Math.max(0, 13_000 - expectedUnitValue(still, m)));
    expect(ladderFee(still, high, loanTerms, assumptions)).toBeCloseTo(best, 4);
  });
  it('ignores promises beyond the end of the loan', () => {
    const long: Bid[] = [{ id: 'l', buyer: 'l', units: 64, pricePerUnit: 5_000, validThroughMonth: 60, fundedPct: 1 }];
    const capped: Bid[] = [{ ...long[0], validThroughMonth: 36 }];
    expect(ladderFee(gpuCluster, long, loanTerms, assumptions)).toBeCloseTo(ladderFee(gpuCluster, capped, loanTerms, assumptions), 6);
  });
});

describe('a quote for one bid', () => {
  const bid: Bid = { id: 'q', buyer: 'q', units: 16, pricePerUnit: 8_000, validThroughMonth: 18, fundedPct: 1 };
  it('is Black-76 at the last month of the promise', () => {
    const q = quoteBid(gpuCluster, bid, assumptions);
    const forward = 15_000 * Math.pow(0.75, 1.5), exact = black76Put(forward, 8_000, 0.45, 1.5, 0.04);
    expect(q.feePerUnit).toBeCloseTo(exact.price, 9);
    expect(q.feeTotal).toBeCloseTo(exact.price * 16, 6);
    expect(q.probabilityUsed).toBeCloseTo(exact.probUsed, 9);
    expect(q.effectivePricePerUnit).toBeCloseTo(8_000 - exact.price, 9);
    expect(q.expectedValuePerUnit).toBeCloseTo(forward, 6);
    expect(Math.abs(q.feePerUnit - 1_105)).toBeLessThan(1);
  });
  it('a higher price is paid more and is used more often', () => {
    const lo = quoteBid(gpuCluster, bid, assumptions), hi = quoteBid(gpuCluster, { ...bid, pricePerUnit: 10_000 }, assumptions);
    expect(hi.feePerUnit).toBeGreaterThan(lo.feePerUnit); expect(hi.probabilityUsed).toBeGreaterThan(lo.probabilityUsed);
  });
  it('the fee stays between the discounted gain and the discounted price', () => {
    const rng = seeded(11);
    for (let k = 0; k < 200; k++) {
      const b = { ...bid, pricePerUnit: 2_000 + rng() * 18_000, validThroughMonth: Math.floor(rng() * 48) };
      const q = quoteBid(gpuCluster, b, assumptions), df = Math.exp((-assumptions.riskFree * b.validThroughMonth) / 12);
      expect(q.feePerUnit).toBeGreaterThanOrEqual(df * Math.max(0, b.pricePerUnit - q.expectedValuePerUnit) - 1e-3);
      expect(q.feePerUnit).toBeLessThanOrEqual(df * b.pricePerUnit + 1e-3);
      expect(q.probabilityUsed).toBeGreaterThanOrEqual(0); expect(q.probabilityUsed).toBeLessThanOrEqual(1);
    }
  });
  it('a promise that ends today pays only what it is worth today', () => {
    expect(quoteBid(gpuCluster, { ...bid, pricePerUnit: 16_000, validThroughMonth: 0 }, assumptions)).toMatchObject({ feePerUnit: 1_000, probabilityUsed: 1 });
    expect(quoteBid(gpuCluster, { ...bid, pricePerUnit: 9_000, validThroughMonth: 0 }, assumptions)).toMatchObject({ feePerUnit: 0, probabilityUsed: 0 });
  });
});

describe('when a new chip ships', () => {
  const at = (n: number | null, bids = gpuBids) => underwrite(gpuCluster, bids, loanTerms, assumptions, { ...noStress, chipShipsMonth: n });

  it('in month 12, without committed buyers the lender is forced to sell and loses money', () => {
    const u = at(12), s = u.stress!.withoutBids, p = u.path[12];
    expect(s.how).toBe('forced sale'); expect(s.defaultMonth).toBe(12);
    expect(s.owed).toBeCloseTo(balanceAt(704_000, loanTerms, 12), 6);
    expect(p.stressedValue).toBeCloseTo(gpuCluster.units * expectedUnitValue(gpuCluster, 12) * (1 - noStress.priceDrop), 6);
    expect(s.recovered).toBeCloseTo(p.stressedValue * (1 - assumptions.forcedSaleHaircut), 6);
    expect(s.lenderLoss).toBeCloseTo(s.owed - s.recovered, 6);
    expect(s.lenderLoss).toBeGreaterThan(200_000);
  });
  it('in month 12, with committed buyers the lender is repaid in full', () => {
    const s = at(12).stress!;
    expect(s.withBids.how).toBe('sold to committed buyer'); expect(s.withBids.defaultMonth).toBe(12);
    expect(s.withBids.owed).toBe(s.withoutBids.owed); // the same loan in both cases
    expect(s.withBids.recovered).toBeCloseTo(s.withBids.owed, 6); expect(s.withBids.lenderLoss).toBe(0);
  });
  it('whichever month the chip ships, the lender loses nothing with committed buyers', () => {
    for (let n = 1; n <= loanTerms.months; n++) expect(at(n).stress!.withBids.lenderLoss).toBe(0);
  });
  it('default is the first of two short months in a row, at or after the chip ships', () => {
    for (const n of [1, 9, 20]) {
      const u = at(n), dm = u.stress!.withoutBids.defaultMonth!;
      expect(dm).toBeGreaterThanOrEqual(n);
      for (const m of [dm, dm + 1]) expect(u.path[m].income).toBeLessThan(u.path[m].payment * assumptions.minDscr);
    }
  });
  it('one short month is not a default', () => {
    // the chip ships in the last month with a payment: there is no second short month
    const s = at(loanTerms.months - 1).stress!;
    expect(s.withoutBids).toEqual({ defaultMonth: null, owed: 0, recovered: 0, lenderLoss: 0, how: 'no default' });
    expect(s.withBids.how).toBe('no default');
  });
  it('a mild shock to a cluster with room to spare is survived; a stricter cover test turns it into a default', () => {
    const strong = { ...gpuCluster, ratePerHour: 4 }, mild = { chipShipsMonth: 6, priceDrop: 0.1, rentDrop: 0.1, utilizationDrop: 0 };
    const calm = underwrite(strong, gpuBids, loanTerms, assumptions, mild);
    for (const p of calm.path) expect(p.income).toBeGreaterThanOrEqual(p.payment);
    expect(calm.stress!.withoutBids.how).toBe('no default'); expect(calm.stress!.withBids.how).toBe('no default');

    const strict = underwrite(strong, gpuBids, loanTerms, { ...assumptions, minDscr: 3 }, mild);
    const short = (m: number) => strict.path[m].payment > 0 && strict.path[m].income < strict.path[m].payment * 3;
    let first = -1;
    for (let m = 6; m + 1 < strict.path.length && first < 0; m++) if (short(m) && short(m + 1)) first = m;
    expect(first).toBeGreaterThan(6); // the shock alone does not break the stricter test; the falling rent does, later
    expect(strict.stress!.withoutBids.defaultMonth).toBe(first);
    expect(short(first - 1)).toBe(false);
  });
  it('with no shock the sample cluster covers its payment in every month of the loan', () => {
    const path = underwrite(gpuCluster, gpuBids, loanTerms, assumptions, noStress).path;
    expect(path.filter((p) => p.payment > 0 && p.income < p.payment * assumptions.minDscr).map((p) => p.month)).toEqual([]);
  });
  it('with no bids at all, both outcomes are the forced sale of the bank loan', () => {
    const u = at(12, []), s = u.stress!;
    expect(s.withoutBids.owed).toBeCloseTo(balanceAt(480_000, loanTerms, 12), 6);
    expect(s.withBids).toEqual(s.withoutBids);
  });
  it('the stress lowers value, rent and use from the month the chip ships', () => {
    const calm = at(null).path, hit = at(12).path;
    expect(hit[11]).toEqual(calm[11]);
    expect(hit[12].stressedValue).toBeCloseTo(calm[12].expectedValue * (1 - noStress.priceDrop), 6);
    expect(hit[12].income).toBeLessThan(calm[12].income);
    expect(hit[12].balance).toBe(calm[12].balance);
  });
});

describe('the risk grade', () => {
  // the summary of src/data/records.sample.csv
  const records: RecordsSummary = { months: 14, avgUtilization: 0.719, utilizationStdev: 0.0665, avgRate: 2.6385, topCustomerShare: 0.4088, contractedShare: 0.679, latePayments: 3, refunds: 1, downtimeHours: 61 };
  const order = ['B', 'BB', 'BBB', 'A'];

  it('committed buyers move the sample cluster up one step, from BB to BBB', () => {
    const without = gradeRisk(gpuCluster, records, false), withBids = gradeRisk(gpuCluster, records, true);
    expect(without.grade).toBe('BB'); expect(withBids.grade).toBe('BBB');
    expect(order.indexOf(withBids.grade) - order.indexOf(without.grade)).toBe(1);
    expect(without.spread).toBe(0.07); expect(withBids.spread).toBe(0.05);
  });
  it('the score is the weighted sum of the four parts', () => {
    const g = gradeRisk(gpuCluster, records, false);
    expect(g.parts).toEqual({ industry: 59, stability: 59, counterparty: 34, redeploy: 88 });
    expect(g.score).toBe(Math.round(0.3 * 59 + 0.3 * 59 + 0.25 * 34 + 0.15 * 88));
    expect(g.score).toBe(57);
    expect(gradeRisk(gpuCluster, records, true)).toMatchObject({ score: 63, parts: { industry: 74, stability: 59, counterparty: 34, redeploy: 95 } });
  });
  it('the grade and the spread follow the table', () => {
    expect(gradeTable.map((g) => [g.grade, g.minScore, g.spread])).toEqual([['A', 75, 0.03], ['BBB', 60, 0.05], ['BB', 45, 0.07], ['B', 0, 0.10]]);
    const rng = seeded(5);
    for (let k = 0; k < 300; k++) {
      const r: RecordsSummary = { months: 3 + Math.floor(rng() * 30), avgUtilization: rng(), utilizationStdev: rng() * 0.3, avgRate: 1 + rng() * 3, topCustomerShare: rng(), contractedShare: rng(), latePayments: Math.floor(rng() * 8), refunds: Math.floor(rng() * 4), downtimeHours: rng() * 200 };
      const asset = rng() < 0.5 ? gpuCluster : weldingRobot;
      const lo = gradeRisk(asset, r, false), hi = gradeRisk(asset, r, true);
      for (const g of [lo, hi]) {
        expect(g.score).toBeGreaterThanOrEqual(0); expect(g.score).toBeLessThanOrEqual(100);
        for (const p of Object.values(g.parts)) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(100); }
        const row = gradeTable.find((t) => g.score >= t.minScore)!;
        expect(g.grade).toBe(row.grade); expect(g.spread).toBe(row.spread);
        expect(g.reason.trim().endsWith('.')).toBe(true); expect(g.reason).not.toMatch(/[\n]|\. /);
      }
      expect(hi.score).toBeGreaterThanOrEqual(lo.score); // bids never hurt
      expect(order.indexOf(hi.grade)).toBeGreaterThanOrEqual(order.indexOf(lo.grade));
    }
  });
  it('worse records score lower', () => {
    const base = gradeRisk(gpuCluster, records, false).score;
    expect(gradeRisk(gpuCluster, { ...records, topCustomerShare: 0.8 }, false).score).toBeLessThan(base);
    expect(gradeRisk(gpuCluster, { ...records, latePayments: 5 }, false).score).toBeLessThan(base);
    expect(gradeRisk(gpuCluster, { ...records, utilizationStdev: 0.3 }, false).score).toBeLessThan(base);
    expect(gradeRisk(gpuCluster, { ...records, months: 6 }, false).score).toBeLessThan(base);
    expect(gradeRisk(gpuCluster, { ...records, topCustomerShare: 0.1, latePayments: 0, refunds: 0, contractedShare: 0.8 }, false).score).toBeGreaterThan(base);
  });
  it('a shorter loan against the same useful life scores higher', () => {
    expect(gradeRisk(gpuCluster, records, false, 24).parts.industry).toBeGreaterThan(gradeRisk(gpuCluster, records, false, 48).parts.industry);
  });
  it('says why in one plain sentence, with numbers taken from the records', () => {
    expect(gradeRisk(gpuCluster, records, false).reason).toBe('A used GPU is easy to place with another user, but one customer is 41% of revenue and no buyer has committed to a resale price.');
    expect(gradeRisk(gpuCluster, records, true).reason).toBe('Committed buyers stand behind the resale price, but one customer is 41% of revenue.');
  });
});

describe('the largest covered loan, for random ladders and loan terms', () => {
  it('its balance never exceeds the guaranteed amount in any month, and a larger loan would', () => {
    const rng = seeded(2026);
    let covered = 0;
    for (let k = 0; k < 400; k++) {
      const units = 1 + Math.floor(rng() * 128);
      const asset: Asset = { ...gpuCluster, units, usedPriceToday: 2_000 + rng() * 30_000 };
      const loan: LoanTerms = { months: 6 + Math.floor(rng() * 55), baseRate: rng() * 0.08, spread: rng() * 0.1 };
      const bids: Bid[] = [];
      const count = 1 + Math.floor(rng() * 7);
      for (let b = 0; b < count; b++) {
        bids.push({
          id: `b${b}`, buyer: 'random', units: 1 + Math.floor(rng() * units * 1.5), pricePerUnit: Math.round(asset.usedPriceToday * (0.1 + rng())),
          validThroughMonth: Math.floor(rng() * (loan.months + 12)), fundedPct: rng() < 0.7 ? 1 : 0.25 + rng() * 0.75,
        });
      }
      if (rng() < 0.6) bids.push({ id: 'full', buyer: 'random', units, pricePerUnit: Math.round(asset.usedPriceToday * (0.1 + rng() * 0.5)), validThroughMonth: loan.months + 1, fundedPct: 1 });

      const { loan: principal, bindingMonth } = maxCommittedLoan(asset, bids, loan);
      expect(principal).toBeGreaterThanOrEqual(0);
      for (let m = 0; m < loan.months; m++) expect(balanceAt(principal, loan, m)).toBeLessThanOrEqual(guaranteedAt(bids, units, m) + 1e-6);
      const cap = asset.usedPriceToday * units * 2;
      if (principal + 2 < cap) {
        let broken = false;
        for (let m = 0; m < loan.months; m++) if (balanceAt(principal + 2, loan, m) > guaranteedAt(bids, units, m) + 1e-6) broken = true;
        expect(broken).toBe(true);
      }
      if (principal > 0) { covered++; expect(bindingMonth).not.toBeNull(); }
      // the full underwriting keeps the same promise on its path
      const u = underwrite(asset, bids, loan, assumptions, noStress);
      if (u.committedLoan > 0) for (const p of u.path) if (p.month < loan.months) expect(p.balance).toBeLessThanOrEqual(p.guaranteed + 1e-6);
    }
    expect(covered).toBeGreaterThan(100); // the test is not passing on empty cases
  });
});
