# Milestone 1 — release checklist

First assessed on 2026-10-01 at `64996e3` (people, PR #49). Re-assessed on
2026-10-02 at `a834dba` (the sales report, PR #62).

**Verdict: BLOCKED.** Everything the agent can build and prove without a
server or a person is done, including a way in for the shops' existing stock:
lists with review, «Початкові залишки». One reading is still the agent's: the
hot path's, with every case gated (row 22). The rest needs the owner, an
administrator with a server, and the shops.

**The order matters.** The shops' existing stock goes into a warehouse
before anything else is recorded there, or never as an opening balance:
[server runbook, step 9](server-runbook.md#9-the-shops-existing-stock-before-anything-moves).

By the release-manager rule, the agent that built this does not approve
its own release. The owner signs it off once every row below is ✅ or
accepted.

## Built and proven

| # | | Evidence |
|---|---|---|
| 1 | **A sale end to end, with its invariants.** Create a product, receive it and sell it, including both bounded in-sale corrections. | [M1B gate](m1b-completion-report.md) · [«фізично відсутній»](m1-030-missing-at-sale-report.md) · [empty shelf](empty-shelf-report.md) |
| 2 | **Every flow in the app.** The till, receiving, stock and corrections, returns and «Брак», orders, catalogue review, prices, and a size given at the counter. Since PR #49, also, several for the owner and managers only: the shops' existing stock, paying in parts and «Борги», returns at another store, store states, returns to a supplier, «Накладні», borrowed goods, where an order goes, and «Звіт». | [till](m1-025-sale-ui-report.md) · [receiving](receiving-ui-report.md) · [corrections](stock-correction-ui-report.md) · [returns](till-returns-report.md) · [«Брак»](damaged-inspection-report.md) · [prices](suggested-price-report.md) · [opening stock](opening-stock-screen-report.md) · [paying in parts](credit-screens-report.md) · [returns elsewhere](returns-elsewhere-report.md) · [store states](store-states-report.md) · [supplier returns](supplier-returns-report.md) · [invoices](supplier-invoices-report.md) · [borrowed goods](borrowed-goods-report.md) · [order shipping](order-shipping-report.md) · [sales report](sales-report-report.md) |
| 3 | **Golden paths pass end to end.** 133 Playwright journeys on a phone profile, against the real API and PostgreSQL 17, on every push. | [E2E in CI](m1-027-e2e-ci-report.md); 133 since PR #62 |
| 4 | **Every backend test on PostgreSQL 17** with the production locale, on every push. | CI job `backend` |
| 5 | **A backup proves itself by restoring.** The `ops` image backs up, restores into a scratch database, checks it and encrypts it, end to end in CI on PostgreSQL 17. | [backup report](m1-028-backup-restore-report.md) · CI job `restore-drill` |
| 6 | **The owner hears of a failed or missing night**, in the app and in Telegram. | [alerts report](m1-028-backup-alerts-report.md) |
| 7 | **People can be given a store**, on an owner's word. | [people report](people-report.md) |
| 8 | **Server budgets, on a laptop.** Catalogue read p95 ≤ 300 ms and `POST /sales` p95 ≤ 500 ms, re-measured after PRs #47–#49: 5× headroom or more. `POST /sales` has changed since (paying in parts, store states): see row 22. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-release-gate) |
| 9 | **The same budgets on PostgreSQL 17, in CI.** One seller has 10× headroom even on a two-CPU runner: p95 29 ms for the catalogue read, 49 ms for a sale. Six sellers asking back to back stay within budget, but by as little as 3 %. CI therefore gates the one-seller cases and prints the rest. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-first-postgresql-17-figures-and-what-ci-fails-on) · CI job `hot-path` |
| 10 | **`taps-to-sale` ≤ 5**, for a model with a suggested price. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-suggested-price) |
| 11 | **The API refuses to start in production without its secrets**, and hides its API docs there. | `test_config.py`, `test_app.py` |
| 12 | **Store and organization boundaries hold** on every command. | invariants I12/I13; the reviews in each report |
| 13 | **Docker logs are bounded.** 5 × 10 MB per service, so the disk cannot fill with them. | `infra/docker-compose.yml`, PR #50; CI validates the file |
| 14 | **A runbook for the server.** Install, the shops' existing stock, update, go back, and the security that applies. | [server runbook](server-runbook.md), PR #50; step 9 rewritten on 2026-10-02 |

## Still to do — and who does it

| # | | Who | Status |
|---|---|---|---|
| 15 | **The shops' existing stock gets in**, before anything moves in that warehouse ([runbook, step 9](server-runbook.md#9-the-shops-existing-stock-before-anything-moves)). On 2026-10-01 the owner allowed two ways and has not yet chosen between them: either lists with review (ADR-0005), or photos of the notebooks → a separate parser → JSON. Whatever is still missing is added one by one, through «Приймання» with its size (owner, 2026-10-02). **Lists with review have their screen, «Початкові залишки»** ([report](opening-stock-screen-report.md), PR #52). The JSON way waits for the owner's choice and the parser's format. | the owner chooses the way; the shops build the catalogue and type one list per warehouse; the owner approves each (a child store's own warehouse: whoever holds the owner's role in `SECOND` itself, Q5) | the screen is merged; not started in the shops |
| 16 | **A server:** domain, HTTPS, Docker, `.env` with `BIRKA_APP_ENV=production` and the bot's token. | administrator. Who provides the server and the domain, and who administers it, is not recorded: ask the owner | not started |
| 17 | **The bot's menu button** opens `https://<domain>/`. | administrator | not started |
| 18 | **The owner and the shop's places** (`seed_organization`), then the sellers (`scripts.people`). | administrator, on the owner's word | not started |
| 19 | **Backups on the server:** the owner's key, the first night, cron, the owner's computer collecting copies, and «Start» pressed in the bot. | administrator, owner | not started |
| 20 | **One full restore rehearsed on the server**, as the runbook's "restoring for real" describes. The nightly drill restores every night, but the manual sequence has never run. | administrator | not started |
| 21 | **`time-to-sale` ≤ 15 s**, a person timing a real sale on a phone, in the shop. | owner or a seller | not measured |
| 22 | **The hot path's release reading**, with every case gated (`BIRKA_PERF_GATE=all`), after the last change to `POST /sales`. CI gates one seller on every push and only prints six (row 9). The reading that gates them all was last taken before PR #54 changed `POST /sales`. | agent | not retaken since PR #54 |
| 23 | **The owner's sign-off.** | owner | — |

## Decided not to block the release

What is still to be built after the release, and what waits on the owner,
is listed in the [backlog](backlog.md).

| | |
|---|---|
| **Moving goods between warehouses has no screen** | Not needed. Both stores sell from one shared warehouse (owner, 2026-10-01). Build it when a separate warehouse appears; the server side exists. |
| **Store states** (blocked, archived) | Done on 2026-10-01 (owner decisions): the owner of the network blocks, archives and reopens a store in the app; a store that does not trade is only read ([report](store-states-report.md)). |
| **The store's purchase installments** | Done on 2026-10-01 (owner decisions): the owner and managers record what the store owes a supplier for each invoice, on its own and never with a delivery, pay it in parts, set returned goods off against it, and cancel mistakes; the owner writes off what is left ([report](supplier-invoices-report.md)). |
| **A return to the supplier** | Done on 2026-10-01 (owner decisions): the owner and managers return goods from a warehouse or a confirmed unit from «Брак» to a supplier from the network's list, and may cancel it ([report](supplier-returns-report.md)). |
| **Returns at another store** | Done on 2026-10-01 (owner decisions): any store of the network takes the goods back and hands the money back ([report](returns-elsewhere-report.md)). |
| **Renaming a store** | Done on 2026-10-01 (owner decision): the seed takes the real names, and `scripts.stores rename` changes one on an owner's word. |
| **Catalog: verified promotion and broader ambiguity resolution** (M1-021/022) | Needs human-confirmed evaluation data that does not exist yet. Review by a person works today. |
| **Q5, confirming a transfer on arrival** | Transfers are single-step; nothing uses them yet. |
| **A real device profile** (phone, mobile network, Telegram webview) | Row 21 is its practical form. |
| **Paying in parts** | Done on 2026-10-01 (owner decisions): a customer pays part now and owes the rest to the store that sold, and «Борги» keeps it ([report](credit-screens-report.md)). |
| **Where an order goes** | Done on 2026-10-01 (owner decisions): within Ukraine by carrier and waybill, or abroad in one line ([report](order-shipping-report.md)). |
| **Goods borrowed from another shop** | Done on 2026-10-01 (owner decisions): taken at an agreed price, marked sold into «Накладні», sent back unsold ([report](borrowed-goods-report.md)). |
| **Settling money between the network's stores** | Not needed: stores of one network do not settle with each other (owner, 2026-10-01). |
| **A sales report** | Done on 2026-10-02 (owner decisions): what each store sold and took back, and the money through its till ([report](sales-report-report.md)). |
