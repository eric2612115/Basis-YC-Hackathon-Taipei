import { describe, expect, it } from 'vitest';
import { balanceAt, guaranteedAt, maxCommittedLoan, underwrite } from './engine';
import { assumptions, gpuBids, gpuCluster, loanTerms, noStress } from '../data/samples';

describe('the sample cluster', () => {
  it('a bank lends $480K', () => { expect(underwrite(gpuCluster, [], loanTerms, assumptions, noStress).bankLoan).toBe(480_000); });
  it('committed buyers support $704K, bound in month 0', () => {
    const r = maxCommittedLoan(gpuCluster, gpuBids, loanTerms);
    expect(r.loan).toBe(704_000); expect(r.bindingMonth).toBe(0);
  });
  it('the balance stays under the guaranteed amount every month', () => {
    for (let m = 0; m < loanTerms.months; m++) expect(balanceAt(704_000, loanTerms, m)).toBeLessThanOrEqual(guaranteedAt(gpuBids, 64, m) + 1e-6);
  });
});
