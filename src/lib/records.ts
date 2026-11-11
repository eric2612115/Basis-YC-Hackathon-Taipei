// Reading a cluster's rental records: parse the CSV, summarise it in code, find what a lender should worry about by
// rules, and check a model's answer against the records. Pure functions, no I/O. Owner: the backend conversation.
import type { Flag, RecordsSummary } from './types';

export const RECORD_COLUMNS = ['date', 'customer_id', 'contract_id', 'contract_price', 'contract_end', 'gpu_hours', 'rate', 'revenue', 'paid_on', 'refund', 'downtime_hours', 'notes'] as const;
export const PAYMENT_TERMS_DAYS = 30;
export const DEFAULT_UNITS = 64;

export interface RecordRow {
  row: number;                  // spreadsheet row number: the header is row 1, the first record is row 2
  date: string;                 // invoice date, YYYY-MM-DD
  customer: string;
  contractId: string;           // '' when the customer has no contract
  contractPrice: number | null;
  contractEnd: string;          // '' when there is no contract
  gpuHours: number;
  rate: number;
  revenue: number;
  paidOn: string;               // '' when not paid yet
  daysLate: number;             // days past the payment terms; 0 when paid in time or not yet due
  refund: number;
  downtimeHours: number;
  notes: string;
}

// ---------- CSV ----------

/** A small CSV reader: commas, double quotes, quotes doubled inside quotes, any line ending. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

const dayNumber = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86_400_000); };

/** 'YYYY-MM-DD' (or with slashes) → 'YYYY-MM-DD' if it is a real date, else ''. */
function isoDate(raw: string): string {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw.trim());
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** '1,234.50', '$2.60', '' → number or null. */
function num(raw: string): number | null {
  const t = raw.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

export interface ParsedRecords { rows: RecordRow[]; skipped: number; missing: string[] }

/** Read the records. Rows that cannot be read are counted in `skipped`; `missing` lists required columns that are absent. */
export function parseRecords(csv: string): ParsedRecords {
  const table = parseCsv(csv);
  if (table.length === 0) return { rows: [], skipped: 0, missing: ['date', 'customer_id', 'gpu_hours', 'revenue'] };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const has = (name: string) => header.includes(name);
  const missing = ['date', 'customer_id', 'gpu_hours'].filter((c) => !has(c));
  if (!has('revenue') && !has('rate')) missing.push('revenue');
  if (missing.length > 0) return { rows: [], skipped: 0, missing };

  const rows: RecordRow[] = [];
  let skipped = 0;
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c.trim() === '')) continue;
    const get = (name: string) => { const k = header.indexOf(name); return k >= 0 && k < cells.length ? cells[k].trim() : ''; };
    const date = isoDate(get('date')), customer = get('customer_id'), gpuHours = num(get('gpu_hours'));
    let revenue = num(get('revenue')), rate = num(get('rate'));
    if (!date || !customer || gpuHours === null || gpuHours < 0) { skipped++; continue; }
    if (revenue === null && rate !== null) revenue = gpuHours * rate;
    if (revenue === null || revenue < 0) { skipped++; continue; }
    if (rate === null) rate = gpuHours > 0 ? revenue / gpuHours : 0;
    rows.push({
      row: i + 1, date, customer, contractId: get('contract_id'), contractPrice: num(get('contract_price')), contractEnd: isoDate(get('contract_end')),
      gpuHours, rate, revenue, paidOn: isoDate(get('paid_on')), daysLate: 0,
      refund: Math.max(0, num(get('refund')) ?? 0), downtimeHours: Math.max(0, num(get('downtime_hours')) ?? 0), notes: get('notes'),
    });
  }
  // An unpaid invoice is late once the newest date in the file is past its due date.
  let asOf = -Infinity;
  for (const r of rows) asOf = Math.max(asOf, dayNumber(r.date), r.paidOn ? dayNumber(r.paidOn) : -Infinity);
  for (const r of rows) r.daysLate = Math.max(0, (r.paidOn ? dayNumber(r.paidOn) : asOf) - dayNumber(r.date) - PAYMENT_TERMS_DAYS);
  return { rows, skipped, missing: [] };
}

// ---------- Summary ----------

const round = (x: number, places: number) => { const k = Math.pow(10, places); return Math.round(x * k) / k; };
const daysInMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** Revenue by customer, biggest first. */
export function customerRevenue(rows: RecordRow[]): { customer: string; revenue: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.customer, (by.get(r.customer) ?? 0) + r.revenue);
  return [...by.entries()].map(([customer, revenue]) => ({ customer, revenue })).sort((a, z) => z.revenue - a.revenue);
}

/** The numbers a lender asks for first. Use is GPU-hours billed ÷ (units × hours in that month). */
export function summarize(rows: RecordRow[], units: number = DEFAULT_UNITS): RecordsSummary {
  const hoursByMonth = new Map<string, number>();
  let revenue = 0, hours = 0, contracted = 0, late = 0, refunds = 0, downtime = 0;
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    hoursByMonth.set(month, (hoursByMonth.get(month) ?? 0) + r.gpuHours);
    revenue += r.revenue; hours += r.gpuHours; downtime += r.downtimeHours;
    if (r.contractId) contracted += r.revenue;
    if (r.daysLate > 0) late++;
    if (r.refund > 0) refunds++;
  }
  const use = [...hoursByMonth.entries()].map(([month, h]) => h / (Math.max(1, units) * 24 * daysInMonth(month)));
  const mean = use.length ? use.reduce((a, b) => a + b, 0) / use.length : 0;
  const stdev = use.length ? Math.sqrt(use.reduce((a, b) => a + (b - mean) * (b - mean), 0) / use.length) : 0;
  const top = customerRevenue(rows)[0];
  return {
    months: hoursByMonth.size, avgUtilization: round(mean, 4), utilizationStdev: round(stdev, 4), avgRate: hours > 0 ? round(revenue / hours, 4) : 0,
    topCustomerShare: revenue > 0 && top ? round(top.revenue / revenue, 4) : 0, contractedShare: revenue > 0 ? round(contracted / revenue, 4) : 0,
    latePayments: late, refunds, downtimeHours: round(downtime, 2),
  };
}

// ---------- Flags by rules ----------

const pct = (x: number) => `${Math.round(x * 100)}%`;
const money = (x: number) => `$${x.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const price = (x: number) => `$${x.toFixed(2)}`;
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** What a lender should worry about, found by fixed rules. Every number in the text is read from the records or the summary. */
export function ruleFlags(rows: RecordRow[], summary: RecordsSummary): Flag[] {
  const flags: Flag[] = [];
  const byDate = (a: RecordRow, z: RecordRow) => (a.date < z.date ? -1 : a.date > z.date ? 1 : a.row - z.row);
  const top = customerRevenue(rows)[0];
  const topRows = top ? rows.filter((r) => r.customer === top.customer).sort(byDate) : [];

  if (top && summary.topCustomerShare >= 0.25) {
    const latest = topRows[topRows.length - 1];
    flags.push({
      id: 'concentration', severity: summary.topCustomerShare >= 0.35 ? 'high' : 'medium',
      title: `One customer is ${pct(summary.topCustomerShare)} of revenue`,
      detail: latest.contractEnd ? `${top.customer} brings ${pct(summary.topCustomerShare)} of revenue and its contract ends ${latest.contractEnd}.`
        : `${top.customer} brings ${pct(summary.topCustomerShare)} of revenue and has no contract.`,
      rows: topRows.slice(-3).map((r) => r.row),
    });
  }

  // The biggest customer's price: the latest month where it fell by 5% or more.
  for (let i = topRows.length - 1; i > 0; i--) {
    const before = topRows[i - 1], after = topRows[i];
    if (before.rate > 0 && after.rate <= before.rate * 0.95) {
      flags.push({
        id: 'price-cut', severity: after.rate <= before.rate * 0.9 ? 'medium' : 'low',
        title: 'Price cut for the biggest customer',
        detail: `${top!.customer} paid ${price(before.rate)} per GPU-hour until ${before.date} and ${price(after.rate)} from ${after.date}.`,
        rows: [after.row],
      });
      break;
    }
  }

  const late = rows.filter((r) => r.daysLate > 0).sort(byDate);
  if (late.length > 0) {
    const days = late.map((r) => r.daysLate), lo = Math.min(...days), hi = Math.max(...days);
    const span = lo === hi ? `${hi} days` : `${lo} to ${hi} days`;
    flags.push({
      id: 'late', severity: late.length >= 6 ? 'high' : late.length >= 3 ? 'medium' : 'low',
      title: late.length === 1 ? '1 invoice paid late' : `${late.length} invoices paid late`,
      detail: late.length <= 4 ? `${late.length === 1 ? 'The invoice' : 'Invoices'} dated ${list(late.map((r) => r.date))} ${late.length === 1 ? 'was' : 'were'} paid ${span} after the due date.`
        : `${late.length} invoices were paid ${span} after the due date.`,
      rows: late.map((r) => r.row),
    });
  }

  const refunded = rows.filter((r) => r.refund > 0).sort((a, z) => z.refund - a.refund);
  if (refunded.length > 0) {
    const big = refunded[0], monthly = summary.months > 0 ? rows.reduce((a, r) => a + r.revenue, 0) / summary.months : 0;
    flags.push({
      id: 'refund', severity: monthly > 0 && big.refund >= 0.05 * monthly ? 'medium' : 'low',
      title: refunded.length === 1 ? `A refund of ${money(big.refund)}` : `${refunded.length} refunds on record`,
      detail: `${big.customer} was refunded ${money(big.refund)} on the invoice dated ${big.date}${big.notes ? ` (note: "${big.notes}")` : ''}.`,
      rows: refunded.map((r) => r.row).sort((a, z) => a - z),
    });
  }

  const down = rows.filter((r) => r.downtimeHours > 0).sort((a, z) => z.downtimeHours - a.downtimeHours);
  if (down.length > 0) {
    const big = down[0];
    flags.push({
      id: 'downtime', severity: summary.downtimeHours >= 72 ? 'medium' : 'low',
      title: `${money(big.downtimeHours).slice(1)} hours of downtime in ${big.date.slice(0, 7)}`,
      detail: big.notes ? `The record for ${big.date} notes: "${big.notes}".` : `Recorded on the invoice of ${big.customer} dated ${big.date}.`,
      rows: down.map((r) => r.row).sort((a, z) => a - z),
    });
  }
  return flags;
}

/** One paragraph for the lender, written by code from the summary and the flags. */
export function ruleMemo(summary: RecordsSummary, flags: Flag[]): string {
  const use = `Over ${summary.months} months the cluster was in use ${pct(summary.avgUtilization)} of the time at an average of ${price(summary.avgRate)} per GPU-hour, and ${pct(summary.contractedShare)} of revenue was under contract.`;
  if (flags.length === 0) return `${use} The rules found nothing a lender should worry about.`;
  const worst = flags.filter((f) => f.severity === 'high');
  const lead = worst.length > 0 ? worst[0] : flags[0];
  const rest = flags.filter((f) => f !== lead).map((f) => f.title.charAt(0).toLowerCase() + f.title.slice(1));
  return `${use} The main worry: ${lead.detail}${rest.length > 0 ? ` Also on record: ${list(rest)}.` : ''}`;
}

// ---------- A model's answer, checked against the records ----------

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/** Keep the newest rows when a file is too long to send to a model. */
export const MAX_ROWS_FOR_MODEL = 400;

/** The text a model reads: the summary computed in code, then the records with their row numbers and days late. */
export function modelInput(rows: RecordRow[], summary: RecordsSummary): string {
  const top = customerRevenue(rows)[0];
  const shown = rows.length > MAX_ROWS_FOR_MODEL ? rows.slice(-MAX_ROWS_FOR_MODEL) : rows;
  const lines = [
    'Summary (computed from the table):',
    `- months of records: ${summary.months}`,
    `- average use: ${pct(summary.avgUtilization)} of capacity, month-to-month swing ${pct(summary.utilizationStdev)}`,
    `- average price: ${price(summary.avgRate)} per GPU-hour`,
    `- biggest customer: ${top ? clean(top.customer, 40) : 'none'}, ${pct(summary.topCustomerShare)} of revenue`,
    `- revenue under contract: ${pct(summary.contractedShare)}`,
    `- invoices paid late: ${summary.latePayments} (payment terms: ${PAYMENT_TERMS_DAYS} days)`,
    `- refunds: ${summary.refunds}`,
    `- downtime: ${summary.downtimeHours} hours`,
    '',
    rows.length > shown.length ? `Table (the newest ${shown.length} of ${rows.length} records; row = spreadsheet row number; days_late = days past the due date):`
      : 'Table (row = spreadsheet row number; days_late = days past the due date):',
    'row,date,customer_id,contract_id,contract_price,contract_end,gpu_hours,rate,revenue,paid_on,days_late,refund,downtime_hours,notes',
  ];
  for (const r of shown) {
    lines.push([
      String(r.row), r.date, clean(r.customer, 40), clean(r.contractId, 40), r.contractPrice === null ? '' : r.contractPrice.toFixed(2), r.contractEnd,
      String(r.gpuHours), r.rate.toFixed(2), r.revenue.toFixed(2), r.paidOn, String(r.daysLate), r.refund ? r.refund.toFixed(2) : '',
      r.downtimeHours ? String(r.downtimeHours) : '', clean(r.notes, 120),
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

/**
 * Every number written in `text`, in one spelling: '9,360.00' and '9360' are the same number.
 * Pass `thousands = false` for comma-separated text such as the table a model reads, where a comma ends a cell.
 */
export function numbersIn(text: string, thousands: boolean = true): Set<string> {
  const out = new Set<string>();
  // Dates and months are kept whole (with their year), so the 31 of 2026-05-31 does not pass as a number on its own.
  const rest = text.replace(/(?<!\d)(\d{4})-(\d{2})(?:-(\d{2}))?(?!\d)/g, (_all, y: string, mo: string, d?: string) => {
    out.add(String(Number(y))); out.add(`${y}-${mo}`);
    if (d) out.add(`${y}-${mo}-${d}`);
    return ' ';
  });
  const pattern = thousands ? /\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g : /\d+(?:\.\d+)?/g;
  for (const m of rest.matchAll(pattern)) out.add(String(Number(m[0].replace(/,/g, ''))));
  return out;
}

const BANNED = /insurance|credit rating/i; // wording the product never uses
const SEVERITIES = new Set(['high', 'medium', 'low']);

export interface CheckedAnswer { flags: Flag[]; memo: string | null; dropped: number }

/**
 * Keep only what the records support. A flag is dropped when a row number does not exist, when a number or a date in
 * its text does not appear in what the model was given, or when it uses wording the product never uses. The memo is
 * held to the same rule, and is null when it fails.
 */
export function checkModelAnswer(answer: unknown, rows: RecordRow[], input: string): CheckedAnswer {
  // Row numbers belong in `rows`, not in the text: leave the row column out of what a text may quote.
  const known = numbersIn(input.replace(/^\d+,/gm, ''), false), rowNumbers = new Set(rows.map((r) => r.row));
  const supported = (text: string) => [...numbersIn(text)].every((n) => known.has(n)) && !BANNED.test(text);
  const raw = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : {};
  const flags: Flag[] = [], ids = new Set<string>();
  let dropped = 0;
  for (const item of Array.isArray(raw.flags) ? raw.flags.slice(0, 12) : []) {
    const f = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const title = typeof f.title === 'string' ? clean(f.title, 90) : '', detail = typeof f.detail === 'string' ? clean(f.detail, 280) : '';
    const rowList = Array.isArray(f.rows) ? f.rows : null;
    const rowsOk = rowList !== null && rowList.length <= 60 && rowList.every((r) => typeof r === 'number' && Number.isInteger(r) && rowNumbers.has(r));
    if (!title || !detail || !rowsOk || !supported(`${title} ${detail}`)) { dropped++; continue; }
    let id = typeof f.id === 'string' ? f.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : '';
    if (!id || ids.has(id)) id = `flag-${flags.length + 1}`;
    ids.add(id);
    const severity = typeof f.severity === 'string' && SEVERITIES.has(f.severity.toLowerCase()) ? (f.severity.toLowerCase() as Flag['severity']) : 'medium';
    flags.push({ id, severity, title, detail, rows: [...new Set(rowList as number[])].sort((a, z) => a - z) });
    if (flags.length === 8) break;
  }
  const memo = typeof raw.memo === 'string' ? clean(raw.memo, 700) : '';
  return { flags, memo: memo && supported(memo) ? memo : null, dropped };
}
