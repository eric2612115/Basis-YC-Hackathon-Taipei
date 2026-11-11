// Step 5: the one-page lender letter (on screen and as a print copy), and the form to ask for it on your own machines.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { annualRate, underwrite } from '../lib/engine';
import type { StressOutcome } from '../lib/types';
import { useStore } from './store';
import { ladderRuns } from './Chart';
import { Mark } from './Mark';
import { clock, day, pct, usd, usdShort } from './format';

function outcomeText(o: StressOutcome | undefined, things: string, one: boolean): string {
  if (!o) return '—';
  if (o.how === 'no default') return 'no default';
  const when = o.defaultMonth !== null ? ` in month ${o.defaultMonth}` : '';
  const result = o.lenderLoss > 0.5 ? `the lender loses ${usdShort(o.lenderLoss)}` : 'the lender is repaid in full';
  if (o.how === 'forced sale') return `forced sale${when}; ${result}`;
  return `the ${things} ${one ? 'goes' : 'go'} to the committed buyer${when}; ${result}`;
}

function LetterBody() {
  const { kind, asset, bids, loan, assumptions, stress, u, prices, analysis, grade } = useStore();
  const shock = stress.chipShipsMonth ?? Math.min(12, loan.months);
  const shocked = useMemo(
    () => (stress.chipShipsMonth === null ? underwrite(asset, bids, loan, assumptions, { ...stress, chipShipsMonth: shock }) : u),
    [asset, bids, loan, assumptions, stress, shock, u],
  );
  const runs = ladderRuns(u.path, bids, asset.units);
  const one = asset.units === 1;
  const things = one ? asset.unitLabel : `${asset.unitLabel}s`;

  return (
    <article className="doc">
      <header className="doc-head">
        <Mark size={16} />
        <span className="meta">{day()}</span>
      </header>
      <h1>Lender letter</h1>
      <p>
        {asset.name}. Resale value today {usd(asset.usedPriceToday)} per {asset.unitLabel}.
        {kind === 'gpu' && prices
          ? ` H100 rent ${usd(prices.reference.price)} an hour (${prices.live ? `live, ${clock(prices.asOf)}` : 'stored sample'}).`
          : ''}
      </p>

      <div className="kv">
        <div>
          <span>Largest covered loan</span>
          <b>{bids.length ? usdShort(u.committedLoan) : '—'}</b>
        </div>
        <div>
          <span>A bank lends</span>
          <b>{usdShort(u.bankLoan)}</b>
        </div>
        <div>
          <span>Buyers' fee</span>
          <b>
            {usdShort(u.fee)}
            {u.feePerYearPct ? ` · ${pct(u.feePerYearPct, 1)} a year` : ''}
          </b>
        </div>
        <div>
          <span>Payment</span>
          <b>
            {usd(u.monthlyPayment)} a month · {loan.months} months · {pct(annualRate(loan), 1)}
          </b>
        </div>
      </div>

      <h2>Committed prices by month</h2>
      {runs.length ? (
        <table>
          <thead>
            <tr>
              <th>Months</th>
              <th>Price per {asset.unitLabel}</th>
              <th>For the lot</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.from}>
                <td>
                  {r.from}–{r.to}
                </td>
                <td>{r.unitPrice !== null ? usd(r.unitPrice) : 'Several buyers'}</td>
                <td>{usdShort(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No committed buyers yet.</p>
      )}

      <h2>If a new chip ships in month {shock}</h2>
      <p>
        Rent falls {pct(stress.rentDrop)} and resale prices {pct(stress.priceDrop)}. Without committed buyers: {outcomeText(shocked.stress?.withoutBids, things, one)}.
        With them: {outcomeText(shocked.stress?.withBids, things, one)}.
      </p>

      {kind === 'gpu' && (
        <>
          <h2>What the records say</h2>
          {analysis ? (
            <ul>
              {analysis.flags.map((f) => (
                <li key={f.id}>
                  <b>{f.title}.</b> {f.detail} {f.rows.length > 0 && <span className="rows">Rows {f.rows.join(', ')}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>Records not read yet.</p>
          )}
          {grade && (
            <p>
              <b>Risk grade {grade.grade}</b> · {Math.round(grade.score)}/100. {grade.reason}
            </p>
          )}
        </>
      )}

      <footer>Sample data · Indicative · Not a loan offer</footer>
    </article>
  );
}

export function Letter() {
  return (
    <div className="letter">
      <div className="letter-paper">
        <LetterBody />
      </div>
      <div className="letter-actions">
        <button type="button" className="btn" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <span className="meta">One page, A4 or Letter.</span>
      </div>
      {createPortal(
        <div className="print-only">
          <LetterBody />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function LeadForm() {
  const { sendLead } = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');

  if (state === 'sent') {
    return (
      <div className="lead done">
        <p className="big-2">Thanks. We will reply within a day.</p>
      </div>
    );
  }

  return (
    <form
      className="lead"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('sending');
        try {
          await sendLead({ name: name.trim(), email: email.trim(), note: note.trim() || undefined });
          setState('sent');
        } catch (x) {
          setErr(x instanceof Error ? x.message : 'Could not send. Try again in a minute.');
          setState('error');
        }
      }}
    >
      <h3>Run this on your own machines</h3>
      <div className="lead-fields">
        <input required minLength={2} maxLength={80} placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input required type="email" maxLength={120} placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input maxLength={200} placeholder="What do you run? One line" aria-label="One line about your machines" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="btn" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
      {state === 'error' && <p className="meta bad-text">{err}</p>}
    </form>
  );
}
