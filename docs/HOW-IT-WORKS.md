# How Basis works

Every formula below lives in [`src/lib/engine.ts`](../src/lib/engine.ts). The test named beside it is in [`src/lib/engine.test.ts`](../src/lib/engine.test.ts). Money is in US dollars, time is in months from today.

## 1. The loan

A level-payment loan. With principal `P`, yearly rate `i` and `n` months, the payment is `P × (i/12) ÷ (1 − (1 + i/12)^−n)`, and the balance after `m` payments follows from it.

## 2. What a bank lends

`resale price today × units × the bank's advance rate`. For the sample: 64 × $15,000 × 50% = $480,000.
Test: "a bank lends $480K".

## 3. The ladder of committed buyers

Each bid is a promise to buy some units at a price, valid through a month, with a funded share. The guaranteed amount in a month takes the best valid prices first, counts only the funded part, and stops at the size of the lot.

## 4. The largest covered loan

The largest principal whose balance never exceeds the guaranteed amount in any month, found by bisection. For the sample ladder it is $704,000, set by month 0.
Tests: "committed buyers support $704K, bound in month 0", "the balance stays under the guaranteed amount every month", and a property test over random ladders and loan terms.

## 5. What the buyers charge

The owner can sell the machines once. So the ladder is one right: to sell once, in any month, at that month's committed price.

Basis prices it on a recombining binomial tree for the resale price: it starts at today's resale price, drifts down at the expected depreciation, and moves with the stated volatility. At each whole month the owner may sell at that month's committed price, or wait. The fee is the value at the root times the units.

- With a single sale date the tree agrees with Black-76 to within 1.5%.
- The sample ladder costs about $99,600 at 45% volatility: 4.7% of the loan a year.
- The fee rises with volatility, is zero with no bids, and counts only the funded part of a promise.

Tests: the group "the fee for the ladder".

## 6. A quote for one bid

Black-76 at the bid's last month, with the expected resale value as the forward. It gives the fee the buyer is paid today, the chance the owner ends up selling at that price, and the buyer's effective price.
Tests: the group "a quote for one bid".

## 7. When a new chip ships

From the chosen month, the resale price, the rent and the use all drop. Default is the first of two months in a row in which income does not cover the payment.

- Without committed buyers the lender sells at the stressed value less a forced-sale discount.
- With a buyer committed in that month, the machines go to that buyer at the agreed price and the lender is repaid from it.

Tests: the group "when a new chip ships", including "whichever month the chip ships, the lender loses nothing with committed buyers".

## 8. The risk grade

Four parts, each scored 0 to 100: the industry (how long the machine stays useful against the loan, how much its price moves), the stability of its use, the party who pays (customer concentration, late payments, refunds, contracts), and how easily the machine can be put to work elsewhere. Weights 30, 30, 25 and 15.

| Grade | Score | Spread over the base rate |
|---|---|---|
| A | 75 and above | 3% |
| BBB | 60 to 74 | 5% |
| BB | 45 to 59 | 7% |
| B | below 45 | 10% |

Committed buyers take price risk off the lender, so they raise the industry part: the sample cluster moves from BB to BBB.
Tests: the group "the risk grade".

## 9. What the model does, and does not do

The model reads the rental records and writes the flags and a short memo. It never produces a number that reaches the screen unchecked: the server computes the summary in code, and drops any flag whose row numbers or figures are not in the records. With no model key the same checks run as rules.
Tests: [`server/analyze.test.ts`](../server/analyze.test.ts).
