// Trade: one deal seen from both sides. The buyer posts a bid, the owner asks for a price, they match;
// then the buyer earns the fee and the owner is covered while the GPU's resale price moves.
// Every number comes from the engine; the price path is a scenario the visitor picks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { expectedUnitValue, quoteBid } from '../lib/engine';
import { useStore } from './store';
import { tradeAsset, tradeDeal } from '../data/samples';
import { pct, usd, usdShort } from './format';
import { useCountUp } from './hooks';
import '../styles/trade.css';

const MONTHS = 6;
type Path = 'fall' | 'hold';
/** True when the visitor has just come back from Stripe's payment page. */
const cameBackPaid = () => new URLSearchParams(window.location.search).get('paid') === '1';

export function Trade() {
  const store = useStore();
  const { assumptions, kind } = store;
  const asset = tradeAsset(store.asset);
  const gpu = asset.kind === 'gpu';
  const units = gpu ? tradeDeal.units : asset.units;
  const price = gpu ? tradeDeal.pricePerUnit : Math.round((asset.usedPriceToday * 11) / 15 / 100) * 100;
  const one = units === 1;
  const [feePaid, setFeePaid] = useState(cameBackPaid);
  const [bid, setBid] = useState(feePaid);
  const [ask, setAsk] = useState(feePaid);
  const [canPay, setCanPay] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [path, setPath] = useState<Path>('fall');
  const [month, setMonth] = useState(0);
  const matched = bid && ask;
  const raf = useRef(0);

  const q = useMemo(() => quoteBid(asset, { id: 'trade', buyer: 'Buyer', units, pricePerUnit: price, validThroughMonth: MONTHS, fundedPct: 1 }, assumptions), [asset, units, price, assumptions]);
  const endPrice = path === 'fall' ? (gpu ? tradeDeal.fallTo : asset.usedPriceToday * 0.55) : expectedUnitValue(asset, MONTHS);
  const marketAt = (m: number) => asset.usedPriceToday * Math.pow(endPrice / asset.usedPriceToday, m / MONTHS);
  const market = marketAt(month);
  const settled = matched && month >= MONTHS;
  const below = market < price;
  const fee = Math.round(q.feeTotal); // whole dollars, the amount Stripe charges
  const yieldPerYear = fee / (price * units) / (MONTHS / 12);

  // once matched, time runs from today to the end of the bid
  useEffect(() => {
    if (!matched) return;
    const t0 = performance.now(), from = 0;
    const tick = (now: number) => {
      const m = Math.min(MONTHS, from + ((now - t0) / 9000) * MONTHS);
      setMonth(m);
      if (m < MONTHS) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [matched, path]);

  const paid = useCountUp(matched ? fee : 0, 900);
  const reset = () => { cancelAnimationFrame(raf.current); setBid(false); setAsk(false); setMonth(0); setFeePaid(false); setPayError(''); };

  // the fee can be paid by card when the server has a Stripe key; coming back from Stripe, tidy the address
  useEffect(() => {
    fetch('/api/checkout').then((r) => r.json()).then((d: { enabled?: boolean }) => setCanPay(Boolean(d.enabled))).catch(() => {});
    if (cameBackPaid()) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []);
  const payFee = async () => {
    setPaying(true); setPayError('');
    try {
      const r = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset: kind, units, pricePerUnit: price, months: MONTHS }) });
      const d = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !d.url) throw new Error(d.error ?? 'The payment page could not be opened.');
      window.location.assign(d.url);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'The payment page could not be opened.');
      setPaying(false);
    }
  };

  // chart
  const Wc = 520, Hc = 150, top = asset.usedPriceToday * 1.08, lo = asset.usedPriceToday * 0.45;
  const x = (m: number) => 8 + (m / MONTHS) * (Wc - 16), y = (v: number) => 8 + ((top - v) / (top - lo)) * (Hc - 16);
  const pts = Array.from({ length: 61 }, (_, i) => (i / 60) * month).map((m) => `${x(m).toFixed(1)},${y(marketAt(m)).toFixed(1)}`).join(' ');

  return (
    <div className="view trade">
      <p className="lede">One deal, two sides.</p>

      <div className="trade-grid">
        <section className={`side ${bid ? 'posted' : ''}`}>
          <div className="side-head"><span className="who">Buyer</span><span className="meta">buy low + earn yield</span></div>
          <div className="order">Bid <b>{usd(price)}</b> · {MONTHS} months</div>
          {!bid ? <button className="btn primary" onClick={() => setBid(true)}>Post bid</button> : <div className="chip">{matched ? 'Matched' : 'Bid posted'}</div>}
          <div className={`result ${matched ? 'show' : ''}`}>
            <div className="label">Yield</div>
            <div className="big num good-text">+{usdShort(paid)}</div>
            <div className="sub">{pct(yieldPerYear, 0)} a year</div>
            <div className="line">{settled ? (below ? `Gets the ${asset.unitLabel} at ${usd(price)}` : `Keeps +${usdShort(fee)}`) : ''}</div>
          </div>
        </section>

        <section className="mid">
          <div className="label">Used {asset.name.replace(/^\d+ × (Nvidia )?/, '')}: resale price</div>
          <div className={`big-3 num ${matched && below ? 'bad-text' : ''}`}>{usd(Math.round(market / 10) * 10)}</div>
          <svg viewBox={`0 0 ${Wc} ${Hc}`} className="trade-chart" role="img" aria-label="Resale price against the agreed price">
            <line x1="8" x2={Wc - 8} y1={y(price)} y2={y(price)} className={`floor ${matched ? 'on' : ''}`} />
            <text x={Wc - 10} y={y(price) - 8} textAnchor="end" className={`floor-label ${matched ? 'on' : ''}`}>agreed {usd(price)}</text>
            {matched && <polyline points={pts} className="path" />}
            {matched && <circle cx={x(month)} cy={y(market)} r="5" className="dot-now" />}
          </svg>
          <div className="meta">{matched ? (settled ? `Month ${MONTHS}: settled` : `Month ${month.toFixed(1)} of ${MONTHS}`) : bid || ask ? 'Waiting for the other side' : 'No deal yet'}</div>
          <div className="switch" role="tablist" aria-label="What the market does">
            <button className={path === 'fall' ? 'on' : ''} onClick={() => { setPath('fall'); setMonth(0); }}>Prices fall</button>
            <button className={path === 'hold' ? 'on' : ''} onClick={() => { setPath('hold'); setMonth(0); }}>Prices hold</button>
          </div>
          {matched && <button className="link" onClick={reset}>Start again</button>}
        </section>

        <section className={`side ${ask ? 'posted' : ''}`}>
          <div className="side-head"><span className="who">GPU owner</span><span className="meta">hedge the drop</span></div>
          <div className="order">Floor <b>{usd(price)}</b> · {MONTHS} months</div>
          {!ask ? <button className="btn primary" onClick={() => setAsk(true)}>Buy insurance</button> : <div className="chip">{matched ? 'Matched' : 'Waiting for a buyer'}</div>}
          <div className={`result ${matched ? 'show' : ''}`}>
            <div className="label">Protected</div>
            <div className={`big num ${below ? 'good-text' : ''}`}>{(() => { const v = Math.round(Math.max(0, price - market) * units); return `${v > 0 ? '+' : ''}${v >= 1000 ? usdShort(v) : usd(v)}`; })()}</div>
            
            <div className="line">{settled ? (below ? `Sells at ${usd(price)}, not ${usd(Math.round(market / 10) * 10)}` : `Paid −${usdShort(fee)}`) : ''}</div>
            {feePaid ? <div className="pay good-text">Insurance paid: {usdShort(fee)} <span className="meta">Stripe, test mode</span></div>
              : canPay && <div className="pay"><button className="btn" onClick={payFee} disabled={paying}>{paying ? 'Opening Stripe' : `Pay ${usdShort(fee)}`}</button><span className="meta">Stripe test</span></div>}
            {payError && <div className="meta bad-text">{payError}</div>}
          </div>
        </section>
      </div>
      <p className="meta trade-note">Simulation of one deal. The price path is the scenario you pick.</p>
    </div>
  );
}
