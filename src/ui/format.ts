// Display formatting only. These turn numbers from the engine and the server into text; they never compute money.

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Compact dollars: $480K, $98.8K, $1.25M, $2.71. */
export function usdShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a < 0.005) return '$0';
  if (a >= 1e6) return `${sign}$${trimZeros((a / 1e6).toFixed(2))}M`;
  if (a >= 1e3) return `${sign}$${trimZeros((a / 1e3).toFixed(a >= 1e5 ? 0 : 1))}K`;
  return `${sign}$${a >= 100 ? a.toFixed(0) : a.toFixed(2)}`;
}

/** Exact dollars: $1,105 or $2.71. */
export function usd(n: number, digits?: number): string {
  if (!Number.isFinite(n)) return '—';
  const d = digits ?? (Math.abs(n) < 100 && !Number.isInteger(n) ? 2 : 0);
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${n < 0 ? '−' : ''}$${s}`;
}

/** 0.047 → "4.7%". */
export function pct(f: number, digits = 0): string {
  if (!Number.isFinite(f)) return '—';
  return `${trimZeros((f * 100).toFixed(digits))}%`;
}

/** ISO time → "18:55" in the viewer's time zone. */
export function clock(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Today as "11 November 2026". */
export function day(d = new Date()): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
