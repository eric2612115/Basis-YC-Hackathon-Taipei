// The engine: every dollar on screen comes from here. Pure functions, no I/O, runs in the browser and in tests.
// Owner: the backend conversation. The parts marked STUB return fixed sample values until they are implemented.
import type { Asset, Assumptions, Bid, BidQuote, LoanTerms, MonthPoint, RecordsSummary, RiskGrade, Stress, StressOutcome, Underwriting } from './types';

export const annualRate = (loan: LoanTerms) => loan.baseRate + loan.spread;

/** Level monthly payment of a loan. */
export function monthlyPayment(principal: number, loan: LoanTerms): number {
  const i = annualRate(loan) / 12;
  return i === 0 ? principal / loan.months : (principal * i) / (1 - Math.pow(1 + i, -loan.months));
}

/** Balance still owed after `month` payments. */
export function balanceAt(principal: number, loan: LoanTerms, month: number): number {
  const i = annualRate(loan) / 12, pay = monthlyPayment(principal, loan);
  if (month >= loan.months) return 0;
  return i === 0 ? principal - pay * month : principal * Math.pow(1 + i, month) - (pay * (Math.pow(1 + i, month) - 1)) / i;
}

/** What committed buyers would pay for the whole lot in `month`: best prices first, funded part only, up to `units`. */
export function guaranteedAt(bids: Bid[], units: number, month: number): number {
  let left = units, total = 0;
  for (const b of bids.filter((x) => month <= x.validThroughMonth).sort((a, z) => z.pricePerUnit - a.pricePerUnit)) {
    const take = Math.min(left, b.units);
    total += take * b.pricePerUnit * b.fundedPct; left -= take;
    if (left <= 0) break;
  }
  return total;
}

/** Expected resale value of one unit in `month`. */
export const expectedUnitValue = (asset: Asset, month: number) => asset.usedPriceToday * Math.pow(1 - asset.depreciationPerYear, month / 12);

/** The largest loan whose balance never rises above the guaranteed amount. */
export function maxCommittedLoan(asset: Asset, bids: Bid[], loan: LoanTerms): { loan: number; bindingMonth: number | null } {
  if (bids.length === 0) return { loan: 0, bindingMonth: null };
  const ok = (p: number) => { for (let m = 0; m < loan.months; m++) if (balanceAt(p, loan, m) > guaranteedAt(bids, asset.units, m) + 1e-6) return false; return true; };
  let lo = 0, hi = asset.usedPriceToday * asset.units * 2;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  let bindingMonth: number | null = null, best = Infinity;
  for (let m = 0; m < loan.months; m++) { const gap = guaranteedAt(bids, asset.units, m) - balanceAt(lo, loan, m); if (gap < best) { best = gap; bindingMonth = m; } }
  return { loan: Math.round(lo), bindingMonth };
}

/** STUB: value of one unit from the income it has left (PV of net rent). */
export function earningsValuePerUnit(_asset: Asset, _a: Assumptions): number { return 13_800; }

/** STUB: what the buyers charge for the whole ladder (a put the owner may use once, in any month, at that month's price). */
export function ladderFee(_asset: Asset, _bids: Bid[], _loan: LoanTerms, _a: Assumptions): number { return 98_800; }

/** STUB: stress outcomes. */
function outcome(how: StressOutcome['how']): StressOutcome { return { defaultMonth: null, owed: 0, recovered: 0, lenderLoss: 0, how }; }

export function underwrite(asset: Asset, bids: Bid[], loan: LoanTerms, a: Assumptions, stress: Stress): Underwriting {
  const bankLoan = asset.usedPriceToday * asset.units * asset.bankAdvanceRate;
  const { loan: committedLoan, bindingMonth } = maxCommittedLoan(asset, bids, loan);
  const principal = committedLoan || bankLoan, pay = monthlyPayment(principal, loan);
  const path: MonthPoint[] = [];
  for (let m = 0; m <= loan.months; m++) {
    const ev = expectedUnitValue(asset, m) * asset.units;
    const hit = stress.chipShipsMonth !== null && m >= stress.chipShipsMonth;
    const rate = asset.ratePerHour * Math.pow(1 - asset.rentDeclinePerYear, m / 12) * (hit ? 1 - stress.rentDrop : 1);
    const util = asset.utilization * (hit ? 1 - stress.utilizationDrop : 1);
    path.push({
      month: m, balance: balanceAt(principal, loan, m), guaranteed: guaranteedAt(bids, asset.units, m), expectedValue: ev,
      stressedValue: hit ? ev * (1 - stress.priceDrop) : ev,
      income: asset.units * (rate * asset.hoursPerMonth * util - asset.opexPerUnitMonth), payment: m < loan.months ? pay : 0,
    });
  }
  const fee = bids.length ? ladderFee(asset, bids, loan, a) : 0;
  return {
    bankLoan, committedLoan, bindingMonth, monthlyPayment: pay, fee, feePerYearPct: committedLoan ? fee / committedLoan / (loan.months / 12) : 0,
    earningsValuePerUnit: earningsValuePerUnit(asset, a), path,
    stress: stress.chipShipsMonth === null ? null : { withoutBids: outcome('forced sale'), withBids: outcome('sold to committed buyer') },
  };
}

/** STUB: what one new promise to buy is worth to the buyer. */
export function quoteBid(asset: Asset, bid: Bid, _a: Assumptions): BidQuote {
  const ev = expectedUnitValue(asset, bid.validThroughMonth), fee = bid.pricePerUnit * 0.1;
  return { feePerUnit: fee, feeTotal: fee * bid.units, probabilityUsed: 0.4, effectivePricePerUnit: bid.pricePerUnit - fee, expectedValuePerUnit: ev };
}

/** STUB: risk grade from the records. */
export function gradeRisk(_asset: Asset, _records: RecordsSummary, _hasBids: boolean): RiskGrade {
  return { grade: 'BBB', score: 66, parts: { industry: 48, stability: 71, counterparty: 62, redeploy: 88 }, spread: 0.05, reason: 'Steady use, but one customer is 41% of revenue.' };
}
