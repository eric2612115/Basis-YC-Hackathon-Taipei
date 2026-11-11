# Basis

**A guaranteed resale price for GPUs, so lenders can finance them without a fire sale.**

Built on 11 November 2026 at c0mpiled-18, the YC Startup School hackathon in Taipei, for the YC request for startups "Wall Street for the Physical Buildout".

## The problem

A GPU cloud borrows against its GPUs. When a new chip ships, rent falls, and the lender's only move is to seize the GPUs and sell them when nobody wants them. So a bank lends about half of today's resale price.

## What Basis does

Buyers who want used GPUs at a discount commit to a price today, and are paid a fee for that promise. Their promises form a ladder of prices that steps down over time. A lender lends up to that ladder, so in every month the loan is covered by a buyer who has already agreed to buy.

| Who | What they get |
|---|---|
| The buyer | Paid today to wait for GPUs at a price they chose |
| The GPU owner | A larger loan |
| The lender | A known exit in every month of the loan |

## The sample: 64 Nvidia H100s

| | |
|---|---|
| A bank lends half of today's resale value | $480,000 |
| With committed buyers, a lender can lend | $704,000 |
| What the buyers charge for the whole ladder | $98,800, or 4.7% of the loan a year |
| Risk grade | BB, rising to BBB with committed buyers |

Every number comes from [`src/lib/engine.ts`](src/lib/engine.ts) and is checked by the tests.

## How the fee is priced

An owner can sell a GPU only once. So the whole ladder is one right: to sell once, in any month, at that month's committed price. Basis prices it on a binomial tree and checks the tree against Black-76 for a single date.

## Run the tests

```bash
npm install
npm test
```
