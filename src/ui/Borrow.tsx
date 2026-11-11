// Borrow: the path a lender walks, from the machines to a letter the owner can send to a bank tomorrow.
import type { ReactNode } from 'react';
import type { StressOutcome, Underwriting } from '../lib/types';
import { useStore } from './store';
import { hasCoverLine, Legend, LoanChart } from './Chart';
import { BidList } from './Bids';
import { LeadForm, Letter } from './Letter';
import { Records } from './Records';
import { NumberField } from './fields';
import { useCountUp } from './hooks';
import { cap, clock, pct, plural, usd, usdShort } from './format';

function Step({ n, title, line, children }: { n: number; title: string; line: ReactNode; children?: ReactNode }) {
  return (
    <section className="step">
      <header className="step-head">
        <span className="step-n">{n}</span>
        <div>
          <h2>{title}</h2>
          <p className="step-line">{line}</p>
        </div>
      </header>
      {children && <div className="step-body">{children}</div>}
    </section>
  );
}

/** A dollar figure that glides to each new value from the engine. */
function CountUp({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <div className={className}>{usdShort(v)}</div>;
}

export function Borrow() {
  const { kind, asset, bids, u, stress, prices, analysis } = useStore();
  const one = asset.units === 1;
  const things = one ? asset.unitLabel : `${asset.unitLabel}s`;
  // With no committed buyers a lender lends what a bank lends; the engine reports 0 for the committed loan then.
  const lendable = bids.length && u.committedLoan > 0 ? u.committedLoan : u.bankLoan;

  const machinesLine =
    kind === 'gpu' ? (
      <>
        {asset.name}
        {prices ? <>, each renting for {usd(prices.reference.price)} an hour right now.</> : ', rented out by the hour.'}
        {analysis && <> Their records show {plural(analysis.flags.length, 'thing')} a lender should know.</>}
      </>
    ) : (
      <>One {asset.name.toLowerCase()}, paid {usd(asset.ratePerHour)} an hour on a fixed contract.</>
    );

  const bankLine = `A bank lends ${pct(asset.bankAdvanceRate)} of today's resale value, because it can't tell what the ${things} will sell for later.`;

  const buyersLine = bids.length
    ? `${plural(bids.length, 'buyer')} ${bids.length === 1 ? 'has' : 'have'} committed to buy at set prices. Each one raises what a lender can lend: now ${usdShort(lendable)}.`
    : `No buyers yet, so a lender lends what a bank lends: ${usdShort(u.bankLoan)}.`;

  return (
    <div className="view">
      <p className="lede">Buyers commit to a resale price. Lenders lend up to it. No fire sale.</p>

      <Step n={1} title="The machines" line={machinesLine}>
        <Machines />
        {kind === 'gpu' && <Records />}
      </Step>

      <Step n={2} title="What a bank lends" line={bankLine}>
        <div className="figure solo">
          <div className="label">A bank lends</div>
          <div className="big num">{usdShort(u.bankLoan)}</div>
          <div className="sub">
            {pct(asset.bankAdvanceRate)} of {usd(asset.usedPriceToday)} per {asset.unitLabel} today
          </div>
        </div>
      </Step>

      <Step n={3} title="Line up buyers" line={buyersLine}>
        <div className="pair">
          <div className="figure dim">
            <div className="label">A bank lends</div>
            <div className="big num">{usdShort(u.bankLoan)}</div>
          </div>
          <div className="figure accent">
            <div className="label">With committed buyers</div>
            <CountUp className="big num" value={lendable} />
            <div className="sub">
              {bids.length ? (
                <>
                  Buyers' fee {usdShort(u.fee)}
                  {u.feePerYearPct > 0 && <> · {pct(u.feePerYearPct, 1)} of the loan a year</>}
                </>
              ) : (
                'No buyers yet'
              )}
            </div>
          </div>
        </div>
        <BidLadder />
        <LoanChart
          path={u.path}
          bids={bids}
          units={asset.units}
          unitLabel={asset.unitLabel}
          chipMonth={stress.chipShipsMonth}
          bindingMonth={bids.length ? u.bindingMonth : null}
        />
        <Legend ladder={bids.length > 0} cover={hasCoverLine(u.path)} stressed={stress.chipShipsMonth !== null} />
      </Step>

      <Step n={4} title="Ship a new chip" line={stressLine(stress.chipShipsMonth, u.stress, things, stress.rentDrop, stress.priceDrop)}>
        <StressTest />
      </Step>

      <Step n={5} title="The letter" line="One page the owner can send to a bank tomorrow.">
        <Letter />
        <LeadForm />
      </Step>

      <AssumptionsPanel />
      <BuyerNotice />
    </div>
  );
}

function stressLine(month: number | null, o: Underwriting['stress'], things: string, rentDrop: number, priceDrop: number): string {
  if (month === null || !o) {
    return `Drag to the month a new chip ships. Rent falls ${pct(rentDrop)} and resale prices ${pct(priceDrop)} that month.`;
  }
  const a = o.withoutBids;
  const b = o.withBids;
  const without =
    a.how === 'forced sale'
      ? a.lenderLoss > 0.5
        ? `Without buyers, the lender seizes the ${things} and loses ${usdShort(a.lenderLoss)} in a fire sale.`
        : `Without buyers, the lender has to seize and sell the ${things}.`
      : 'Payments keep up, even without buyers.';
  const withBuyers =
    b.how === 'sold to committed buyer'
      ? b.lenderLoss > 0.5
        ? `With them, it still loses ${usdShort(b.lenderLoss)}.`
        : `With them, the buyers take the ${things} at the agreed price and the lender is repaid.`
      : '';
  return `A new chip ships in month ${month}. ${without} ${withBuyers}`.trim();
}

function Machines() {
  const { kind, setKind, asset } = useStore();
  return (
    <div className="machines">
      <div className="switch" role="group" aria-label="Machines">
        <button type="button" className={kind === 'gpu' ? 'on' : undefined} aria-pressed={kind === 'gpu'} onClick={() => setKind('gpu')}>
          GPU cluster
        </button>
        <button type="button" className={kind === 'robot' ? 'on' : undefined} aria-pressed={kind === 'robot'} onClick={() => setKind('robot')}>
          Welding robot
        </button>
      </div>
      <div className="asset-name">
        <span className="big-3">{asset.name}</span>
        <span className="tag">Sample</span>
      </div>
      {kind === 'gpu' ? (
        <LivePrice />
      ) : (
        <p className="meta">
          {usd(asset.ratePerHour)} an hour on contract · {asset.hoursPerMonth} hours a month · resale {usd(asset.usedPriceToday)} today
        </p>
      )}
    </div>
  );
}

function LivePrice() {
  const { prices, pricesFailed } = useStore();
  if (!prices) return <p className="meta">{pricesFailed ? 'Live price unavailable right now.' : 'Fetching the live H100 price…'}</p>;
  return (
    <p className="meta live">
      <span>
        <i className={prices.live ? 'dot on' : 'dot'} aria-hidden="true" />
        H100 <b className="num ink">{usd(prices.reference.price)}</b> an hour
      </span>
      {prices.sources.map((s) => (
        <span key={s.name}>
          {s.name} {usd(s.price)}
        </span>
      ))}
      <span>{prices.live ? `live ${clock(prices.asOf)}` : 'stored sample'}</span>
      <a href="#/prices">All prices</a>
    </p>
  );
}

function BidLadder() {
  const { bids, ownBid, nextSample, hiddenCount, startEmpty, addNextSample, showAll } = useStore();
  const anySample = bids.some((b) => b.sample);
  return (
    <div className="ladder">
      {bids.length > 0 && <BidList bids={bids} own={ownBid} limit={6} />}
      <div className="ladder-actions">
        {nextSample ? (
          <button type="button" className="btn ghost" onClick={addNextSample}>
            Add a buyer
          </button>
        ) : (
          <a className="btn ghost" href="#/buy">
            Add a buyer
          </a>
        )}
        {hiddenCount > 0 ? (
          <>
            <button type="button" className="link" onClick={showAll}>
              Show all buyers
            </button>
            <a className="link" href="#/buy">
              Post your own
            </a>
          </>
        ) : (
          anySample && (
            <button type="button" className="link" onClick={startEmpty}>
              Start with no buyers
            </button>
          )
        )}
      </div>
    </div>
  );
}

function StressTest() {
  const { loan, stress, setChipMonth, u } = useStore();
  const on = stress.chipShipsMonth !== null;
  return (
    <div className="stress">
      <div className="stress-head">
        <label htmlFor="chip">A new chip ships in month</label>
        <output htmlFor="chip" className="num">{on ? stress.chipShipsMonth : 'Off'}</output>
      </div>
      <input
        id="chip"
        type="range"
        min={0}
        max={loan.months}
        step={1}
        value={stress.chipShipsMonth ?? 0}
        aria-valuetext={on ? `Month ${stress.chipShipsMonth}` : 'Off'}
        onChange={(e) => {
          const v = Number(e.target.value);
          setChipMonth(v === 0 ? null : v);
        }}
      />
      <div className="range-scale">
        <span>Off</span>
        <span>Month {loan.months}</span>
      </div>
      {u.stress && (
        <div className="outcomes">
          <Outcome title="Without committed buyers" o={u.stress.withoutBids} />
          <Outcome title="With committed buyers" o={u.stress.withBids} />
        </div>
      )}
    </div>
  );
}

function Outcome({ title, o }: { title: string; o: StressOutcome }) {
  const loss = o.lenderLoss > 0.5;
  const tone = o.how === 'no default' ? 'calm' : loss ? 'bad' : 'good';
  const head = o.how === 'no default' ? 'No default' : loss ? `Lender loses ${usdShort(o.lenderLoss)}` : 'Lender repaid in full';
  return (
    <div className={`outcome ${tone}`}>
      <div className="label">{title}</div>
      <div className="big-2 num">{head}</div>
      {o.how !== 'no default' && (
        <dl>
          <div>
            <dt>{cap(o.how)}</dt>
            <dd>{o.defaultMonth !== null ? `month ${o.defaultMonth}` : ''}</dd>
          </div>
          <div>
            <dt>Owed</dt>
            <dd className="num">{usdShort(o.owed)}</dd>
          </div>
          <div>
            <dt>Recovered</dt>
            <dd className="num">{usdShort(o.recovered)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/** Someone else just committed on the shared board: say who, for a few seconds. */
function BuyerNotice() {
  const { notice, kind, asset } = useStore();
  if (!notice || notice.kind !== kind) return null;
  const b = notice.bid;
  return (
    <div className="notice" role="status" key={notice.at}>
      <i className="dot on" aria-hidden="true" />
      <span>
        <b>{b.buyer}</b> committed to buy {b.units} {b.units === 1 ? asset.unitLabel : `${asset.unitLabel}s`} at {usd(b.pricePerUnit)}, until month{' '}
        {b.validThroughMonth}.
      </span>
    </div>
  );
}

function AssumptionsPanel() {
  const { asset, loan, stress, patchAsset, patchLoan, patchStress, resetAssumptions } = useStore();
  return (
    <section className="assumptions" aria-label="Assumptions">
      <div className="assumptions-head">
        <h3>Assumptions</h3>
        <span className="tag">Sample</span>
        <button type="button" className="link" onClick={resetAssumptions}>
          Reset
        </button>
      </div>
      <div className="fields">
        <NumberField label={`Resale price per ${asset.unitLabel} today`} prefix="$" value={asset.usedPriceToday} min={1} onChange={(v) => patchAsset({ usedPriceToday: v })} />
        <NumberField label="Resale price falls, a year" suffix="%" percent value={asset.depreciationPerYear} min={0} max={0.95} onChange={(v) => patchAsset({ depreciationPerYear: v })} />
        <NumberField label="Volatility" suffix="%" percent value={asset.volatility} min={0.01} max={3} onChange={(v) => patchAsset({ volatility: v })} />
        <NumberField label="Bank lends, of resale value" suffix="%" percent value={asset.bankAdvanceRate} min={0} max={1} onChange={(v) => patchAsset({ bankAdvanceRate: v })} />
        <NumberField label="Loan months" integer value={loan.months} min={1} max={120} onChange={(v) => patchLoan({ months: v })} />
        <NumberField label="Base rate" suffix="%" percent value={loan.baseRate} min={0} max={0.5} onChange={(v) => patchLoan({ baseRate: v })} />
        <NumberField label="Spread" suffix="%" percent value={loan.spread} min={0} max={0.5} onChange={(v) => patchLoan({ spread: v })} />
        <NumberField label="Resale drop when a chip ships" suffix="%" percent value={stress.priceDrop} min={0} max={0.95} onChange={(v) => patchStress({ priceDrop: v })} />
      </div>
    </section>
  );
}
