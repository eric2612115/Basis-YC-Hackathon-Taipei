// Shared types. This file is the contract between the engine (src/lib), the server (server/) and the UI (src/ui).
// Change it deliberately: all three depend on these shapes.
// Money is in US dollars; rates and shares are fractions (0.25 = 25%); time is in months from today (month 0).

export type AssetKind = 'gpu' | 'robot';

export interface Asset {
  kind: AssetKind;
  name: string;                 // "64 × Nvidia H100"
  units: number;                // 64 (a robot cell: 1)
  unitLabel: string;            // "GPU" | "robot"
  usedPriceToday: number;       // resale price per unit today
  depreciationPerYear: number;  // expected fall of the resale price per year
  volatility: number;           // yearly volatility of the resale price
  bankAdvanceRate: number;      // share of today's resale value a bank lends
  ratePerHour: number;          // what one unit earns per hour in use
  utilization: number;          // share of hours in use
  hoursPerMonth: number;        // 730
  opexPerUnitMonth: number;     // running cost per unit per month
  rentDeclinePerYear: number;   // expected fall of the hourly rate per year
  lifeMonthsRemaining: number;  // months of useful life left
}

/** A buyer's promise to buy `units` at `pricePerUnit` at any time up to `validThroughMonth`. */
export interface Bid {
  id: string;
  buyer: string;
  units: number;
  pricePerUnit: number;
  validThroughMonth: number;
  fundedPct: number;            // share of the purchase money already set aside (1 = fully funded)
  sample?: boolean;             // seeded example, not posted by a visitor
  postedAt?: string;            // ISO time, set by the server for bids posted by visitors
}

/** What a visitor sends to post a bid. The server adds id, postedAt and fundedPct, and never returns `contact`. */
export interface BidInput { asset: AssetKind; buyer: string; contact?: string; units: number; pricePerUnit: number; validThroughMonth: number }
/** The shared bid board for one kind of asset: the seeded sample ladder plus bids posted by visitors. */
export interface BidBook { asset: AssetKind; bids: Bid[]; asOf: string }
/** Someone asking for this to be run on their own machines. */
export interface LeadInput { name: string; email: string; note?: string }

export interface LoanTerms { months: number; baseRate: number; spread: number }
export interface Assumptions { riskFree: number; discountRate: number; forcedSaleHaircut: number; minDscr: number }
export interface Stress { chipShipsMonth: number | null; priceDrop: number; rentDrop: number; utilizationDrop: number }

export interface MonthPoint {
  month: number;
  balance: number;        // loan still owed at the start of the month
  guaranteed: number;     // what committed buyers would pay for the whole lot this month
  cover?: number;         // what a lender can count on this month: the guaranteed amount, or where no buyer is committed, the bank's share of the expected value
  expectedValue: number;  // expected resale value of the lot
  stressedValue: number;  // resale value of the lot under the stress (equals expectedValue with no stress)
  income: number;         // net income of the lot this month, under the stress
  payment: number;        // loan payment this month
}

export interface StressOutcome {
  defaultMonth: number | null;
  owed: number;
  recovered: number;
  lenderLoss: number;
  how: 'no default' | 'forced sale' | 'sold to committed buyer';
}

export interface Underwriting {
  bankLoan: number;               // today's resale value × the bank's advance rate
  committedLoan: number;          // largest loan whose balance never exceeds the guaranteed amount; 0 without bids
  bindingMonth: number | null;    // the month where the balance touches the guaranteed amount
  monthlyPayment: number;
  fee: number;                    // what the committed buyers charge for the whole ladder
  feePerYearPct: number;          // fee ÷ loan ÷ years
  earningsValuePerUnit: number;   // value of one unit from the income it has left
  path: MonthPoint[];             // months 0..loan.months
  stress: { withoutBids: StressOutcome; withBids: StressOutcome } | null;
}

export interface BidQuote {
  feePerUnit: number;             // what the buyer is paid today for the promise
  feeTotal: number;
  probabilityUsed: number;        // chance the owner ends up selling at this price
  effectivePricePerUnit: number;  // price − fee
  expectedValuePerUnit: number;   // expected resale value at the end of the promise
}

export type Grade = 'A' | 'BBB' | 'BB' | 'B';
export interface RiskGrade {
  grade: Grade;
  score: number;                  // 0..100
  parts: { industry: number; stability: number; counterparty: number; redeploy: number };
  spread: number;                 // yearly spread this grade pays over the base rate
  reason: string;                 // one plain sentence
}

export interface RecordsSummary {
  months: number; avgUtilization: number; utilizationStdev: number; avgRate: number;
  topCustomerShare: number; contractedShare: number; latePayments: number; refunds: number; downtimeHours: number;
}
export interface Flag { id: string; severity: 'high' | 'medium' | 'low'; title: string; detail: string; rows: number[] }
/** source: 'model' = read by the model; 'stored' = the saved analysis of the sample; 'rules' = checked by rules in code, no model. */
export interface Analysis { summary: RecordsSummary; flags: Flag[]; memo: string; source: 'model' | 'stored' | 'rules'; model?: string }

export interface PriceSource { name: string; price: number; detail: string; asOf: string; url: string }
export interface PriceFeed {
  asOf: string;
  reference: { model: string; price: number; unit: string; method: string };
  sources: PriceSource[];
  history: { t: string; price: number }[];
  live: boolean;                  // false when the server is answering from a stored sample
}
