# What exists, and what Basis adds

If you think this has been built before, read this table first.

| Who | What they do | What Basis adds |
|---|---|---|
| CME Group with Silicon Data, ICE with Ornn | Futures on GPU rental price indices, settled in cash ([Silicon Data](https://www.silicondata.com/blog/gpu-futures), [ICE](https://ir.theice.com/press/news-details/2026/ICE-and-Ornn-to-Launch-GPU-Compute-Futures-Contracts/default.aspx)) | A price for these machines, settled by handing them to a buyer. No index is needed |
| Bitget | Perpetual contracts on GPU rental prices for traders ([report](https://datacenter.news/story/bitget-launches-gpu-rental-price-perpetuals-for-traders)) | The other side of the contract is someone who wants the hardware |
| Compute Exchange | A marketplace for used H100s and A100s at today's price ([SiliconANGLE](https://siliconangle.com/2026/07/17/compute-exchange-opens-secondary-market-used-nvidia-h100-a100-gpus/)) | Prices for future months, committed today |
| Silicon Data SiteIQ | Underwriting data for AI data center sites ([SiteIQ](https://www.silicondata.com/products/site-iq)) | The exit price a lender can lend against, and its cost |
| USD.AI | Loans against GPUs, funded on-chain ([docs](https://docs.usd.ai/borrower/overview)) | Any lender can use the ladder; Basis is not the lender |
| Chip vendors | Residual value guarantees for the largest customers | The same protection for everyone else, written by buyers of used hardware |

## The claim

Basis is the first product where buyers of used GPUs post forward commitments that a lender can lend against, with the whole ladder priced as one right to sell once.

This is wrong if a live product already lets a third-party buyer commit today to buy a named lot of used GPUs in a future month at a fixed price, and shows a lender the loan that commitment supports. If you know one, open an issue and it goes into this table.
