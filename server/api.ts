// API routes. STUB: fixed sample answers in the shapes of src/lib/types.ts, so the web app can be built now.
// Owner: the backend conversation replaces these with live prices and the records analysis (see CONTRACT.md).
import { Router } from 'express';
import type { Analysis, PriceFeed } from '../src/lib/types';

export const api = Router();

const samplePrices: PriceFeed = {
  asOf: new Date().toISOString(),
  reference: { model: 'H100', price: 2.71, unit: '$/GPU-hour', method: 'median of sources' },
  sources: [
    { name: 'RunPod', price: 2.69, detail: 'lowest on-demand, H100 SXM', asOf: new Date().toISOString(), url: 'https://www.runpod.io/pricing' },
    { name: 'Akash', price: 2.73, detail: 'weighted average, H100 SXM5, 56 listed', asOf: new Date().toISOString(), url: 'https://akash.network/pricing/gpus/' },
  ],
  history: [],
  live: false,
};

const sampleAnalysis: Analysis = {
  summary: { months: 14, avgUtilization: 0.72, utilizationStdev: 0.09, avgRate: 2.62, topCustomerShare: 0.41, contractedShare: 0.35, latePayments: 3, refunds: 1, downtimeHours: 61 },
  flags: [
    { id: 'concentration', severity: 'high', title: 'One customer is 41% of revenue', detail: 'Customer C-07 pays for 41% of GPU-hours and has no contract past month 16.', rows: [118, 131, 144] },
    { id: 'late', severity: 'medium', title: 'Three invoices paid late', detail: 'Invoices in months 9, 11 and 12 were paid 30 to 47 days late.', rows: [97, 121, 133] },
    { id: 'downtime', severity: 'low', title: '61 hours of downtime in month 6', detail: 'A cooling fault took 16 GPUs offline for almost four days.', rows: [64] },
  ],
  memo: 'Utilisation is steady, but a third of revenue is contracted and one customer carries 41% of it.',
  source: 'stored',
};

api.get('/health', (_req, res) => { res.json({ ok: true }); });
api.get('/prices', (_req, res) => { res.json(samplePrices); });
api.post('/analyze', (_req, res) => { res.json(sampleAnalysis); });
