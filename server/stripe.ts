// Stripe Checkout for the fee a GPU owner pays a committed buyer. The secret key stays on the server,
// and the amount is priced here by the engine, never taken from the browser.
import { quoteBid } from '../src/lib/engine';
import { assumptions, gpuCluster, weldingRobot } from '../src/data/samples';
import type { AssetKind } from '../src/lib/types';
import { InputError } from './store';

export interface CheckoutInput { asset: AssetKind; units: number; pricePerUnit: number; months: number }

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const assetOf = (kind: AssetKind) => (kind === 'robot' ? weldingRobot : gpuCluster);
const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Checks the promise and returns the fee for it, in cents. */
export function feeCents(input: CheckoutInput): number {
  const asset = assetOf(input.asset);
  if (!isNumber(input.units) || !Number.isInteger(input.units) || input.units < 1 || input.units > asset.units) throw new InputError(`Units must be 1 to ${asset.units}.`);
  if (!isNumber(input.pricePerUnit) || input.pricePerUnit <= 0 || input.pricePerUnit > asset.usedPriceToday * 3) throw new InputError('The price is out of range.');
  if (!isNumber(input.months) || input.months < 1 || input.months > 60) throw new InputError('Months must be 1 to 60.');
  const q = quoteBid(asset, { id: 'checkout', buyer: 'Buyer', units: input.units, pricePerUnit: input.pricePerUnit, validThroughMonth: input.months, fundedPct: 1 }, assumptions);
  const cents = Math.round(q.feeTotal * 100);
  if (cents < 50 || cents > 99_999_999) throw new InputError('The fee is outside what one card payment can carry.');
  return cents;
}

/** The form Stripe expects for one Checkout Session. */
export function checkoutBody(input: CheckoutInput, origin: string): URLSearchParams {
  const asset = assetOf(input.asset);
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${origin}/?paid=1#/trade`);
  body.set('cancel_url', `${origin}/#/trade`);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(feeCents(input)));
  body.set(
    'line_items[0][price_data][product_data][name]',
    `Fee to the committed buyer: ${input.units} ${asset.unitLabel}${input.units === 1 ? '' : 's'} at $${input.pricePerUnit.toLocaleString('en-US')}, ${input.months} months`,
  );
  return body;
}

/** Creates the session and returns the address of Stripe's payment page. */
export async function createCheckout(secretKey: string, input: CheckoutInput, origin: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: checkoutBody(input, origin).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { url?: unknown; error?: { message?: unknown } };
  if (!res.ok || typeof data.url !== 'string') {
    throw new Error(`Stripe: ${typeof data.error?.message === 'string' ? data.error.message : `HTTP ${res.status}`}`);
  }
  return data.url;
}
