import { describe, expect, it } from 'vitest';
import { quoteBid } from '../src/lib/engine';
import { assumptions, gpuCluster, tradeAsset, tradeDeal } from '../src/data/samples';
import { checkoutBody, createCheckout, feeCents } from './stripe';

const deal = { asset: 'gpu' as const, units: tradeDeal.units, pricePerUnit: tradeDeal.pricePerUnit, months: tradeDeal.months };

describe('paying the fee through Stripe', () => {
  it('charges the fee the engine prices for the promise, in whole dollars', () => {
    const q = quoteBid(tradeAsset(gpuCluster), { id: 't', buyer: 'B', units: 1, pricePerUnit: 10_000, validThroughMonth: 6, fundedPct: 1 }, assumptions);
    expect(feeCents(deal)).toBe(Math.round(q.feeTotal) * 100);
  });

  it('the Trade example: a promise to buy one GPU at $10,000 for 6 months costs $500', () => {
    expect(feeCents(deal)).toBe(500_00);
  });

  it('builds a session form with that amount, the currency and the way back', () => {
    const b = checkoutBody(deal, 'http://localhost:5174');
    expect(b.get('mode')).toBe('payment');
    expect(b.get('line_items[0][price_data][unit_amount]')).toBe(String(feeCents(deal)));
    expect(b.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(b.get('success_url')).toBe('http://localhost:5174/?paid=1#/trade');
    expect(b.get('cancel_url')).toBe('http://localhost:5174/#/trade');
  });

  it('sends the key as a bearer token and returns the payment page', async () => {
    const seen: { url: string; auth: string }[] = [];
    const url = await createCheckout('sk_test_x', deal, 'http://localhost:5174', async (u, init) => {
      seen.push({ url: u, auth: init.headers.authorization });
      return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/test' }) };
    });
    expect(url).toBe('https://checkout.stripe.com/c/pay/test');
    expect(seen).toEqual([{ url: 'https://api.stripe.com/v1/checkout/sessions', auth: 'Bearer sk_test_x' }]);
  });

  it('refuses a promise that is out of range and passes on what Stripe says', async () => {
    expect(() => feeCents({ ...deal, units: 9999 })).toThrow();
    expect(() => feeCents({ ...deal, pricePerUnit: -1 })).toThrow();
    expect(() => feeCents({ ...deal, months: 0 })).toThrow();
    const refused = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key' } }) });
    await expect(createCheckout('sk_test_x', deal, 'http://x', refused)).rejects.toThrow('Invalid API Key');
  });
});
