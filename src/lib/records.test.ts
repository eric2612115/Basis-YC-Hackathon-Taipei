// Answer key for src/data/records.sample.csv (sample data, made up for the demo; the key is kept here, not in the CSV).
// 14 months of invoices, 2025-09 to 2026-10, for one cluster of 64 H100s. Row numbers are spreadsheet rows: the header
// is row 1. Five things a lender should worry about are planted, all around the biggest customer, C-07:
//   1. Concentration: C-07 brings 41% of revenue (40.9%), and its contract MSA-07 ends 2026-12-31, which is month 16
//      counted from the first month of the records. Its last three invoices are rows 99, 107 and 115.
//   2. Three late payments (terms are 30 days): row 72 (C-05, invoice 2026-05-31, paid 2026-07-31, 31 days late),
//      row 91 (C-07, invoice 2026-07-31, paid 2026-10-16, 47 days late) and row 99 (C-07, invoice 2026-08-31,
//      paid 2026-11-07, 38 days late).
//   3. A refund: row 56 (C-07, invoice 2026-03-31, $9,360, note "service credit").
//   4. A downtime incident: row 47 (C-07, invoice 2026-02-28, 61 hours, note "cooling fault, 16 GPUs offline").
//   5. A price cut for the biggest customer: row 83 (C-07, invoice 2026-06-30), from $2.50 to $2.15 per GPU-hour.
// Not a problem, on purpose: some invoices dated 2026-10-31 are unpaid, but they are not due yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gradeRisk } from './engine';
import { checkModelAnswer, customerRevenue, MAX_ROWS_FOR_MODEL, modelInput, numbersIn, parseCsv, parseRecords, ruleFlags, ruleMemo, summarize } from './records';
import { gpuCluster } from '../data/samples';
import type { Analysis } from './types';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const sampleCsv = fs.readFileSync(path.join(dataDir, 'records.sample.csv'), 'utf8');
const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'analysis.sample.json'), 'utf8')) as Analysis;
const sample = parseRecords(sampleCsv);
const summary = summarize(sample.rows, 64);
const HEADER = 'date,customer_id,contract_id,contract_price,contract_end,gpu_hours,rate,revenue,paid_on,refund,downtime_hours,notes';

describe('reading CSV', () => {
  it('handles quotes, doubled quotes, any line ending and a byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n1,"x, y"\n2,"say ""hi"""\r3,\n')).toEqual([['a', 'b'], ['1', 'x, y'], ['2', 'say "hi"'], ['3', '']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('"two\nlines",x\n')).toEqual([['two\nlines', 'x']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('says which required columns are missing', () => {
    expect(parseRecords('date,customer_id\n2026-01-31,C-01\n')).toMatchObject({ rows: [], missing: ['gpu_hours', 'revenue'] });
    expect(parseRecords('').missing).toContain('date');
  });
  it('skips rows it cannot read and works out revenue from the rate', () => {
    const r = parseRecords(`${HEADER}\nnot a date,C-01,,,,10,2.00,20.00,,,,\n2026-02-30,C-01,,,,10,2.00,20.00,,,,\n\n2026-01-31,C-01,,,,"1,000",$2.50,,,,,\n`);
    expect(r.skipped).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ row: 5, date: '2026-01-31', gpuHours: 1000, rate: 2.5, revenue: 2500 });
  });
  it('counts an unpaid invoice as late only once it is past due', () => {
    const r = parseRecords(`${HEADER}\n2026-01-31,C-01,,,,10,2.00,20.00,,,,\n2026-03-31,C-01,,,,10,2.00,20.00,,,,\n2026-03-31,C-02,,,,10,2.00,20.00,2026-04-12,,,\n`);
    expect(r.rows.map((x) => x.daysLate)).toEqual([41, 0, 0]); // newest date in the file is 2026-04-12: 71 days after the first invoice
  });
});

describe('the sample records', () => {
  it('are 116 invoices on rows 2 to 117, with every column the contract names', () => {
    expect(sampleCsv.split('\n')[0]).toBe(HEADER);
    expect(sample.missing).toEqual([]); expect(sample.skipped).toBe(0);
    expect(sample.rows).toHaveLength(116);
    expect(sample.rows[0].row).toBe(2); expect(sample.rows[115].row).toBe(117);
    expect(new Set(sample.rows.map((r) => r.date.slice(0, 7))).size).toBe(14);
  });
  it('do not carry the answer key', () => {
    expect(sampleCsv).not.toMatch(/late|worry|problem|planted|concentrat|price cut/i);
  });
  it('summarise to the numbers a lender asks for first', () => {
    expect(summary).toEqual({ months: 14, avgUtilization: 0.719, utilizationStdev: 0.0665, avgRate: 2.6385, topCustomerShare: 0.4088, contractedShare: 0.679, latePayments: 3, refunds: 1, downtimeHours: 61 });
    expect(customerRevenue(sample.rows)[0].customer).toBe('C-07');
  });
  it('revenue is hours × rate on every row', () => {
    for (const r of sample.rows) expect(Math.abs(r.revenue - r.gpuHours * r.rate)).toBeLessThan(0.006);
  });
  it('use never exceeds the 64 GPUs', () => {
    const byMonth = new Map<string, number>();
    for (const r of sample.rows) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) ?? 0) + r.gpuHours);
    for (const [month, hours] of byMonth) { const [y, m] = month.split('-').map(Number); expect(hours).toBeLessThanOrEqual(64 * 24 * new Date(Date.UTC(y, m, 0)).getUTCDate()); }
  });
});

describe('the five planted problems', () => {
  const flags = ruleFlags(sample.rows, summary);
  const flag = (id: string) => flags.find((f) => f.id === id)!;

  it('the rules find exactly these five, the most serious first', () => {
    expect(flags.map((f) => [f.id, f.severity])).toEqual([['concentration', 'high'], ['price-cut', 'medium'], ['late', 'medium'], ['refund', 'medium'], ['downtime', 'low']]);
  });
  it('1. one customer at 41% of revenue, with no contract past month 16', () => {
    expect(flag('concentration')).toMatchObject({ title: 'One customer is 41% of revenue', detail: 'C-07 brings 41% of revenue and its contract ends 2026-12-31.', rows: [99, 107, 115] });
  });
  it('2. three late payments', () => {
    expect(flag('late')).toMatchObject({ title: '3 invoices paid late', rows: [72, 91, 99] });
    expect(flag('late').detail).toBe('Invoices dated 2026-05-31, 2026-07-31 and 2026-08-31 were paid 31 to 47 days after the due date.');
    expect(sample.rows.filter((r) => r.daysLate > 0).map((r) => [r.row, r.customer, r.daysLate])).toEqual([[72, 'C-05', 31], [91, 'C-07', 47], [99, 'C-07', 38]]);
  });
  it('3. a refund', () => {
    expect(flag('refund')).toMatchObject({ title: 'A refund of $9,360', rows: [56] });
  });
  it('4. a downtime incident', () => {
    expect(flag('downtime')).toMatchObject({ title: '61 hours of downtime in 2026-02', detail: 'The record for 2026-02-28 notes: "cooling fault, 16 GPUs offline".', rows: [47] });
  });
  it('5. a price cut for the biggest customer', () => {
    expect(flag('price-cut')).toMatchObject({ detail: 'C-07 paid $2.50 per GPU-hour until 2026-05-31 and $2.15 from 2026-06-30.', rows: [83] });
  });
  it('clean records raise no flag', () => {
    const clean = parseRecords(`${HEADER}\n${['C-01', 'C-02', 'C-03', 'C-04', 'C-05'].map((c) => `2026-01-31,${c},,,,1000,2.50,2500.00,2026-02-10,,,`).join('\n')}\n`);
    const s = summarize(clean.rows, 64);
    expect(ruleFlags(clean.rows, s)).toEqual([]);
    expect(ruleMemo(s, [])).toMatch(/nothing a lender should worry about/);
  });
});

describe('the stored analysis of the sample', () => {
  it('has the summary the code computes', () => { expect(stored.summary).toEqual(summary); expect(stored.source).toBe('stored'); });
  it('covers each planted problem at its row', () => {
    for (const row of [115, 72, 91, 99, 56, 47, 83]) expect(stored.flags.some((f) => f.rows.includes(row))).toBe(true);
  });
  it('says nothing the records do not support: every row exists and every number is in the records', () => {
    const checked = checkModelAnswer(stored, sample.rows, modelInput(sample.rows, summary));
    expect(checked.dropped).toBe(0);
    expect(checked.flags).toEqual(stored.flags);
    expect(checked.memo).toBe(stored.memo);
  });
  it('gives the sample a BB risk grade, and BBB once buyers have committed', () => {
    expect(gradeRisk(gpuCluster, stored.summary, false)).toMatchObject({ grade: 'BB', score: 57 });
    expect(gradeRisk(gpuCluster, stored.summary, true)).toMatchObject({ grade: 'BBB', score: 63 });
  });
});

describe('checking a model answer against the records', () => {
  const input = modelInput(sample.rows, summary);
  const good = { id: 'Big Customer!', severity: 'HIGH', title: 'One customer is 41% of revenue', detail: 'C-07 pays $2.15 per GPU-hour and its contract ends 2026-12-31.', rows: [115, 107, 115] };

  it('keeps a flag the records support, and tidies its id, severity and rows', () => {
    const { flags, dropped } = checkModelAnswer({ flags: [good], memo: 'Use averaged 72% over 14 months.' }, sample.rows, input);
    expect(dropped).toBe(0);
    expect(flags).toEqual([{ id: 'big-customer', severity: 'high', title: good.title, detail: good.detail, rows: [107, 115] }]);
  });
  it('drops a flag that cites a row that does not exist', () => {
    expect(checkModelAnswer({ flags: [{ ...good, rows: [118] }, { ...good, rows: [1] }, { ...good, rows: [2.5] }, { ...good, rows: 'all' }] }, sample.rows, input)).toMatchObject({ flags: [], dropped: 4 });
  });
  it('drops a flag with a number that is not in the records', () => {
    const invented = { ...good, detail: 'C-07 brings 43% of revenue.' }, computed = { ...good, detail: 'Revenue from C-07 fell by 13.9% after the price change.' };
    const { flags, dropped } = checkModelAnswer({ flags: [invented, good, computed] }, sample.rows, input);
    expect(dropped).toBe(2); expect(flags).toHaveLength(1);
  });
  it('drops a flag with a date that is not in the records, or that uses a row number as if it were a figure', () => {
    const wrongDate = { ...good, detail: 'The contract of C-07 ends 2027-12-31.' }, dayAsNumber = { ...good, detail: 'C-07 brings 28% of revenue.' }; // 28 appears only inside dates
    const rowAsNumber = { ...good, detail: 'There are 117 unpaid invoices.' };
    expect(checkModelAnswer({ flags: [wrongDate, dayAsNumber, rowAsNumber] }, sample.rows, input)).toMatchObject({ flags: [], dropped: 3 });
    expect(checkModelAnswer({ flags: [{ ...good, detail: 'In 2026-02 the cluster lost 61 hours; the invoice is dated 2026-02-28.' }] }, sample.rows, input).flags).toHaveLength(1);
  });
  it('reads 9,360 and 9360.00 as the same number', () => {
    const refund = { id: 'refund', severity: 'medium', title: 'A refund of $9,360', detail: 'C-07 was refunded $9,360.00 in 2026-03.', rows: [56] };
    expect(checkModelAnswer({ flags: [refund] }, sample.rows, input).flags).toHaveLength(1);
    expect([...numbersIn('$9,360.00 and 9360, then 1,2,3')]).toEqual(['9360', '1', '2', '3']);
    expect([...numbersIn('47,61,2026-02-28', false)].sort()).toEqual(['2026', '2026-02', '2026-02-28', '47', '61']);
  });
  it('drops wording the product never uses', () => {
    const { flags, memo } = checkModelAnswer({ flags: [{ ...good, detail: 'This hurts the credit rating of C-07.' }], memo: 'Buy insurance.' }, sample.rows, input);
    expect(flags).toEqual([]); expect(memo).toBeNull();
  });
  it('keeps a memo only when its numbers are in the records', () => {
    expect(checkModelAnswer({ flags: [], memo: 'Use averaged 72% and one customer brings 41% of revenue.' }, sample.rows, input).memo).toBe('Use averaged 72% and one customer brings 41% of revenue.');
    expect(checkModelAnswer({ flags: [], memo: 'Revenue is about $1.2M a year.' }, sample.rows, input).memo).toBeNull();
  });
  it('survives answers that are not what was asked for', () => {
    for (const junk of [null, 'text', 42, [], { flags: 'none' }, { flags: [null, 7, {}] }]) expect(checkModelAnswer(junk, sample.rows, input).flags).toEqual([]);
    expect(checkModelAnswer({ flags: Array.from({ length: 12 }, () => good) }, sample.rows, input).flags.length).toBeLessThanOrEqual(8);
  });
});

describe('what a model is given', () => {
  it('is the summary computed in code, then every record with its row number and days late', () => {
    const input = modelInput(sample.rows, summary), lines = input.split('\n');
    expect(input).toContain('- biggest customer: C-07, 41% of revenue');
    expect(input).toContain('- invoices paid late: 3 (payment terms: 30 days)');
    expect(lines.filter((l) => /^\d+,\d{4}-\d{2}-\d{2},/.test(l))).toHaveLength(116);
    expect(lines).toContain('91,2026-07-31,C-07,MSA-07,2.15,2026-12-31,15624,2.15,33591.60,2026-10-16,47,,,');
    expect(lines).toContain('47,2026-02-28,C-07,MSA-07,2.50,2026-12-31,13136,2.50,32840.00,2026-03-16,0,,61,"cooling fault, 16 GPUs offline"');
  });
  it('sends only the newest records of a very long file, and strips control characters from text cells', () => {
    const many = `${HEADER}\n${Array.from({ length: 450 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')},C-01,,,,10,2.00,20.00,,,,"line one\tline two"`).join('\n')}\n`;
    const rows = parseRecords(many).rows, input = modelInput(rows, summarize(rows, 64));
    expect(input.split('\n').filter((l) => /^\d+,2026-/.test(l))).toHaveLength(MAX_ROWS_FOR_MODEL);
    expect(input).toContain(`the newest ${MAX_ROWS_FOR_MODEL} of 450 records`);
    expect(input).not.toMatch(/\t/);
  });
});
