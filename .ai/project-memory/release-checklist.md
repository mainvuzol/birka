# Milestone 1 — release checklist

First assessed on 2026-10-01 at `64996e3` (people, PR #49). Re-assessed on
2026-10-02 at `a834dba` (the sales report, PR #62). Rows 2, 3 and 22 updated
on 2026-10-03 for correcting the catalogue (`feat/catalog-correction`).
Rows 3, 11b, 16, 19 and 22 updated on 2026-10-03 for failures are visible
(`feat/failures-visible`). Re-assessed on 2026-10-04 for cash and card, the
day's close (`feat/cash-and-card`): rows 2, 3, 8, 10 and 22, and the list of
what does not block. Re-assessed on 2026-10-08 for the server is unreachable
(`feat/outage-fallback`): rows 2, 3, 10 and 22, the new rows 24 and 25, and
the list of what does not block. The verdict stands.

**Verdict: BLOCKED.** Everything the agent can build and prove without a
server or a person is done, including a way in for the shops' existing stock:
lists with review and «Початкові залишки». The outage work changed
`POST /sales`, so the hot path's release reading (row 22) and the count of a
sale's taps (row 10) were taken again on 2026-10-08: every case passes, and
a sale is still 5 taps. The rest needs the owner, an administrator with a
server, and the shops.

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
| 2 | **Every flow in the app.** The till, receiving, stock and corrections, returns and «Брак», orders, catalogue review, prices, and a size given at the counter. Since PR #49, also, several for the owner and managers only: the shops' existing stock, paying in parts and «Борги», returns at another store, store states, returns to a supplier, «Накладні», borrowed goods, where an order goes, «Звіт», and correcting the catalogue («Моделі»). Since 2026-10-04, for sellers too: the way of paying at the till, in «Борги», on returns and at «Клієнт забрав», and «Каса», the day's close. Since 2026-10-08, when the server does not answer: every screen says to sell on paper, a phone checks its kept operations by itself, and a sale typed from paper («Вношу продаж з паперу») carries the mark «продано під час збою». | [till](m1-025-sale-ui-report.md) · [receiving](receiving-ui-report.md) · [corrections](stock-correction-ui-report.md) · [returns](till-returns-report.md) · [«Брак»](damaged-inspection-report.md) · [prices](suggested-price-report.md) · [opening stock](opening-stock-screen-report.md) · [paying in parts](credit-screens-report.md) · [returns elsewhere](returns-elsewhere-report.md) · [store states](store-states-report.md) · [supplier returns](supplier-returns-report.md) · [invoices](supplier-invoices-report.md) · [borrowed goods](borrowed-goods-report.md) · [order shipping](order-shipping-report.md) · [sales report](sales-report-report.md) · [correcting the catalogue](catalog-correction-report.md) · [cash and card](cash-and-card-report.md) · [the server is unreachable](outage-fallback-report.md) |
| 3 | **Golden paths pass end to end.** 239 Playwright journeys on a phone profile, against the real API and PostgreSQL 17, on every push. | [E2E in CI](m1-027-e2e-ci-report.md); 134 with [the first days](first-days-report.md), 149 with [correcting the catalogue](catalog-correction-report.md), 152 with [one size, one spelling](size-spelling-report.md), 156 [before the public domain](public-hardening-report.md), 168 with [failures are visible](failures-visible-report.md), 182 with [cash and card](cash-and-card-report.md), 239 with [the server is unreachable](outage-fallback-report.md) |
| 4 | **Every backend test on PostgreSQL 17** with the production locale, on every push. | CI job `backend` |
| 5 | **A backup proves itself by restoring.** The `ops` image backs up, restores into a scratch database, checks it and encrypts it, end to end in CI on PostgreSQL 17. | [backup report](m1-028-backup-restore-report.md) · CI job `restore-drill` |
| 6 | **The owner hears of a failed or missing night**, in the app and in Telegram. | [alerts report](m1-028-backup-alerts-report.md) |
| 7 | **People can be given a store**, on an owner's word. | [people report](people-report.md) |
| 8 | **Server budgets, on a laptop.** Catalogue read p95 ≤ 300 ms and `POST /sales` p95 ≤ 500 ms, re-measured after PRs #47–#49: 5× headroom or more. `POST /sales` has changed since (paying in parts, store states, the way of paying and the drawer's stamp): see row 22. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-release-gate) |
| 9 | **The same budgets on PostgreSQL 17, in CI.** One seller has 10× headroom even on a two-CPU runner: p95 29 ms for the catalogue read, 49 ms for a sale. Six sellers asking back to back stay within budget, but by as little as 3 %. CI therefore gates the one-seller cases and prints the rest. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-first-postgresql-17-figures-and-what-ci-fails-on) · CI job `hot-path` |
| 10 | **`taps-to-sale` ≤ 5**, for a model with a suggested price. Recounted on 2026-10-04: still 5, the last tap a way («Готівка», «Картка» or «Переказ») instead of «Продати». Recounted on 2026-10-08 on the built till: still 5. «Вношу продаж з паперу» is off by default and asks nothing until ticked, and a normal sale's body has no mark (ADR-0013 §7; e2e `outage.spec.ts` journey 5). | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-suggested-price) · [recount](hot-path-budget-report.md#update--2026-10-04-the-way-button-and-the-drawers-stamp) |
| 11 | **The API refuses to start in production without its secrets**, and hides its API docs there. | `test_config.py`, `test_app.py` |
| 11a | **Safe on a public domain.** No customer's name or phone in the logs or Sentry; a body over 1 MB refused at the edge; 30 sign-ins a minute per address; a person's sign-ins can be ended; the page never cached, the previous bundle kept, no source maps; the server installs exactly the tested libraries, audited in CI; the owner warned a week before the certificate runs out. CI's `edge` job proves the Caddyfile and the images. | [report](public-hardening-report.md), [ADR-0010](../decisions/ADR-0010-before-the-public-domain.md) |
| 11b | **Failures are visible.** The bot tells the owner and the administrators when the app, its database or its disk fails, or nobody can sign in, with a sound in the shops' hours. An outside check-in notices a server that dies whole. `/api/v1/ready` and compose's healthcheck show the API's state. A broken screen shows «Щось пішло не так» and «Перезапустити» and notes the server's log; a server error shows its number. The nightly backup cannot hang or overlap. | [report](failures-visible-report.md), [ADR-0011](../decisions/ADR-0011-failures-are-visible.md) |
| 12 | **Store and organization boundaries hold** on every command. | invariants I12/I13; the reviews in each report |
| 13 | **Docker logs are bounded.** 5 × 10 MB per service, so the disk cannot fill with them. | `infra/docker-compose.yml`, PR #50; CI validates the file |
| 14 | **A runbook for the server.** Install, the shops' existing stock, update, go back, and the security that applies. | [server runbook](server-runbook.md), PR #50; step 9 rewritten on 2026-10-02 |
| 22 | **The hot path's release reading, every case gated** (`BIRKA_PERF_GATE=all`), after the last change to `POST /sales`. Taken again on 2026-10-08 on the laptop, after the outage work's optional mark (ADR-0013 §11: one field read as nothing; its INSERT writes NULL for the mark's two details and the database defaults `during_outage`; no new plpgsql trigger runs, and the new foreign key adds one internal check per insert, a no-op for NULL; no extra statement, 37 per sale before and after): three times on fresh databases migrated to `0036`, and all 8 cases pass every run. Worst p95 93.9 ms against 500 (run 3, paid in parts with six sellers; runs 1 and 2 at most 79.1 ms), one seller about 11 ms. Before: 167.6 ms on 2026-10-04, 192 ms on 2026-10-03. A reading on the server is optional. | [hot path report](hot-path-budget-report.md#update--2026-10-08-the-mark-of-a-sale-typed-from-paper) · [2026-10-04](hot-path-budget-report.md#update--2026-10-04-the-way-button-and-the-drawers-stamp) |

## Still to do — and who does it

| # | | Who | Status |
|---|---|---|---|
| 15 | **The shops' existing stock gets in**, before anything moves in that warehouse ([runbook, step 9](server-runbook.md#9-the-shops-existing-stock-before-anything-moves)). On 2026-10-01 the owner allowed two ways and has not yet chosen between them: either lists with review (ADR-0005), or photos of the notebooks → a separate parser → JSON. Whatever is still missing is added one by one, through «Приймання» with its size (owner, 2026-10-02). **Lists with review have their screen, «Початкові залишки»** ([report](opening-stock-screen-report.md), PR #52), and nothing moves in a warehouse while its list waits ([report](first-days-report.md)). The JSON way waits for the owner's choice and the parser's format. | the owner chooses the way; the shops build the catalogue and type one list per warehouse; the owner approves each (a child store's own warehouse: whoever holds the owner's role in `SECOND` itself, Q5) | the screen is merged; not started in the shops |
| 16 | **A server:** domain, HTTPS, Docker, `.env` with `BIRKA_APP_ENV=production` and the bot's token. Since 2026-10-03, also who hears of trouble: the administrator's Telegram id, and the outside check-in service in the owner's name ([runbook, step 8a](server-runbook.md#8a-being-told-when-something-fails)), given at publication or a test, when the owner says so. | administrator. Who provides the server and the domain, and who administers it, is not recorded: ask the owner | not started |
| 17 | **The bot's menu button** opens `https://<domain>/`. | administrator | not started |
| 18 | **The owner and the shop's places** (`seed_organization`), then the sellers (`scripts.people`). | administrator, on the owner's word | not started |
| 19 | **Backups on the server:** the owner's key, the first night, cron and its log rotation, the owner's computer collecting copies, and «Start» pressed in the bot. Then the trouble messages tried once, before the shops use the app (runbook, step 8a.3). | administrator, owner | not started |
| 20 | **One full restore rehearsed on the server**, as the runbook's "restoring for real" describes. The nightly drill restores every night, but the manual sequence has never run. | administrator | not started |
| 21 | **`time-to-sale` ≤ 15 s**, a person timing a real sale on a phone, in the shop. | owner or a seller | not measured |
| 24 | **An outage drill on a real phone in Telegram** ([ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md)). With the API stopped: the paper text at sign-in. In airplane mode with the app open: the till says it, and a kept sale is checked by itself when the network is back. The app closed during the outage and opened after it: the kept sale checked on opening. The whole server stopped: what Telegram shows, recorded. What the WebView does offline is unmeasured until then (risk register). | owner or administrator | not started |
| 25 | **The sellers' page, confirmed and handed to the shops.** [When the server is down](paper-when-the-server-is-down.md) is a draft until the owner confirms what the paper records and the page's rules (G14) and the paper switch always on (G20), in the business rules ("the server is unreachable", "how it is carried out"). | owner | draft |
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
| **Correcting the catalogue** | Done on 2026-10-03 (owner decisions): the owner and managers rename a model, merge a duplicate into the model that stays, and retire a model and bring it back; a similar name is warned about at creation ([report](catalog-correction-report.md)). |
| **One size, one spelling** | Done on 2026-10-03 (owner decisions): `M`, `m` and `м`, or `2XL` and `XXL`, are one size with one balance, whatever size system they were typed under, shown in one spelling ([report](size-spelling-report.md)). |
| **Goods borrowed from another shop** | Done on 2026-10-01 (owner decisions): taken at an agreed price, marked sold into «Накладні», sent back unsold ([report](borrowed-goods-report.md)). |
| **Settling money between the network's stores** | Not needed: stores of one network do not settle with each other (owner, 2026-10-01). |
| **A sales report** | Done on 2026-10-02 (owner decisions): what each store sold and took back, and the money through its till ([report](sales-report-report.md)). |
| **Cash and card, the day's close** | Done on 2026-10-04 (owner decisions): each payment says how it was paid, one drawer per store is counted blind once a day, cash taken out and put in is recorded, a difference needs a reason and the bot tells the owner silently, and «Звіт» splits the money by way ([report](cash-and-card-report.md)). The readings the owner has not confirmed yet are listed in the business rules; each is cheap to change before going live. After the deploy, the app is reopened on every phone. |
| **The server is unreachable** | Done on 2026-10-08 (owner decisions, 2026-10-04 and 2026-10-07): every screen says to sell on paper, a refusal that proves nothing was recorded settles the phone, the phone checks its kept operations by itself, a sale typed from paper carries the mark «продано під час збою», and the bot says the shops sell on paper ([report](outage-fallback-report.md)). The readings the owner has not confirmed yet are listed in the business rules; the sellers' page waits for two of them (row 25). |
| **An offline mode** (the phone records sales and sends them later) | Not built: the owner chose paper when the server does not answer (2026-10-04), and an offline mode may be judged later, on real outages ([backlog](backlog.md)). |
