// Step 1, part two: the records. The page shows the file being read, then reveals each flag with the rows it points to.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Analysis, RiskGrade } from '../lib/types';
import { useStore } from './store';
import { parseCsv } from './csv';
import { pct } from './format';

const COLUMNS: [string, string][] = [
  ['date', 'Date'],
  ['customer_id', 'Customer'],
  ['gpu_hours', 'GPU-hrs'],
  ['rate', 'Rate'],
  ['paid_on', 'Paid on'],
  ['refund', 'Refund'],
  ['downtime_hours', 'Down'],
  ['notes', 'Notes'],
];
/** Who read the records, said only as far as it is true: a model is named only when one actually read the file. */
export function readingSource(a: Analysis): string {
  if (a.source === 'model') return a.model ? `Read by ${a.model}.` : 'Read by a model.';
  if (a.source === 'rules') return 'Checked by rules.';
  return a.model ? `Read ahead of time by ${a.model}.` : 'Checked by rules ahead of time.';
}

const MAX_ROWS = 400;
const STEP_MS = 400;

export function Records() {
  const { analysis, analysisLoad, analysisError, readSampleRecords, readRecordsFile, grade, gradeWithoutBids, recordsCsv, readCount } = useStore();
  const file = useRef<HTMLInputElement>(null);
  const busy = analysisLoad === 'loading';
  const table = useMemo(() => (recordsCsv ? parseCsv(recordsCsv) : null), [recordsCsv]);
  const flags = analysis?.flags ?? [];

  // Reveal the flags one at a time after each new read; a read that finished before this mounted shows at once.
  const [shown, setShown] = useState(() => flags.length);
  const [hover, setHover] = useState<number | null>(null);
  const played = useRef(readCount);
  useEffect(() => {
    if (!analysis || readCount === played.current) return;
    played.current = readCount;
    setHover(null);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(analysis.flags.length);
      return;
    }
    setShown(0);
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= analysis.flags.length) window.clearInterval(t);
    }, STEP_MS);
    return () => window.clearInterval(t);
  }, [readCount, analysis]);

  const done = shown >= flags.length;
  const active = hover ?? (shown > 0 ? Math.min(shown, flags.length) - 1 : null);
  const rows = active !== null && flags[active] ? flags[active].rows : [];

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
        <p className="meta">Basis reads the cluster's rental records and flags what a lender should worry about, with the rows it read.</p>
      )}
      {analysis && !busy && (
        <div className={table ? 'reading-grid' : 'reading-grid no-table'}>
          {table && <CsvWindow rows={table} highlight={rows} />}
          <div className="flags-col">
            {!done && <p className="meta reading">Reading {table ? `${Math.max(0, table.length - 1)} rows` : 'the records'}…</p>}
            <ul className="flags">
              {flags.slice(0, shown).map((f, i) => (
                <li
                  key={f.id}
                  className={i === active ? 'on' : undefined}
                  tabIndex={0}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                >
                  <span className={`sev ${f.severity}`} aria-label={`${f.severity} concern`} />
                  <div>
                    <b>{f.title}</b>
                    <p>{f.detail}</p>
                    {f.rows.length > 0 && <small>{f.rows.length === 1 ? 'Row' : 'Rows'} {f.rows.join(', ')}</small>}
                  </div>
                </li>
              ))}
            </ul>
            {done && analysis.memo && <p className="memo fade-in">{analysis.memo}</p>}
            {done && (
              <p className="meta source fade-in">{readingSource(analysis)}</p>
            )}
          </div>
          {grade && done && <GradeCard g={grade} without={gradeWithoutBids} />}
        </div>
      )}
    </div>
  );
}

/** A compact window on the CSV. Spreadsheet numbering: the header is row 1, the first record is row 2. */
function CsvWindow({ rows, highlight }: { rows: string[][]; highlight: number[] }) {
  const box = useRef<HTMLDivElement>(null);
  const header = rows[0] ?? [];
  const named = COLUMNS.map(([key, label]) => [header.indexOf(key), label] as const).filter(([i]) => i >= 0);
  const cols = named.length >= 3 ? named : header.slice(0, 8).map((h, i) => [i, h] as const);
  const marked = new Set(highlight);
  const records = rows.slice(1);
  const visible: number[] = [];
  for (let j = 0; j < Math.min(records.length, MAX_ROWS); j++) visible.push(j + 2);
  for (const n of [...marked].sort((a, z) => a - z)) if (n - 2 >= MAX_ROWS && n - 2 < records.length) visible.push(n);
  const key = highlight.join(',');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!highlight.length) {
      el.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const target = el.querySelector<HTMLElement>(`[data-row="${Math.min(...highlight)}"]`);
    const head = el.querySelector<HTMLElement>('thead');
    if (target) el.scrollTo({ top: Math.max(0, target.offsetTop - (head?.offsetHeight ?? 0) - 28), behavior: 'smooth' });
  }, [key]);

  return (
    <div className="csv" ref={box} aria-label="The records being read">
      <table>
        <thead>
          <tr>
            <th>#</th>
            {cols.map(([i, label]) => (
              <th key={i}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((n, k) => {
            const r = records[n - 2] ?? [];
            const gap = k > 0 && n !== visible[k - 1] + 1;
            return (
              <tr key={n} data-row={n} className={[marked.has(n) ? 'hit' : '', gap ? 'gap' : ''].join(' ').trim() || undefined}>
                <td>{n}</td>
                {cols.map(([i]) => (
                  <td key={i} className={header[i] === 'notes' ? 'note' : undefined} title={header[i] === 'notes' ? r[i] : undefined}>
                    {r[i] ?? ''}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
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
    <div className="grade fade-in">
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
