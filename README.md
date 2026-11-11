# Basis

**A guaranteed resale price for GPUs, so lenders can finance them without a fire sale.**

Built on 11 November 2026 at c0mpiled-18, the YC Startup School hackathon in Taipei, for the YC request for startups "Wall Street for the Physical Buildout".

## Why now

| | | |
|---|---|---|
| **$35B** | of debt at a single GPU cloud | [CoreWeave 10-Q, 30 June 2026](https://www.sec.gov/Archives/edgar/data/0001769628/000176962826000366/crwv-20260630.htm) |
| **Every year** | Nvidia ships a new generation: Rubin 2026, Rubin Ultra 2027, Feynman 2028 | [Nvidia roadmap](https://www.tomshardware.com/pc-components/gpus/nvidia-announces-rubin-gpus-in-2026-rubin-ultra-in-2027-feynam-after) |
| **$4B → $21B** | the market for used data-center GPUs, 2026 to 2036 | [Meticulous Research](https://www.meticulousresearch.com/blog/384/used-refurbished-data-center-gpu-market-trends-2026) |

The debt is secured on machines that are repriced every year. The people who want those machines second-hand can only buy at today's price. Basis lets them commit to tomorrow's.

## What Basis does

A GPU cloud borrows against its GPUs. When a new chip ships, rent falls, and the lender's only move is to seize the GPUs and sell them when nobody wants them. So a bank lends about half of today's resale price.

With Basis, buyers who want used GPUs at a discount commit to a price today, and are paid a fee for that promise. Their promises form a ladder of prices that steps down over time. A lender lends up to that ladder, so in every month the loan is covered by a buyer who has already agreed to buy.

| Who | What they get |
|---|---|
| The buyer | Paid today to wait for GPUs at a price they chose |
| The GPU owner | A larger loan |
| The lender | A known exit in every month of the loan |

## Try it

1. **Borrow**, step 1: read the sample rental records. The model flags what a lender should worry about, with the rows it read, and the cluster gets a risk grade.
2. Step 2: what a bank lends.
3. Step 3: line up buyers and watch what a lender can lend.
4. Step 4: ship a new chip in any month. Without committed buyers the lender is forced to sell; with them the GPUs go to the committed buyer and the lender is repaid.
5. Step 5: the one-page letter the owner sends to a bank.
6. **Buy**: commit to a price for used GPUs and see what you are paid today. The board is shared, so every visitor sees your bid.
7. **Prices**: the live H100 rental price and where it comes from.

## The sample: 64 Nvidia H100s

| | |
|---|---|
| A bank lends half of today's resale value | $480,000 |
| With committed buyers, a lender can lend | $704,000 |
| What the buyers charge for the whole ladder | $99,600, or 4.7% of the loan a year |
| Risk grade | BB, rising to BBB with committed buyers |

The same method works for any machine with a meter. The sample welding robot goes from $450,000 at a bank to $700,000 with the maker's buy-back schedule.

Every number comes from [`src/lib/engine.ts`](src/lib/engine.ts) and is checked by the tests.

## How it works

An owner can sell a GPU only once. So the whole ladder is one right: to sell once, in any month, at that month's committed price. Basis prices it on a binomial tree and checks the tree against Black-76 for a single date. The full method, with the test that proves each part, is in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Run it

```bash
npm install
npm test
npm run dev
```

Then open http://localhost:5174. No keys are needed: prices come from two public sources, RunPod and Akash, and the records are checked by rules when no model key is set.

| Variable | What it does |
|---|---|
| `AI_API_KEY` | Lets the model read uploaded records. The default provider is GMI Cloud, through its OpenAI-compatible API |
| `AI_MODEL`, `AI_BASE_URL` | Pick the model, or another OpenAI-compatible provider |
| `ADMIN_TOKEN` | Lets the host clear visitors' bids back to the sample ladder |
| `PORT` | Where the server listens |

## What is in the repo

| Path | What |
|---|---|
| [`src/lib/engine.ts`](src/lib/engine.ts) | Every number: loan, ladder, fee, quotes, stress, risk grade. Pure functions |
| [`server/`](server) | Live prices, the shared bid board, the records analysis |
| [`src/ui/`](src/ui) | The three views |
| `*.test.ts` | 118 tests, beside the code they check |

Everything here was written during the event. Decisions and their reasons are in [docs/DECISIONS.md](docs/DECISIONS.md).
