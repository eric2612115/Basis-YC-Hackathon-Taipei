// Hand-written SVG charts. They draw numbers from the engine and the price feed; they do not compute money.
import type { ReactNode } from 'react';
import type { Bid, MonthPoint } from '../lib/types';
import { useWidth } from './hooks';
import { clock, usd, usdShort } from './format';

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export interface LadderRun {
  from: number;
  to: number;
  value: number;            // guaranteed amount for the lot, from the engine
  unitPrice: number | null; // the bid's own price per unit, when one fully funded bid covers the whole lot
}

/** Months grouped where the guaranteed amount stays the same. */
export function ladderRuns(path: MonthPoint[], bids: Bid[], units: number): LadderRun[] {
  const runs: LadderRun[] = [];
  for (const p of path) {
    const last = runs[runs.length - 1];
    if (last && last.value === p.guaranteed && last.to === p.month - 1) last.to = p.month;
    else runs.push({ from: p.month, to: p.month, value: p.guaranteed, unitPrice: null });
  }
  for (const r of runs) {
    const top = bids.filter((b) => r.from <= b.validThroughMonth).sort((a, z) => z.pricePerUnit - a.pricePerUnit)[0];
    r.unitPrice = top && top.units >= units && top.fundedPct >= 1 ? top.pricePerUnit : null;
  }
  return runs.filter((r) => r.value > 0);
}

interface LoanChartProps {
  path: MonthPoint[];
  bids: Bid[];
  units: number;
  unitLabel: string;
  chipMonth: number | null;
  bindingMonth: number | null;
}

/** Months across; the guaranteed amount as a brass step line, the loan balance under it, the expected resale value in grey. */
export function LoanChart({ path, bids, units, unitLabel, chipMonth, bindingMonth }: LoanChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const W = Math.max(300, width || 960);
  const narrow = W < 600;
  const H = narrow ? 260 : 360;
  const pad = { l: narrow ? 46 : 58, r: 14, t: 30, b: 28 };
  const last = path.length ? path[path.length - 1].month : 1;
  const maxV = Math.max(1, ...path.map((p) => Math.max(p.guaranteed, p.balance, p.expectedValue)));
  const step = niceStep(maxV / 4);
  const top = Math.ceil((maxV * 1.04) / step) * step;
  const x = (m: number) => pad.l + (m / (last || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);

  const yTicks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) yTicks.push(v);
  const every = last <= 24 ? (narrow ? 6 : 3) : last <= 60 ? (narrow ? 12 : 6) : 12;
  const xTicks: number[] = [];
  for (let m = 0; m <= last; m += every) xTicks.push(m);
  if (xTicks[xTicks.length - 1] !== last) {
    if (last - xTicks[xTicks.length - 1] < every / 2) xTicks.pop();
    xTicks.push(last);
  }

  let steps = '';
  path.forEach((p, i) => {
    steps += i === 0 ? `M${x(p.month)},${y(p.guaranteed)}` : `H${x(p.month)}V${y(p.guaranteed)}`;
  });
  const hasLadder = path.some((p) => p.guaranteed > 0);
  const line = (pick: (p: MonthPoint) => number) => path.map((p, i) => `${i ? 'L' : 'M'}${x(p.month)},${y(pick(p))}`).join('');

  let stressed = '';
  if (chipMonth !== null) {
    const after = path.filter((p) => p.month >= chipMonth);
    if (after.length) stressed = `M${x(after[0].month)},${y(after[0].expectedValue)}` + after.map((p) => `L${x(p.month)},${y(p.stressedValue)}`).join('');
  }
  const runs = ladderRuns(path, bids, units);
  const bind = bindingMonth !== null ? path.find((p) => p.month === bindingMonth) : undefined;
  const chipX = chipMonth !== null ? x(chipMonth) : 0;

  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Loan balance under the guaranteed resale price, month by month">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#efede8" />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end">{usdShort(v)}</text>
          </g>
        ))}
        {xTicks.map((m, i) => (
          <text key={m} x={x(m)} y={H - 8} textAnchor={i === 0 ? 'start' : m === last ? 'end' : 'middle'}>
            {m === last ? `${m} mo` : m}
          </text>
        ))}
        {hasLadder && <path d={`${steps}V${y(0)}H${x(0)}Z`} fill="#d2b06a" opacity={0.13} />}
        <path d={line((p) => p.expectedValue)} fill="none" stroke="#a6a6a6" strokeWidth={1.25} />
        {stressed && <path d={stressed} fill="none" stroke="#e5493d" strokeWidth={1.75} strokeDasharray="5 4" />}
        {hasLadder && <path d={steps} fill="none" stroke="#d2b06a" strokeWidth={3} />}
        <path d={line((p) => p.balance)} fill="none" stroke="#111111" strokeWidth={2.25} strokeLinejoin="round" />
        {bind && <circle cx={x(bind.month)} cy={y(bind.balance)} r={4.5} fill="#111111" stroke="#ffffff" strokeWidth={2} />}
        {chipMonth !== null && (
          <g>
            <line x1={chipX} x2={chipX} y1={pad.t} y2={H - pad.b} stroke="#e5493d" strokeWidth={1} strokeDasharray="2 3" />
            <text className="chip-label" x={chipX} y={pad.t - 12} textAnchor={chipX < pad.l + 40 ? 'start' : chipX > W - 60 ? 'end' : 'middle'}>
              New chip
            </text>
          </g>
        )}
        {runs.map((r) => {
          const x0 = x(r.from);
          const x1 = x(Math.min(r.to + 1, last));
          const text = r.unitPrice !== null ? usdShort(r.unitPrice) + (narrow ? '' : `/${unitLabel}`) : usdShort(r.value);
          const w = text.length * 6.6;
          if (x1 - x0 < w + 6) return null;
          // Keep the label clear of the "new chip" line: move it to whichever side of the line has room.
          let cx = (x0 + x1) / 2;
          if (chipMonth !== null && Math.abs(chipX - cx) < w / 2 + 6) {
            const right = chipX + w / 2 + 8;
            const left = chipX - w / 2 - 8;
            if (right + w / 2 <= x1) cx = right;
            else if (left - w / 2 >= x0) cx = left;
          }
          return (
            <text key={r.from} className="step-label" x={cx} y={y(r.value) - 8} textAnchor="middle">
              {text}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function Legend({ stressed }: { stressed: boolean }) {
  return (
    <div className="legend">
      <span><i className="sw brass" />Guaranteed resale price</span>
      <span><i className="sw ink" />Loan balance</span>
      <span><i className="sw grey" />Expected resale value</span>
      {stressed && <span><i className="sw red" />After a new chip</span>}
    </div>
  );
}

/** The reference price over time. */
export function HistoryChart({ points }: { points: { t: string; price: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const W = Math.max(280, width || 900);
  const H = 200;
  const pad = { l: 4, r: 64, t: 14, b: 26 };
  const pts = points
    .filter((p) => Number.isFinite(p.price) && !Number.isNaN(new Date(p.t).getTime()))
    .sort((a, z) => new Date(a.t).getTime() - new Date(z.t).getTime());

  let body: ReactNode = <p className="empty">The line fills in as prices arrive.</p>;
  if (pts.length >= 2) {
    const ts = pts.map((p) => new Date(p.t).getTime());
    const t0 = ts[0];
    const t1 = ts[ts.length - 1];
    const vals = pts.map((p) => p.price);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || Math.max(hi * 0.02, 0.01);
    const y0 = lo - span * 0.2;
    const y1 = hi + span * 0.2;
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(ts[i])},${y(p.price)}`).join('');
    body = (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="H100 reference price over time">
        <line x1={pad.l} x2={W - pad.r} y1={y(hi)} y2={y(hi)} stroke="#efede8" />
        {hi !== lo && <line x1={pad.l} x2={W - pad.r} y1={y(lo)} y2={y(lo)} stroke="#efede8" />}
        <path d={d} fill="none" stroke="#111111" strokeWidth={1.75} strokeLinejoin="round" />
        <circle cx={x(t1)} cy={y(vals[vals.length - 1])} r={3.5} fill="#111111" />
        <text x={W - pad.r + 8} y={y(hi) + 4}>{usd(hi)}</text>
        {hi !== lo && <text x={W - pad.r + 8} y={y(lo) + 4}>{usd(lo)}</text>}
        <text x={pad.l} y={H - 6}>{clock(pts[0].t)}</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end">{clock(pts[pts.length - 1].t)}</text>
      </svg>
    );
  }
  return (
    <div className="chart" ref={ref}>
      {body}
    </div>
  );
}
