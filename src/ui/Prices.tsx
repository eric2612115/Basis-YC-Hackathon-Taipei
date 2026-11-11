// Prices: the live H100 rent the page uses, where each number comes from, and how it moved.
import { useStore } from './store';
import { HistoryChart } from './Chart';
import { cap, clock, usd } from './format';

export function Prices() {
  const { prices, pricesFailed } = useStore();
  if (!prices) {
    return (
      <div className="view">
        <p className="meta">{pricesFailed ? 'Prices are unavailable right now.' : 'Fetching prices…'}</p>
      </div>
    );
  }
  const unit = prices.reference.unit.replace(/^\$\//, 'per ');
  return (
    <div className="view">
      <section className="price-hero">
        <div className="label">{prices.reference.model} rent, reference price</div>
        <div className="big num">
          {usd(prices.reference.price)}
          <span className="unit">{unit}</span>
        </div>
        <p className="sub">
          <i className={prices.live ? 'dot on' : 'dot'} aria-hidden="true" />
          {prices.live ? `Live · ${clock(prices.asOf)}` : 'Stored sample'} · {cap(prices.reference.method)}
        </p>
      </section>

      <section className="block">
        <h2>Sources</h2>
        <ul className="sources">
          {prices.sources.map((s) => (
            <li key={s.name}>
              <b>{s.name}</b>
              <span className="num price">{usd(s.price)}</span>
              <span className="detail">{s.detail}</span>
              <span className="time">{clock(s.asOf)}</span>
              <a href={s.url} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2>Last six hours</h2>
        <HistoryChart points={prices.history} />
      </section>

      <p className="meta">Listed prices, not trades.</p>
    </div>
  );
}
