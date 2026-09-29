# The hot path, finally measured (M1-028 input) — 2026-09-29

Baseline: `ba71c87` (the till, on `feat/m1-025-sale-till`).
Status: measured, repeatable, both server budgets met. One budget is not.
Evidence: [`output/verification/2026-09-29-hot-path/`](../../output/verification/2026-09-29-hot-path/).
Harness: `backend/scripts/measure_hot_path.py`, re-runnable for the release gate.

## Why now

The plan set these budgets at revision 3 and said in the same sentence that
they were "to be measured, not assumed". They never were — it is the oldest
open item in the project, carried in six reports. Two changes since then put
work on that path and neither was measured either:

- **M1-029** added a warehouse-access join to every stock command;
- **M1-023** added a shared advisory lock per warehouse to all of them, on the
  `POST /sales` hot path, explicitly flagged as unmeasured.

The till (M1-025) is the first client that can generate this load, and the
receiving and correction screens will sit on the same foundation. If the hot
path had a problem, this was the moment it was cheapest to find.

## Result

Three runs plus a fourth after cleanup, all consistent. Worst p95 seen across
every run:

| Case | p50 | **p95 (worst of 4 runs)** | p99 | Budget | |
|---|---|---|---|---|---|
| `GET /catalog/stock-options` | 5.4–6.1 | **7.6** | 26.0 | 300 ms | pass, ~40× |
| `GET /catalog/stock-options`, 6 sellers | 19.3–20.5 | **40.4** | 46.5 | 300 ms | pass, ~7× |
| `POST /sales`, 1 line | 8.6–10.0 | **15.0** | 34.7 | 500 ms | pass, ~33× |
| `POST /sales`, 1 line, 6 sellers | 31.9–38.1 | **95.2** | 113.2 | 500 ms | pass, ~5× |
| `POST /sales`, 4 lines, 6 sellers | 46.3–50.9 | **69.1** | 128.0 | 500 ms | pass, ~7× |
| `POST /sales`, **same coat, 6 sellers** | 33.3–35.5 | **60.8** | 62.5 | 500 ms | pass, ~8× |

Dataset: 400 variants × 6 sizes = 2 400 stock keys in one warehouse, 200 units
each — comfortably more than two outerwear shops carry.

**The contended case is not the slow one.** Six sellers fighting over the same
coat came out *faster* at p95 than six sellers selling different ones, because
serialising on one row reduces the concurrent work the database is doing.
Whatever the warehouse advisory lock and the ordered row locks cost, it is not
visible at this scale — which is the specific thing M1-023 asked to be checked.

## What this does and does not prove

It measures the server's own work: request in, receipt out, real PostgreSQL
over loopback. It is a laptop, it is **PostgreSQL 16.2 rather than the pinned
17**, and there is no phone, no mobile network and no Telegram webview in it.

Read it as: *nothing on this path is an order of magnitude wrong, and the two
unmeasured additions cost nothing measurable.* It is not a production load
profile and does not become one by being repeated.

## The budget that fails: taps-to-sale

The plan also sets **taps-to-sale ≤ 5**. Counting discrete touches to sell one
coat on the screen as built, excluding keystrokes:

| | before | after |
|---|---|---|
| open «Продаж» | 1 | 1 |
| choose the warehouse | 2 | **0** |
| choose product and size | 2 | 2 |
| quantity (already `1`) | 0 | 0 |
| focus the price field | 1 | 1 |
| «Додати в кошик» | 1 | 1 |
| «Продати» | 1 | 1 |
| **total** | **8** | **6** |

plus typing the price in every case.

**Two taps removed here.** The sale API states that "the client may prefill it
when the store reaches only one warehouse, but the server never chooses"
(owner decision, 2026-09-17). The till now does exactly that: when a store
reaches exactly one active warehouse it may sell from, that warehouse is
selected and no empty option is offered — there is no choice to make. When it
reaches two, nothing is prefilled and the seller still chooses explicitly.
Pinned by two browser tests; the guard was mutated and caught.

**Six is still over budget, and the rest is the price.** Every sale requires
typing a number. `variant_price` exists in the schema for precisely this —
project.md lists it under confirmed domain rules, "so the seller does not
retype it" — and nothing writes it, nothing reads it and no endpoint exposes
it. The *rule* is confirmed; **who may set a suggested price is not**, so it is
not being guessed. This is owner question Q-F, and it is now a measured budget
failure rather than a preference.

## Changed files

- `backend/scripts/measure_hot_path.py` — new. Refuses any database not named
  `birka_perf`, the same fence `evaluate_catalog` uses and for the same reason.
- `frontend/src/sales/Sale.tsx` — prefill the single sellable warehouse.
- `frontend/e2e/sale.spec.ts` — two tests for the prefill and its boundary.
- `output/verification/2026-09-29-hot-path/` — four runs, raw.

No migration, no schema change, no change to any business rule.

## Verification

- **E2E: 36 passed** (34 + 2), mobile Chromium, real API and PostgreSQL.
- Ruff, ruff-format (155 files), `mypy app scripts` (85 files) clean.
- Frontend lint, TypeScript and build clean.
- The prefill guard was mutated to prefill unconditionally; the
  two-warehouse test caught it.

## Still open after this

- **Q-F (who sets a suggested price)** now blocks a measured budget.
- PostgreSQL 17 numbers: this ran on 16.2. Worth one isolated Docker run
  before release, since the release gate will quote these figures.
- A real device profile — phone, mobile network, Telegram webview — is a
  different measurement and belongs with the release gate, not here.
- `time-to-sale ≤ 15 s` is unmeasured: it needs a person, not a script.
