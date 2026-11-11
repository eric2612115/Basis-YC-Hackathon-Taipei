import type { Bid } from '../lib/types';
import { pct, usd } from './format';

interface BidListProps {
  bids: Bid[];
  own?: (id: string) => boolean;
  onRemove?: (id: string) => void;
  limit?: number;
}

/** The ladder of committed buyers, earliest first. */
export function BidList({ bids, own, onRemove, limit }: BidListProps) {
  const sorted = [...bids].sort((a, z) => a.validThroughMonth - z.validThroughMonth || z.pricePerUnit - a.pricePerUnit);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const more = sorted.length - shown.length;
  return (
    <>
      <ul className="bids">
        {shown.map((b) => {
          const mine = own?.(b.id) ?? false;
          return (
            <li className="bid" key={b.id}>
              <div className="who">
                <b>{b.buyer}</b>
                {b.sample && <span className="tag">Sample</span>}
                {!b.sample && <small>{mine ? 'Posted by you' : 'Posted by a visitor'}. Indicative, not binding.</small>}
              </div>
              <div className="terms num">{b.units} × {usd(b.pricePerUnit)}</div>
              <div className="until">until month {b.validThroughMonth}</div>
              <div className="funded">{pct(b.fundedPct)} funded</div>
              {mine && onRemove ? (
                <button type="button" className="link x" onClick={() => onRemove(b.id)}>Remove</button>
              ) : (
                <span className="x" />
              )}
            </li>
          );
        })}
      </ul>
      {more > 0 && <p className="meta more">+{more} more on <a href="#/buy">Buy</a></p>}
    </>
  );
}
