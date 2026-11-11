// Borrow: the path a lender walks, from the machines to a letter the owner can send to a bank tomorrow.
import { useRef, type ReactNode } from 'react';
import type { RiskGrade, StressOutcome, Underwriting } from '../lib/types';
import { useStore } from './store';
import { Legend, LoanChart } from './Chart';
import { BidList } from './Bids';
import { LeadForm, Letter } from './Letter';
import { NumberField } from './fields';
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

export function Borrow() {
  const { kind, asset, bids, u, stress, prices, analysis } = useStore();
  const one = asset.units === 1;
  const things = one ? asset.unitLabel : `${asset.unitLabel}s`;

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
    ? `Buyers have committed to pay set prices for ${one ? 'this' : 'these'} ${things}, month by month. The loan never owes more than they will pay, so a lender can lend ${usdShort(u.committedLoan)}.`
    : 'No committed buyers yet. Add one on Buy.';

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
            <div className="big num">{bids.length ? usdShort(u.committedLoan) : '—'}</div>
            <div className="sub">
              {bids.length ? (
                <>
                  Buyers' fee {usdShort(u.fee)} · {pct(u.feePerYearPct, 1)} of the loan a year
                </>
              ) : (
                <a href="#/buy">Add a committed buyer</a>
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
          bindingMonth={u.bindingMonth}
        />
        <Legend stressed={stress.chipShipsMonth !== null} />
      </Step>

      <Step n={4} title="Ship a new chip" line={stressLine(stress.chipShipsMonth, u.stress, things, stress.rentDrop, stress.priceDrop)}>
        <StressTest />
      </Step>

      <Step n={5} title="The letter" line="One page the owner can send to a bank tomorrow.">
        <Letter />
        <LeadForm />
      </Step>

      <AssumptionsPanel />
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

function Records() {
  const { analysis, analysisLoad, analysisError, readSampleRecords, readRecordsFile, grade, gradeWithoutBids } = useStore();
  const file = useRef<HTMLInputElement>(null);
  const busy = analysisLoad === 'loading';
  return (
    <div className="records">
      <div className="records-head">
        <h3>What the records say</h3>
        <div className="actions">
          <button type="button" className="btn" onClick={readSampleRecords} disabled={busy}>
            {analysis ? 'Read the sample again' : 'Read the sample records'}
          </button>
          <button type="button" className="btn ghost" onClick={() => file.current?.click()} disabled={busy}>
            Upload a CSV
          </button>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readRecordsFile(f);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </div>
      {busy && <p className="meta reading">Reading the records…</p>}
      {analysisLoad === 'error' && <p className="meta bad-text">{analysisError}</p>}
      {!analysis && !busy && analysisLoad !== 'error' && (
        <p className="meta">The cluster's rental records. The AI flags what a lender should worry about, with the rows it read.</p>
      )}
      {analysis && !busy && (
        <div className="records-grid">
          <div>
            <ul className="flags">
              {analysis.flags.map((f, i) => (
                <li key={f.id} style={{ animationDelay: `${i * 140}ms` }}>
                  <span className={`sev ${f.severity}`} aria-label={`${f.severity} concern`} />
                  <div>
                    <b>{f.title}</b>
                    <p>{f.detail}</p>
                    {f.rows.length > 0 && <small>{f.rows.length === 1 ? 'Row' : 'Rows'} {f.rows.join(', ')}</small>}
                  </div>
                </li>
              ))}
            </ul>
            {analysis.memo && <p className="memo">{analysis.memo}</p>}
            <p className="meta source">
              {analysis.source === 'model'
                ? `Read by ${analysis.model ?? 'the model'} just now.`
                : analysis.source === 'rules'
                  ? 'Checked by rules.'
                  : 'Sample records, read ahead of time.'}
            </p>
          </div>
          {grade && <GradeCard g={grade} without={gradeWithoutBids} />}
        </div>
      )}
    </div>
  );
}

function GradeCard({ g, without }: { g: RiskGrade; without: RiskGrade | null }) {
  const parts: [string, number][] = [
    ['Industry', g.parts.industry],
    ['Stability', g.parts.stability],
    ['Counterparty', g.parts.counterparty],
    ['Redeployable', g.parts.redeploy],
  ];
  return (
    <div className="grade">
      <div className="label">Risk grade</div>
      <div className="grade-row">
        <span className="big num">{g.grade}</span>
        <span className="meta">{Math.round(g.score)} / 100</span>
      </div>
      {without && without.grade !== g.grade && <p className="meta">{without.grade} without committed buyers</p>}
      <ul className="bars">
        {parts.map(([k, v]) => (
          <li key={k}>
            <span>{k}</span>
            <span className="track">
              <i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
            </span>
            <b>{Math.round(v)}</b>
          </li>
        ))}
      </ul>
      <p className="grade-reason">{g.reason}</p>
      <p className="meta">Spread {pct(g.spread, 1)} a year</p>
    </div>
  );
}

function BidLadder() {
  const { bids, ownBid } = useStore();
  if (!bids.length) return null;
  return (
    <div className="ladder">
      <BidList bids={bids} own={ownBid} limit={6} />
      <a className="btn ghost add" href="#/buy">
        Add a buyer
      </a>
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
