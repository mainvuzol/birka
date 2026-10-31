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
  *Answered and built on 2026-10-01; see the update below.*
- PostgreSQL 17 numbers: this ran on 16.2. Worth one isolated Docker run
  before release, since the release gate will quote these figures.
- A real device profile — phone, mobile network, Telegram webview — is a
  different measurement and belongs with the release gate, not here.
- `time-to-sale ≤ 15 s` is unmeasured: it needs a person, not a script.

## Update — 2026-10-01: the suggested price

The owner answered Q-F the same day; see the
[suggested price report](suggested-price-report.md). The till now prefills a
model's suggested price when the seller picks it. On the built screen, for a
model with a price:

| | taps |
|---|---|
| open «Продаж» | 1 |
| choose the warehouse (one sellable) | 0 |
| choose product and size | 2 |
| quantity (already `1`) | 0 |
| the price (prefilled) | 0 |
| «Додати в кошик» | 1 |
| «Продати» | 1 |
| **total** | **5** |

No typing at all. **The budget is met for a priced model.** A model nobody
has priced is still 6 taps plus typing, so the budget holds only as far as
the shop prices its models. A browser test sells with nothing typed and
checks that the sent price is the suggested one.

## Update — 2026-10-01: the release gate

Measured again because three changes since put work on this path, and none
was measured:
- **PR #47:** the stock options read each model's suggested price;
- **PR #48:** `POST /sales` takes an advisory lock on the basket's command
  id, which it shares with the empty shelf;
- **PR #49:** an account with no access is refused with its own error. It is
  not on this path.

Three runs, on the same laptop and PostgreSQL 16.2, with the same harness
and settings. Evidence:
[`output/verification/2026-10-01-hot-path/`](../../output/verification/2026-10-01-hot-path/).

| Case | p95, 2026-09-29 (worst of 4) | **p95, 2026-10-01 (worst of 3)** | Budget |
|---|---|---|---|
| `GET /catalog/stock-options` | 7.6 | **6.8** | 300 ms |
| `GET /catalog/stock-options`, 6 sellers | 40.4 | **58.6** | 300 ms |
| `POST /sales`, 1 line | 15.0 | **10.6** | 500 ms |
| `POST /sales`, 1 line, 6 sellers | 95.2 | **39.8** | 500 ms |
| `POST /sales`, 4 lines, 6 sellers | 69.1 | **55.6** | 500 ms |
| `POST /sales`, same coat, 6 sellers | 60.8 | **74.0** | 500 ms |

- **Every case passes with 5× headroom or more.**
- **The one real change:** the catalogue read under six sellers rose from
  ~39 to ~57 ms at p95. Its p50 is unchanged, at about 20 ms. The cause is
  most likely the suggested-price lookup PR #47 added. Each run agrees, so
  it is not noise.
- **The sale's new command lock** costs nothing visible.

**PostgreSQL 17 now has its own CI job**, `hot-path`. It runs on every pull
request and every push to main:
- the same harness;
- through one uvicorn process, as the server runs it;
- on PostgreSQL 17 with the production locale.

It keeps the figures as an artifact. That closes "PostgreSQL 17 numbers:
this ran on 16.2", the open item above. What it fails on changed after its
first runs; see the next update.

**Still open:**
- `time-to-sale ≤ 15 s`, which needs a person;
- a real device profile.

Both are rows of the [release checklist](release-checklist.md).

## Update — 2026-10-01: the first PostgreSQL 17 figures, and what CI fails on

The `hot-path` job's first two runs on PR #50 both passed. Under
concurrency, though, they came much closer to the budgets than the laptop
predicted.

Evidence: `ci-pg17-push.txt` and `ci-pg17-pull-request.txt` in
[`output/verification/2026-10-01-hot-path/`](../../output/verification/2026-10-01-hot-path/).

| Case | laptop, PG 16.2 (worst of 3) | **CI, PG 17 (worst of 2)** | Budget |
|---|---|---|---|
| `GET /catalog/stock-options` | 6.8 | **29.3** | 300 ms |
| `GET /catalog/stock-options`, 6 sellers | 58.6 | **290.8** | 300 ms |
| `POST /sales`, 1 line | 10.6 | **49.2** | 500 ms |
| `POST /sales`, 1 line, 6 sellers | 39.8 | **284.7** | 500 ms |
| `POST /sales`, 4 lines, 6 sellers | 55.6 | **447.4** | 500 ms |
| `POST /sales`, same coat, 6 sellers | 74.0 | **273.8** | 500 ms |

**Why.** The runner is a private repository's standard Linux machine:
- it has two CPUs by GitHub's documentation. Its log does not say, and the
  harness now prints the count;
- it is about 4–5× slower than the laptop for this work;
- the harness, the API and the database share its CPUs.

**What dominates is Python, not PostgreSQL.** A profile of the catalogue
read, by statement log and `cProfile`:
- 33 statements per request take about 0.75 ms of database time together;
- the request takes about 5.4 ms on the laptop;
- the rest is spread across SQLAlchemy's ORM, FastAPI and serialization,
  with no single hot spot.

Fewer statements would gain a fraction; nothing here would gain a multiple.

**How to read it.** Six sellers asking back to back is roughly fifty
requests a second, about a hundred times what two shops' tills ask.
- One seller has ten times headroom, even on this runner.
- The concurrent cases measure the runner as much as the code.
- A gate on them would fail pull requests at random. Two of six cases came
  within 3 % and 11 % of their budgets.

**So CI now fails on what one seller sees.**
- `BIRKA_PERF_GATE=one-seller` gates only the concurrency-1 cases.
- It still prints every case's verdict; a breach under concurrency is
  marked `(not gated)`.
- `all`, the default, still gates everything, and is the release reading.
- The harness now prints the machine's CPU count beside its figures.
- Checked both ways, with a budget lowered to force a breach:
  - a breach for one seller fails the run;
  - a breach under concurrency fails it only with `all`.

**For the server:** this is the evidence behind the runbook's "2 vCPU"
estimate. A two-CPU machine also running the load generator served six
sellers asking back to back within budget. The shops will ask about a
hundredth as often.


## Update — 2026-10-03: the release reading, every case gated

Release checklist row 22 asked for the reading that gates every case, after
the last change to `POST /sales`. It was last taken before PR #54. The owner
decided on 2026-10-03 that **every case gates the release, six sellers at once
included**, and that the reading is taken on the laptop, as before.

Six changes since then put work on this path, and none was measured with
every case gated:
- **PR #54:** a sale may be paid in parts;
- **PR #57:** store states, the store locked `FOR KEY SHARE`;
- **PR #63:** one more read per stock command, for a list that waits;
- **PR #64:** models held `FOR KEY SHARE` first;
- **PR #65:** sizes;
- **PR #66:** the session epoch, read from the person's row already fetched.

**The harness gained two cases:**
- **The sale paid in parts**, by one seller and by six. Each is a new
  customer paying 400.00 of a 1200.00 coat, so no sale paid in parts went
  unmeasured.
- **Each run now names what it ran on:** Python, PostgreSQL with `fsync` and
  `synchronous_commit`, and the API's environment.

The six earlier cases are unchanged, in name, count, body and order.

Three runs, each on a fresh database, on the laptop and PostgreSQL 16.2.
The API ran as CI runs it: one process, no access log, `WARNING`. Evidence:
[`output/verification/2026-10-03-hot-path/`](../../output/verification/2026-10-03-hot-path/).

| Case | p95, 2026-10-01 (worst of 3) | **p95, 2026-10-03 (worst of 3)** | p50 now | Budget |
|---|---|---|---|---|
| `GET /catalog/stock-options` | 6.8 | **6.3** | 5.5–5.8 | 300 ms |
| `GET /catalog/stock-options`, 6 sellers | 58.6 | **72.0** | 21.0–21.4 | 300 ms |
| `POST /sales`, 1 line | 10.6 | **12.1** | 9.4–10.3 | 500 ms |
| `POST /sales`, 1 line, 6 sellers | 39.8 | **192.0** | 39.6–42.9 | 500 ms |
| `POST /sales`, 4 lines, 6 sellers | 55.6 | **107.0** | 63.5–64.7 | 500 ms |
| `POST /sales`, same coat, 6 sellers | 74.0 | **65.3** | 40.2–40.9 | 500 ms |
| `POST /sales`, paid in parts | — | **13.6** | 9.7–11.0 | 500 ms |
| `POST /sales`, paid in parts, 6 sellers | — | **90.2** | 49.1–50.1 | 500 ms |

- **Every case passes in every run, gated.** The worst p95 is 192 ms against
  500, which is 2.6× headroom.
- **One seller is unchanged:** about 10 ms for a sale and 6 ms for the
  catalogue read.
- **Six sellers at once are slower than on 2026-10-01.** At p50, a one-line
  sale takes about 40 ms against 33, and a four-line sale about 64 ms
  against 49.
  - The changes above add a read and two row locks to every stock command.
    That fits, but no profile separated them.
- **The 192 ms is one run's tail.** That run's p99 was 236 ms; the other two
  runs gave 47 and 45 ms for the same case.
- **A sale paid in parts costs about what a sale paid in full does.**

This closes row 22 for the laptop. A reading on the real server was an
optional step in the [server runbook](server-runbook.md#the-hot-path-on-this-server-optional);
tried in Docker on 2026-10-09, it cannot run with the server's images, which
do not hold the harness's HTTP client.

## Update — 2026-10-04: the way button, and the drawer's stamp

Cash and card ([ADR-0012](../decisions/ADR-0012-cash-and-card.md)) changed
the till twice: the seller now gives the way of paying with the button that
sells, and every sale's insert runs a trigger that stamps it into its
drawer's period.

**Taps: still 5.** «Продати» became three buttons, «Готівка», «Картка» and
«Переказ», so the last tap gives the way and nothing is guessed. For a model
with a price:

| | taps |
|---|---|
| open «Продаж» | 1 |
| choose the warehouse (one sellable) | 0 |
| choose product and size | 2 |
| quantity (already `1`) | 0 |
| the price (prefilled) | 0 |
| «Додати в кошик» | 1 |
| a way: «Готівка», «Картка» or «Переказ» | 1 |
| **total** | **5** |

A return is +0 taps when the way back is preselected from the sale, +1
otherwise. A debt payment is unchanged: a way button replaces «Прийняти
внесок».

**The release reading,** checklist row 22, was taken again, since the body
gained a field and the insert a trigger.
- **The stamp** takes the store's row `FOR KEY SHARE` inside the insert, and
  reads the newest close's number. It adds no round trip.
- **The harness** sends `"payment_method": "CASH"` in every sale body. Its
  cases are otherwise unchanged.
- **The store's hold is now `FOR KEY SHARE`, as written** (`be806ab`). Until
  then `with_for_update(key_share=True)` had rendered `FOR NO KEY UPDATE`,
  so every command of a store queued behind the one before it.

Before that fix, four readings alternated the two locks on the same working
tree, two of each, in ms:

| Six sellers | p50, old lock | p50, new lock | p95, old lock | p95, new lock |
|---|---|---|---|---|
| `POST /sales`, 1 line | 40.5, 41.7 | 36.8, 35.5 | 44.1, 46.0 | 57.7, 57.0 |
| `POST /sales`, 4 lines | 65.9, 66.4 | 53.6, 52.7 | 78.4, 82.2 | 81.5, 88.8 |
| `POST /sales`, same coat | 41.1, 41.9 | 40.2, 39.7 | 55.2, 52.5 | 90.0, 48.6 |
| `POST /sales`, paid in parts | 50.3, 50.9 | 42.0, 41.8 | 55.5, 54.1 | 69.8, 68.6 |

Medians fell, the tails grew, and every case stayed far inside the budget.
Those readings ran beside a review on the same machine, so they are noisy.
Evidence:
[`output/verification/2026-10-04-store-hold/`](../../output/verification/2026-10-04-store-hold/).

Then the release reading: three runs, each on a fresh database migrated to
`0035`, on the laptop and PostgreSQL 16.2, the API in its `ci` environment.
Evidence:
[`output/verification/2026-10-04-hot-path/`](../../output/verification/2026-10-04-hot-path/).

| Case | p95, 2026-10-03 (worst of 3) | **p95, 2026-10-04 (worst of 3)** | p50 now | Budget |
|---|---|---|---|---|
| `GET /catalog/stock-options` | 6.3 | **6.2** | 5.6–5.7 | 300 ms |
| `GET /catalog/stock-options`, 6 sellers | 72.0 | **87.2** | 20.2–22.5 | 300 ms |
| `POST /sales`, 1 line | 12.1 | **11.7** | 9.4–10.1 | 500 ms |
| `POST /sales`, 1 line, 6 sellers | 192.0 | **71.7** | 33.3–41.3 | 500 ms |
| `POST /sales`, 4 lines, 6 sellers | 107.0 | **167.6** | 47.8–65.3 | 500 ms |
| `POST /sales`, same coat, 6 sellers | 65.3 | **50.4** | 35.8–40.2 | 500 ms |
| `POST /sales`, paid in parts | 13.6 | **12.1** | 8.9–10.1 | 500 ms |
| `POST /sales`, paid in parts, 6 sellers | 90.2 | **71.0** | 36.8–43.0 | 500 ms |

- **Every case passes in every run, gated.** The worst p95 is 167.6 ms
  against 500, about 3× headroom.
- **One seller is unchanged:** about 10 ms for a sale and 6 ms for the
  catalogue read. The trigger costs nothing one can see.
- **Six sellers at once are faster at the median than on 2026-10-03:** a
  four-line sale about 48–65 ms against 64, a sale paid in parts about 37–43
  ms against 49–50. That fits commands of one store no longer queuing on its
  row.
- **The 167.6 ms is one run's tail.** That run's p99 was 198 ms; the other
  two runs gave 87.0 and 77.8 ms for the same case. The same run also gave
  the catalogue read with six sellers 87.2 ms, against 28.2 and 26.8 in the
  others.

This closes row 22 again, for the laptop.

## Update — 2026-10-08: the mark of a sale typed from paper

The outage work ([ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md))
gave `POST /sales` an optional mark, «продано під час збою». For an ordinary
sale the field is read as nothing, and the sale sends the same 37
statements as before: its INSERT writes NULL for the mark's two details and
the database defaults the third. No new plpgsql trigger runs (the guard
fires only on an update of its own columns); the new foreign key adds one
internal check per insert, a no-op for NULL.

**Taps: still 5.** «Вношу продаж з паперу» sits above «Склад», off by
default, and asks nothing until ticked; the sellers' list is read only once
it is. A sale typed from paper is 6 for the first of a series (the switch),
then 5, since the switch and «Хто продав» stay on.

**The release reading,** checklist row 22: three runs, each on a fresh
database migrated to `0036`, on the laptop and PostgreSQL 16.2, the API in
its `ci` environment. Evidence:
[`output/verification/2026-10-08-hot-path/`](../../output/verification/2026-10-08-hot-path/).

| Case | p95, 2026-10-04 (worst of 3) | **p95, 2026-10-08 (worst of 3)** | p50 now | Budget |
|---|---|---|---|---|
| `GET /catalog/stock-options` | 6.2 | **11.9** | 9.6–10.3 | 300 ms |
| `GET /catalog/stock-options`, 6 sellers | 87.2 | **63.4** | 19.3–19.7 | 300 ms |
| `POST /sales`, 1 line | 11.7 | **17.6** | 11.3–11.8 | 500 ms |
| `POST /sales`, 1 line, 6 sellers | 71.7 | **52.2** | 32.1–33.8 | 500 ms |
| `POST /sales`, 4 lines, 6 sellers | 167.6 | **79.1** | 47.4–48.3 | 500 ms |
| `POST /sales`, same coat, 6 sellers | 50.4 | **85.9** | 36.2–38.1 | 500 ms |
| `POST /sales`, paid in parts | 12.1 | **25.0** | 11.2–14.5 | 500 ms |
| `POST /sales`, paid in parts, 6 sellers | 71.0 | **93.9** | 37.6–46.9 | 500 ms |

- **Every case passes in every run, gated.** The worst p95 is 93.9 ms
  against 500, about 5× headroom.
- **One seller is a little slower than on 2026-10-04,** about 11 ms for a
  sale against 10, and 10 ms for the catalogue read against 6, which the
  change does not touch. So the same laptop then read main's own code
  against the branch, alternately, three times each, on fresh databases:
  the two are indistinguishable in every case (catalogue read p50 8.1–10.6
  against 8.2–10.2; a one-line sale 10.0–10.7 against 9.7–10.9; the tails
  of six sellers scatter on both sides). The difference from 2026-10-04 is
  the machine on the day: agents were editing and checking code beside the
  readings. Evidence:
  [`ab/`](../../output/verification/2026-10-08-hot-path/ab/).

This closes row 22 again, for the laptop.

## Update — 2026-10-15: the till's search and one tap of a size

The till's second redesign part ([report](till-redesign-2-report.md)):
a model is found by a few letters, and a tap on its size puts it in the
basket, its quantity and price in the line. `GET /catalog/stock-options`
gained an optional `query` and reads by the model's name; `POST /sales` is
unchanged.

**Taps: 3,** for a model with a price, in a store with one warehouse to sell
from:

| | taps |
|---|---|
| open «Продаж» (the app opens on it, redesign P0-1) | 0 |
| choose the warehouse (one sellable: named) | 0 |
| the search, and three letters typed | 1 |
| the size's chip («M · 2») | 1 |
| quantity (`1`) and price (the model's) | 0 |
| a way: «Готівка», «Картка» or «Переказ» | 1 |
| **total** | **3** |

A model already on the list's first screen needs no search: 2. The next
sale: «Новий продаж» puts the cursor in the search, so 3 again, or 2 for a
model in view after it. A model with no price adds its price, typed; a
store with two warehouses adds the choice of one, once. The journey
`till-search.spec.ts` sells one priced coat by the search, its chip and a
way on a 360 × 640 screen, and the next by «Новий продаж», a chip and a
way; its store sells from several warehouses, so it chooses one first. The
one warehouse named rather than asked is `sale.spec.ts`'s.

**The search's cost.** Every word is a literal `LIKE` on the model's, the
source's and the colour's normalised names, no index, as receiving's search
is; the order adds receiving's order of sizes as a `CASE` over every size
the organisation has. The list without a search reads by name too, through
the same joins, for every screen that reads it («Продаж», «Залишки»,
«Постачальникам», «Нове замовлення»); the first two cases measure it. The
harness has two new cases, last, so the earlier eight compare as before:
`GET /catalog/stock-options · search`, alone and by six sellers,
alternating three letters every one of the 400 models shares (a hundred
rows to order) and «модель N», whose number also matches every model and
colour that contains it, about 160 of the 400: both broad, as a seller's
few letters are.

**The release reading,** checklist row 22: three runs, each on a fresh
database migrated to head, on the laptop and PostgreSQL 16.2, the API in
its `ci` environment, every case gated (`BIRKA_PERF_GATE=all`). Evidence:
[`output/verification/2026-10-15-till-search-hot-path/`](../../output/verification/2026-10-15-till-search-hot-path/).

| Case | p95, 2026-10-08 (worst of 3) | **p95, 2026-10-15 (worst of 3)** | p50 now | Budget |
|---|---|---|---|---|
| `GET /catalog/stock-options` | 11.9 | **12.2** | 7.6–9.8 | 300 ms |
| `GET /catalog/stock-options`, 6 sellers | 63.4 | **74.5** | 23.7–25.1 | 300 ms |
| `POST /sales`, 1 line | 17.6 | **12.1** | 9.3–9.7 | 500 ms |
| `POST /sales`, 1 line, 6 sellers | 52.2 | **53.3** | 33.8–34.3 | 500 ms |
| `POST /sales`, 4 lines, 6 sellers | 79.1 | **84.8** | 49.8–50.8 | 500 ms |
| `POST /sales`, same coat, 6 sellers | 85.9 | **87.7** | 37.7–38.3 | 500 ms |
| `POST /sales`, paid in parts | 25.0 | **10.9** | 9.4–9.5 | 500 ms |
| `POST /sales`, paid in parts, 6 sellers | 93.9 | **65.8** | 39.8–41.3 | 500 ms |
| `GET /catalog/stock-options · search` | — | **19.3** | 8.4–16.9 | 300 ms |
| `GET /catalog/stock-options · search`, 6 sellers | — | **95.5** | 28.6–31.1 | 300 ms |

- **Every case passes in every run, gated.** The worst p95 is 95.5 ms, the
  search by six sellers, against 300: about 3× headroom.
- **The list without a search reads by name now,** through the joins the
  search needs: by six sellers its p95 is 74.5 ms against 63.4 on
  2026-10-08, one seller's unchanged.
- **`POST /sales` is unchanged,** and its figures are within the earlier
  readings' spread.

## Update — 2026-10-26: the bottom menu's taps

The bottom menu's task list
([redesign/2026-10-26-redesign-tz-navigation.md](redesign/2026-10-26-redesign-tz-navigation.md))
asks for its taps to be recorded here; navigation had not been counted. The
taps from the till, the first screen once the store is open, typing not
counted:

| to | before | after | step | how counted |
|---|---|---|---|---|
| the returns' list | 1 («Повернення») | 1 («Повернути») | P0-1 | the switch under the till's heading, pressed in `till-sections.spec.ts` |
| the debts' list | 1 («Борги») | **1** («Клієнти») | P0-2 | `till-sections.spec.ts`, its counter of presses |
| the orders' list | 2 («Ще», «Замовлення») | **2** («Клієнти», «Замовлення») | P0-2 | the same |
| a new order's form | 2 («Ще», «+ Нове замовлення») | **3** («Клієнти», «Замовлення», «+») | P0-2 | the same |
| the stock | 2 («Ще», «Залишки») | **1** («Товар») | P0-3 | `till-sections.spec.ts`, its counter of presses |
| receiving | 2 («Ще», «Приймання») | **2** («Товар», «Прийшов товар») | P0-3 | the same |
| «Брак» | 2 («Ще», «Брак») | **2** («Товар», «Брак») | P0-3 | the same |
| a section of «Ще» | 2 («Ще», its button) | **2** («Ще», its row) | P0-4 | `till-sections.spec.ts`, the presses |
| another store | 1 («Змінити магазин» in the header) | **2** («Ще», «Змінити магазин») | P0-4 | `till-redesign.spec.ts`, the presses |
| the basket again, after another section | every chip again | **0** | P0-5 | `till-basket.spec.ts`: the same lines, prices and «Разом» back |

The counter is the page's own: every `pointerdown` from the first press,
in a store where this person has both debts and orders. A whole new order,
its search typed, is six taps where it was five (`orders-new.spec.ts`), the
task list's own count. A sale is unchanged — three taps, the till the first
screen — and no server request changed, so the hot path's cases stand as
last measured.

## Update — 2026-10-30: a sale's taps, counted at the till

The frame's task list
([redesign/2026-10-27-redesign-tz-all-on-the-tag.md](redesign/2026-10-27-redesign-tz-all-on-the-tag.md),
P0-5) takes the taps as its acceptance: three for a coat with a price, in a
store with one warehouse and in one with two; five paid in parts. Part 1
drew each size as a cell of its warehouse, and part 2 put the basket in a
sheet over the till ([tray](all-on-the-tag-tray-report.md),
[shortage](all-on-the-tag-shortage-report.md)). The counter is the page's
own, every `pointerdown` from the till, typing not counted
(`till-taps.spec.ts`; the goods and the sale's answer stubbed):

| | one warehouse | two warehouses | paid in parts |
|---|---|---|---|
| the search, and three letters typed | 1 | 1 | 1 |
| the size's cell — in two warehouses, the cell of the one it leaves from | 1 | 1 | 1 |
| the tray's row: the basket's sheet | — | — | 1 |
| «Оплата частинами»: the cursor in the name | — | — | 1 |
| the name, the phone and the sum paid now, each closed by the keyboard's key | — | — | 0 |
| a way: «Готівка», «Картка» or «Переказ» | 1 | 1 | 1 |
| **total** | **3** | **3** | **5** |

- **Two warehouses add nothing now:** the cell says where the coat leaves
  from, and the sale sends that warehouse with the line. Before part 1 a
  store with two chose one first: 4.
- **The app opened on the till** has the cursor in the search already
  (part 2): two taps, or four paid in parts.
- **Paid in parts:** the keyboard's key moves from the name to the phone
  and to the sum, and after the sum closes the sheet; the way is the fifth
  tap.
- **The shelf's question** (a basket with more than the books hold) adds
  one tap: its answer, which names the way and sells with it («Товар на
  місці — продати 3 · Готівка»).

No server request changed, so the hot path's cases stand as last measured.

## Update — 2026-10-30: «Сьогодні» first for whoever reads the report

Since «Сьогодні» ([part 1](all-on-the-tag-today-1-report.md); the frame's
P0-6, owner decision 2026-10-26, В3), whoever holds `report:view_financial`
in the store opens there, not on the till. From the app's opening their sale
with a price takes «Продаж», then the search, which a tab does not put the
cursor in (review, 2026-10-17), then the size's cell and a way: four taps,
where it was two. A seller still opens on the till with the cursor in the
search: two. The frame's three are counted from the till, and stand.
Whether the owner wants the two taps back is a reading for the owner.

## Update — 2026-10-31: a return's taps, counted at the till

The frame's P1-3 takes a return's taps as its acceptance: four, as before
(«возврат 4 → 4», the frame's §13). Its list is the till's place now
([returns](all-on-the-tag-returns-report.md)); the counter is the page's
own, every `pointerdown` from the till, its switch on «Продати»
(`returns-sale-screen.spec.ts`; the sale, its way and the return's answer
stubbed):

| | taps |
|---|---|
| «Повернути» under the till's heading: today's sales | 1 |
| the sale's row | 1 |
| «Цілі: більше» — a unit counted, the dock over the menu | 1 |
| the way back (the sale's own, offered) | 0 |
| «Повернути покупцю … готівкою» | 1 |
| **total** | **4** |

- **A sale not among today's first rows** takes the search, and its
  letters, before the row: five.
- **A way the sale does not offer** — read and refused, or a sale with
  none — is a tap more: five (the update of 2026-10-04, above).

No server request changed, so the hot path's cases stand as last measured.
