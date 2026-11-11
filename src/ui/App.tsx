// Placeholder so the project runs. Owner: the frontend conversation replaces everything under src/ui.
import { underwrite } from '../lib/engine';
import { APP_NAME, assumptions, gpuBids, gpuCluster, loanTerms, noStress } from '../data/samples';

export function App() {
  const u = underwrite(gpuCluster, gpuBids, loanTerms, assumptions, noStress);
  return (
    <main style={{ fontFamily: 'system-ui', padding: 48 }}>
      <h1>{APP_NAME}</h1>
      <p>Bank: ${u.bankLoan.toLocaleString()} · With committed buyers: ${u.committedLoan.toLocaleString()}</p>
    </main>
  );
}
