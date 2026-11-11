// Sample inputs. Everything here is labelled "Sample" on screen. Owner: the lead conversation.
import type { Asset, Assumptions, Bid, LoanTerms, Stress } from '../lib/types';

export const APP_NAME = 'Basis'; // shown in one place only

export const gpuCluster: Asset = {
  kind: 'gpu', name: '64 × Nvidia H100', units: 64, unitLabel: 'GPU',
  usedPriceToday: 15_000, depreciationPerYear: 0.25, volatility: 0.45, bankAdvanceRate: 0.5,
  ratePerHour: 2.71, utilization: 0.72, hoursPerMonth: 730, opexPerUnitMonth: 420, rentDeclinePerYear: 0.15, lifeMonthsRemaining: 46,
};

/** A ladder of committed buyers: each price sits below the expected resale value in its window. */
export const gpuBids: Bid[] = [
  { id: 'b1', buyer: 'Inference startup', units: 64, pricePerUnit: 11_000, validThroughMonth: 6, fundedPct: 1, sample: true },
  { id: 'b2', buyer: 'University lab', units: 64, pricePerUnit: 9_500, validThroughMonth: 12, fundedPct: 1, sample: true },
  { id: 'b3', buyer: 'Regional cloud', units: 64, pricePerUnit: 8_000, validThroughMonth: 18, fundedPct: 1, sample: true },
  { id: 'b4', buyer: 'Hardware reseller', units: 64, pricePerUnit: 6_500, validThroughMonth: 24, fundedPct: 1, sample: true },
  { id: 'b5', buyer: 'Hardware reseller', units: 64, pricePerUnit: 5_000, validThroughMonth: 36, fundedPct: 1, sample: true },
];

export const weldingRobot: Asset = {
  kind: 'robot', name: 'Welding robot cell', units: 1, unitLabel: 'robot',
  usedPriceToday: 1_000_000, depreciationPerYear: 0.12, volatility: 0.25, bankAdvanceRate: 0.45,
  ratePerHour: 500_000 / (12 * 400), utilization: 1, hoursPerMonth: 400, opexPerUnitMonth: 12_500, rentDeclinePerYear: 0.03, lifeMonthsRemaining: 120,
};

/** The maker's buy-back schedule plays the committed buyer. */
export const robotBids: Bid[] = [
  { id: 'r1', buyer: 'Maker buy-back', units: 1, pricePerUnit: 700_000, validThroughMonth: 12, fundedPct: 1, sample: true },
  { id: 'r2', buyer: 'Maker buy-back', units: 1, pricePerUnit: 560_000, validThroughMonth: 24, fundedPct: 1, sample: true },
  { id: 'r3', buyer: 'Maker buy-back', units: 1, pricePerUnit: 400_000, validThroughMonth: 36, fundedPct: 1, sample: true },
  { id: 'r4', buyer: 'Maker buy-back', units: 1, pricePerUnit: 240_000, validThroughMonth: 48, fundedPct: 1, sample: true },
];

export const loanTerms: LoanTerms = { months: 36, baseRate: 0.04, spread: 0.05 };
export const robotLoanTerms: LoanTerms = { months: 48, baseRate: 0.04, spread: 0.05 };
export const assumptions: Assumptions = { riskFree: 0.04, discountRate: 0.12, forcedSaleHaircut: 0.3, minDscr: 1.0 };
export const noStress: Stress = { chipShipsMonth: null, priceDrop: 0.5, rentDrop: 0.5, utilizationDrop: 0.25 };
