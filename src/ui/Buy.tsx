// Buy: for someone who wants used machines at a discount. Commit to a price, get paid today, and the lender can lend against it.
import { useMemo, useState } from 'react';
import { quoteBid } from '../lib/engine';
import { useStore } from './store';
import { BidList } from './Bids';
import { NumberField } from './fields';
import { cap, pct, usd, usdShort } from './format';

export function Buy() {
  const { kind, asset, assumptions, bids, board, postBid, removeBid, ownBid } = useStore();
  const [units, setUnits] = useState(asset.units);
  const [price, setPrice] = useState(kind === 'gpu' ? 7_000 : 500_000);
  const [months, setMonths] = useState(kind === 'gpu' ? 24 : 36);
  const [buyer, setBuyer] = useState('');
  const [contact, setContact] = useState('');
  const [state, setState] = useState<'idle' | 'posting' | 'posted' | 'error'>('idle');
  const [err, setErr] = useState('');
  const unit = asset.unitLabel;
  const valid = units >= 1 && units <= asset.units && price > 0 && price <= asset.usedPriceToday * 3 && months >= 1 && months <= 60;

  const q = useMemo(
    () =>
      valid
        ? quoteBid(asset, { id: 'draft', buyer: 'You', units, pricePerUnit: price, validThroughMonth: months, fundedPct: 1 }, assumptions)
        : null,
    [asset, units, price, months, assumptions, valid],
  );

  return (
    <div className="view">
      <p className="lede">Want used {unit}s at a discount? Commit to a price and get paid today.</p>

      <section className="block first">
        <div className="buy-inputs">
          <NumberField big label={`${cap(unit)}s`} integer value={units} min={1} max={asset.units} onChange={setUnits} />
          <NumberField big label={`Price per ${unit}`} prefix="$" value={price} min={1} max={asset.usedPriceToday * 3} onChange={setPrice} />
          <NumberField big label="Until month" integer value={months} min={1} max={60} onChange={setMonths} />
        </div>

        {q && (
          <div className="quote">
            <div className="figure accent">
              <div className="label">You are paid today</div>
              <div className="big num">{usdShort(q.feeTotal)}</div>
              <div className="sub">
                {usd(q.feePerUnit)} per {unit}
              </div>
            </div>
            <div className="figure">
              <div className="label">Chance you end up buying</div>
              <div className="big num">{pct(q.probabilityUsed)}</div>
              <div className="sub">
                If the resale price is under {usd(price)} in month {months}
              </div>
            </div>
            <div className="figure">
              <div className="label">Your effective price</div>
              <div className="big num">{usd(q.effectivePricePerUnit)}</div>
              <div className="sub">
                Expected resale value then: {usd(q.expectedValuePerUnit)}
              </div>
            </div>
          </div>
        )}
        <p className="meta">Indicative. Not an offer.</p>

        <form
          className="commit"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            setState('posting');
            try {
              await postBid({ buyer: buyer.trim(), contact: contact.trim() || undefined, units, pricePerUnit: price, validThroughMonth: months });
              setBuyer('');
              setContact('');
              setState('posted');
            } catch (x) {
              setErr(x instanceof Error ? x.message : 'Could not post the bid. Try again.');
              setState('error');
            }
          }}
        >
          <input required minLength={2} maxLength={60} placeholder="Your name or company" aria-label="Your name or company" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          <input type="email" maxLength={120} placeholder="Email (optional, never shown)" aria-label="Email, optional" value={contact} onChange={(e) => setContact(e.target.value)} />
          <button type="submit" className="btn" disabled={!valid || state === 'posting'}>
            {state === 'posting' ? 'Committing…' : 'Commit'}
          </button>
        </form>
        {state === 'posted' && (
          <p className="meta good-text">
            Posted. Lenders now count it. <a href="#/borrow">See Borrow</a>
          </p>
        )}
        {state === 'error' && <p className="meta bad-text">{err}</p>}
      </section>

      <section className="block">
        <h2>Committed buyers</h2>
        <p className="meta">
          {board === 'local'
            ? 'The shared board is offline, so new bids stay in this browser for now.'
            : 'Everyone who opens this page sees the same board.'}
        </p>
        <BidList bids={bids} own={ownBid} onRemove={(id) => void removeBid(id).catch(() => undefined)} />
      </section>
    </div>
  );
}
