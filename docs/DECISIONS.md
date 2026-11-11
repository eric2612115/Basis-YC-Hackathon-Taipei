# Decisions

| # | Date | Decision | Why |
|---|---|---|---|
| D-01 | 2026-11-11 | TypeScript end to end; all money math runs in the browser from `src/lib/engine.ts`; the server only fetches prices and calls the model. | Sliders answer instantly; one language; one service to deploy. |
| D-02 | 2026-11-11 | The hedge is a ladder of committed buyers for the hardware, settled by delivery, not a cash-settled floor on a rent index. | No index is needed to settle; it answers the lender's real question, what the machines will sell for. |
| D-03 | 2026-11-11 | The ladder steps down over time, each price below the expected resale value in its window. | A flat price for 18 months would sit above the expected value and cost too much. |
| D-04 | 2026-11-11 | The ladder is priced as one right to sell once, in any month, at that month's price, on a binomial tree. | The owner can only sell the machines once; summing separate options would overcharge. |
