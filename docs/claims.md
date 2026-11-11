# Claims

Each claim Basis makes, and the test that proves it. Run them all with `npm test`.

| # | Claim | Test | File |
|---|---|---|---|
| 1 | A bank lends $480,000 against the sample cluster | "a bank lends $480K" | `src/lib/engine.test.ts` |
| 2 | With the sample ladder of committed buyers a lender can lend $704,000 | "committed buyers support $704K, bound in month 0" | `src/lib/engine.test.ts` |
| 3 | Every buyer who commits raises the loan: $480K, $491K, $525K, $602K, $704K | "each buyer added in ladder order raises the loan" | `src/lib/engine.test.ts` |
| 4 | In every month the loan balance is covered, for any ladder and any loan terms | "its balance never exceeds the cover in any month, and a larger loan would" | `src/lib/engine.test.ts` |
| 5 | The whole ladder costs about 4.7% of the loan a year at 45% volatility | "the sample ladder costs about $98.8K at volatility 0.45" | `src/lib/engine.test.ts` |
| 6 | The tree that prices the ladder agrees with Black-76 | "with one sale date the tree is within 1.5% of Black-76" | `src/lib/engine.test.ts` |
| 7 | With committed buyers the lender loses nothing, whichever month a new chip ships | "whichever month the chip ships, the lender loses nothing with committed buyers" | `src/lib/engine.test.ts` |
| 8 | Committed buyers raise the risk grade from BB to BBB | "committed buyers move the sample cluster up one step, from BB to BBB" | `src/lib/engine.test.ts` |
| 9 | The same method works for a welding robot: $450,000 at a bank, $700,000 with the maker's buy-back | "the robot cell: a bank lends $450K, the maker buy-back supports $700K" | `src/lib/engine.test.ts` |
| 10 | The reader finds every problem planted in the sample records, at its row | "covers each planted problem at its row" | `src/lib/records.test.ts` |
| 11 | No figure from the model reaches the screen unless it is in the records | "drops a flag with a number that is not in the records" | `server/analyze.test.ts` |
| 12 | The reference price is the median of live prices from RunPod and Akash | "after a fetch it is live: two sources, the median as the reference, one tick of history" | `server/prices.test.ts` |
| 13 | Only the person who posted a bid can remove it | "only the token removes a posted bid; sample bids stay" | `server/board.test.ts` |
| 14 | The fee charged through Stripe is the fee the engine prices, never an amount from the browser | "charges the fee the engine prices for the promise, in cents" | `server/stripe.test.ts` |
| 15 | The Trade example: a promise to buy one GPU at $10,000 any time in 6 months is priced at $500 | "the Trade example: a promise to buy one GPU at $10,000 for 6 months costs $500" | `server/stripe.test.ts` |
