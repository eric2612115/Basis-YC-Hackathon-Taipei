// The engine: every dollar on screen comes from here. Pure functions, no I/O, runs in the browser and in tests.
// Owner: the backend conversation.
import type { Asset, Assumptions, Bid, BidQuote, Grade, LoanTerms, MonthPoint, RecordsSummary, RiskGrade, Stress, StressOutcome, Underwriting } from './types';

// ---------- The loan ----------

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

// ---------- The ladder of committed buyers ----------

/** One slice of the lot that a committed buyer takes in a given month: how many units, and the funded price per unit. */
interface Offer { units: number; price: number }

/**
 * The bids that are valid in `month`, best funded prices first, cut off at `units`.
 * Ordering by the funded price means one more bid can never lower what the lot is guaranteed to fetch.
 */
function offersAt(bids: Bid[], units: number, month: number): Offer[] {
  const out: Offer[] = [];
  let left = units;
  for (const b of bids.filter((x) => month <= x.validThroughMonth).sort((a, z) => z.pricePerUnit * z.fundedPct - a.pricePerUnit * a.fundedPct)) {
    const take = Math.min(left, b.units);
    if (take > 0) out.push({ units: take, price: b.pricePerUnit * b.fundedPct });
    left -= take;
    if (left <= 0) break;
  }
  return out;
}

/** What committed buyers would pay for the whole lot in `month`: best funded prices first, funded part only, up to `units`. */
export function guaranteedAt(bids: Bid[], units: number, month: number): number {
  let total = 0;
  for (const o of offersAt(bids, units, month)) total += o.units * o.price;
  return total;
}

/** Expected resale value of one unit in `month`. */
export function expectedUnitValue(asset: Asset, month: number): number {
  return asset.usedPriceToday * Math.pow(1 - asset.depreciationPerYear, month / 12);
}

/**
 * What a lender can count on in `month`: what committed buyers would pay, or, where no buyer is committed (or pays
 * less), what a bank counts on, the bank's share of the expected resale value.
 */
export function coverAt(asset: Asset, bids: Bid[], month: number): number {
  return Math.max(guaranteedAt(bids, asset.units, month), expectedUnitValue(asset, month) * asset.units * asset.bankAdvanceRate);
}

/**
 * The largest loan whose balance never rises above the cover. Each buyer lifts the cover in the months of its promise,
 * so each new buyer can raise the loan. With no bids it is the bank loan.
 */
export function maxCommittedLoan(asset: Asset, bids: Bid[], loan: LoanTerms): { loan: number; bindingMonth: number | null } {
  if (bids.length === 0) return { loan: asset.usedPriceToday * asset.units * asset.bankAdvanceRate, bindingMonth: null };
  const cover: number[] = [];
  for (let m = 0; m < loan.months; m++) cover.push(coverAt(asset, bids, m));
  if (cover.length === 0) return { loan: 0, bindingMonth: null };
  const ok = (p: number) => { for (let m = 0; m < cover.length; m++) if (balanceAt(p, loan, m) > cover[m] + 1e-6) return false; return true; };
  let lo = 0, hi = cover[0] + 1; // in month 0 the balance is the loan itself, so the loan cannot be above that month's cover
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  const principal = Math.floor(lo); // round down, so the balance never sits above the cover
  let bindingMonth: number | null = null, best = Infinity;
  for (let m = 0; m < cover.length; m++) { const gap = cover[m] - balanceAt(principal, loan, m); if (gap < best) { best = gap; bindingMonth = m; } }
  return { loan: principal, bindingMonth };
}

// ---------- Value from income ----------

/** Value of one unit from the income it has left: each month's net rent, never below zero, discounted monthly. */
export function earningsValuePerUnit(asset: Asset, a: Assumptions): number {
  let pv = 0;
  for (let k = 1; k <= asset.lifeMonthsRemaining; k++) {
    const net = asset.ratePerHour * Math.pow(1 - asset.rentDeclinePerYear, k / 12) * asset.hoursPerMonth * asset.utilization - asset.opexPerUnitMonth;
    if (net > 0) pv += net / Math.pow(1 + a.discountRate / 12, k);
  }
  return pv;
}

// ---------- Pricing the promise ----------

/** Standard normal distribution function (Abramowitz and Stegun 7.1.26; error below 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Black-76 put on a forward price: its value today and the chance it is used. */
export function black76Put(forward: number, strike: number, vol: number, years: number, rate: number): { price: number; probUsed: number } {
  const df = Math.exp(-rate * years), sd = vol * Math.sqrt(Math.max(0, years));
  if (!(strike > 0)) return { price: 0, probUsed: 0 };
  if (!(forward > 0)) return { price: df * strike, probUsed: 1 };
  if (!(sd > 0)) return { price: df * Math.max(0, strike - forward), probUsed: strike > forward ? 1 : 0 };
  const d1 = (Math.log(forward / strike) + 0.5 * sd * sd) / sd, d2 = d1 - sd;
  return { price: df * (strike * normCdf(-d2) - forward * normCdf(-d1)), probUsed: normCdf(-d2) };
}

export interface TreeOptions {
  stepsPerMonth?: number; // at least 4; default 8
  onlyMonth?: number;     // allow the sale in this one month only (used to check the tree against Black-76)
}

/**
 * What the buyers charge for the whole ladder.
 * The owner may sell once, in any whole month, to the buyers whose promise is valid that month, at their prices.
 * Priced on a recombining binomial tree for the resale price: it starts at today's price, its expected path falls with
 * depreciation, it moves up or down with equal chance each step, and values are discounted at the risk-free rate.
 * With every unit covered by one price this is the right to sell at `guaranteedAt ÷ units` per unit.
 */
export function ladderFee(asset: Asset, bids: Bid[], loan: LoanTerms, a: Assumptions, opts: TreeOptions = {}): number {
  if (bids.length === 0) return 0;
  const lastMonth = Math.floor(Math.min(loan.months, Math.max(...bids.map((b) => b.validThroughMonth))));
  if (!(lastMonth >= 0)) return 0;
  const spm = Math.max(4, Math.round(opts.stepsPerMonth ?? 8));
  const n = lastMonth * spm, dt = 1 / (12 * spm);
  const s = Math.max(0, asset.volatility) * Math.sqrt(dt);
  const grow = Math.pow(Math.max(0, 1 - asset.depreciationPerYear), dt); // expected change of the price over one step
  const down = (grow * Math.exp(-s)) / Math.cosh(s), ratio = Math.exp(2 * s); // up = down × ratio; (up + down) / 2 = grow
  const disc = Math.exp(-a.riskFree * dt);

  const offers: Offer[][] = [];
  for (let m = 0; m <= lastMonth; m++) offers.push(opts.onlyMonth === undefined || opts.onlyMonth === m ? offersAt(bids, asset.units, m) : []);
  const saleGain = (m: number, price: number) => { let g = 0; for (const o of offers[m]) if (o.price > price) g += o.units * (o.price - price); return g; };

  // value[j] at step i is the value of the right at the node with j up-moves; price there = today × down^i × ratio^j
  const value = new Float64Array(n + 1);
  for (let j = 0, p = asset.usedPriceToday * Math.pow(down, n); j <= n; j++, p *= ratio) value[j] = saleGain(lastMonth, p);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= i; j++) value[j] = disc * 0.5 * (value[j] + value[j + 1]);
    if (i % spm === 0 && offers[i / spm].length > 0) {
      const m = i / spm;
      for (let j = 0, p = asset.usedPriceToday * Math.pow(down, i); j <= i; j++, p *= ratio) { const g = saleGain(m, p); if (g > value[j]) value[j] = g; }
    }
  }
  return value[0];
}

/** What one new promise to buy is worth: Black-76 at the promise's last month. */
export function quoteBid(asset: Asset, bid: Bid, a: Assumptions): BidQuote {
  const years = Math.max(0, bid.validThroughMonth) / 12;
  const expected = expectedUnitValue(asset, Math.max(0, bid.validThroughMonth));
  const { price: fee, probUsed } = black76Put(expected, bid.pricePerUnit, asset.volatility, years, a.riskFree);
  return { feePerUnit: fee, feeTotal: fee * bid.units, probabilityUsed: probUsed, effectivePricePerUnit: bid.pricePerUnit - fee, expectedValuePerUnit: expected };
}

// ---------- Underwriting ----------

const noDefault: StressOutcome = { defaultMonth: null, owed: 0, recovered: 0, lenderLoss: 0, how: 'no default' };

/**
 * What happens to the lender when a new chip ships.
 * Default is the first month, at or after the chip ships, that starts two months in a row where income does not cover
 * the payment. Both outcomes use the same loan, so they can be compared.
 */
function stressOutcomes(path: MonthPoint[], a: Assumptions, chipShipsMonth: number): { withoutBids: StressOutcome; withBids: StressOutcome } {
  const short = (p: MonthPoint | undefined) => !!p && p.payment > 0 && p.income < p.payment * a.minDscr;
  let dm: number | null = null;
  for (let m = Math.max(0, Math.ceil(chipShipsMonth)); m + 1 < path.length; m++) if (short(path[m]) && short(path[m + 1])) { dm = m; break; }
  if (dm === null) return { withoutBids: { ...noDefault }, withBids: { ...noDefault } };

  const at = path[dm], owed = at.balance;
  const forced = at.stressedValue * (1 - a.forcedSaleHaircut);
  const withoutBids: StressOutcome = { defaultMonth: dm, owed, recovered: forced, lenderLoss: Math.max(0, owed - forced), how: 'forced sale' };
  // With no buyer committed that month, or a buyer who pays less than a forced sale would, the lender is back to the forced sale.
  const covered = at.guaranteed > 0 && (at.guaranteed >= owed || at.guaranteed >= forced);
  const withBids: StressOutcome = covered
    ? { defaultMonth: dm, owed, recovered: Math.min(owed, at.guaranteed), lenderLoss: Math.max(0, owed - at.guaranteed), how: 'sold to committed buyer' }
    : { ...withoutBids };
  return { withoutBids, withBids };
}

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
    const guaranteed = guaranteedAt(bids, asset.units, m);
    path.push({
      month: m, balance: balanceAt(principal, loan, m), guaranteed, expectedValue: ev,
      cover: coverAt(asset, bids, m), // committed buyers, or the bank's share of the expected value where that is more
      stressedValue: hit ? ev * (1 - stress.priceDrop) : ev,
      income: asset.units * (rate * asset.hoursPerMonth * util - asset.opexPerUnitMonth), payment: m < loan.months ? pay : 0,
    });
  }
  const fee = bids.length ? ladderFee(asset, bids, loan, a) : 0;
  return {
    bankLoan, committedLoan, bindingMonth, monthlyPayment: pay, fee, feePerYearPct: committedLoan ? fee / committedLoan / (loan.months / 12) : 0,
    earningsValuePerUnit: earningsValuePerUnit(asset, a), path,
    stress: stress.chipShipsMonth === null ? null : stressOutcomes(path, a, stress.chipShipsMonth),
  };
}

// ---------- Risk grade ----------

/** The grade table: lowest score for each grade and the yearly spread it pays over the base rate. */
export const gradeTable: { grade: Grade; minScore: number; spread: number }[] = [
  { grade: 'A', minScore: 75, spread: 0.03 },
  { grade: 'BBB', minScore: 60, spread: 0.05 },
  { grade: 'BB', minScore: 45, spread: 0.07 },
  { grade: 'B', minScore: 0, spread: 0.10 },
];

/** The assumptions behind the score, in one place. */
export const gradeWeights = { industry: 0.30, stability: 0.30, counterparty: 0.25, redeploy: 0.15 };
const REFERENCE_LOAN_MONTHS = 36;                 // life is judged against this loan length unless one is passed in
const COVERED_PRICE_SCORE = 85;                   // price score once committed buyers stand behind the resale price
const COVERED_REDEPLOY_SCORE = 95;                // a buyer has already agreed to take the machines
const REDEPLOY_BASE: Record<Asset['kind'], number> = { gpu: 88, robot: 45 }; // general-purpose GPU vs a cell with custom tooling

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Risk grade from four parts, each 0 to 100:
 *   industry     = half life score (useful life ÷ loan length × 50, at most 100) + half price score (100 − volatility × 100)
 *   stability    = 100 × (average use − its month-to-month swing) − downtime − short history
 *   counterparty = 100 − biggest customer's share − late payments and refunds + share of revenue under contract
 *   redeploy     = how easily the machines find another user or buyer
 * Committed buyers lift the price score and the redeploy score, which can move the grade up one step.
 */
export function gradeRisk(asset: Asset, records: RecordsSummary, hasBids: boolean, loanMonths: number = REFERENCE_LOAN_MONTHS): RiskGrade {
  const lifeScore = Math.min(100, (asset.lifeMonthsRemaining / Math.max(1, loanMonths)) * 50);
  const priceScore = hasBids ? COVERED_PRICE_SCORE : 100 - Math.min(100, asset.volatility * 100);
  const industry = Math.round(clamp(0.5 * lifeScore + 0.5 * priceScore));

  const downtimePenalty = Math.min(10, records.downtimeHours / 10);
  const shortHistoryPenalty = records.months < 12 ? 10 : 0;
  const stability = Math.round(clamp(100 * (records.avgUtilization - records.utilizationStdev) - downtimePenalty - shortHistoryPenalty));

  const concentrationPenalty = 100 * records.topCustomerShare;
  const paymentPenalty = Math.min(40, 8 * (records.latePayments + records.refunds));
  const contractBonus = 10 * records.contractedShare;
  const counterparty = Math.round(clamp(100 - concentrationPenalty - paymentPenalty + contractBonus));

  const redeploy = Math.round(clamp(hasBids ? Math.max(REDEPLOY_BASE[asset.kind], COVERED_REDEPLOY_SCORE) : REDEPLOY_BASE[asset.kind]));

  const parts = { industry, stability, counterparty, redeploy };
  const w = gradeWeights;
  const score = Math.round(clamp(w.industry * industry + w.stability * stability + w.counterparty * counterparty + w.redeploy * redeploy));
  const row = gradeTable.find((g) => score >= g.minScore) ?? gradeTable[gradeTable.length - 1];

  // One plain sentence: the best thing about this lot, then the weakest.
  const weak: Record<keyof typeof parts, string> = {
    industry: `the resale price can move ${pct(asset.volatility)} in a year`,
    stability: `use swings around an average of ${pct(records.avgUtilization)}`,
    counterparty: records.topCustomerShare >= 0.25 ? `one customer is ${pct(records.topCustomerShare)} of revenue`
      : records.latePayments + records.refunds > 0 ? `${records.latePayments} late payments and ${records.refunds} refunds are on record`
      : 'little of the revenue is under contract',
    redeploy: `a used ${asset.unitLabel} like this is hard to place with another user`,
  };
  const strong: Record<keyof typeof parts, string> = {
    industry: 'The machines have a long useful life',
    stability: 'Use is steady',
    counterparty: 'Customers pay on time and are spread out',
    redeploy: `A used ${asset.unitLabel} is easy to place with another user`,
  };
  const keys = Object.keys(parts) as (keyof typeof parts)[];
  const weakest = keys.reduce((x, y) => (parts[y] < parts[x] ? y : x));
  const strongest = keys.reduce((x, y) => (parts[y] > parts[x] ? y : x));
  const reason = hasBids
    ? `Committed buyers stand behind the resale price, but ${weak[weakest]}.`
    : `${strong[strongest]}, but ${weak[weakest]} and no buyer has committed to a resale price.`;

  return { grade: row.grade, score, parts, spread: row.spread, reason };
}
