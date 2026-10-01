# Milestone 1 — release checklist

Assessed on 2026-10-01 at `64996e3` (people merged as PR #49), with this
branch's additions marked.

**Verdict: BLOCKED.** Everything the agent can build and prove without a
server or a person is done, except one thing: how the shops' existing stock
gets in. The rest needs the server, the shop, or the owner.

By the release-manager rule, the agent that built this does not approve
its own release. The owner signs it off once every row below is ✅ or
accepted.

## Built and proven

| # | | Evidence |
|---|---|---|
| 1 | **A sale end to end, with its invariants.** Create a product, receive it and sell it, including both bounded in-sale corrections. | [M1B gate](m1b-completion-report.md) · [«фізично відсутній»](m1-030-missing-at-sale-report.md) · [empty shelf](empty-shelf-report.md) |
| 2 | **Every seller flow in the app.** The till, receiving, stock and corrections, returns and «Брак», orders, catalogue review, prices, and a size given at the counter. | [till](m1-025-sale-ui-report.md) · [receiving](receiving-ui-report.md) · [corrections](stock-correction-ui-report.md) · [returns](till-returns-report.md) · [«Брак»](damaged-inspection-report.md) · [prices](suggested-price-report.md) |
| 3 | **Golden paths pass end to end.** 83 Playwright journeys on a phone profile, against the real API and PostgreSQL 17, on every push. | [E2E in CI](m1-027-e2e-ci-report.md); 83 since PR #49 |
| 4 | **Every backend test on PostgreSQL 17** with the production locale, on every push. | CI job `backend` |
| 5 | **A backup proves itself by restoring.** The `ops` image backs up, restores into a scratch database, checks it and encrypts it, end to end in CI on PostgreSQL 17. | [backup report](m1-028-backup-restore-report.md) · CI job `restore-drill` |
| 6 | **The owner hears of a failed or missing night**, in the app and in Telegram. | [alerts report](m1-028-backup-alerts-report.md) |
| 7 | **People can be given a store**, on an owner's word. | [people report](people-report.md) |
| 8 | **Server budgets, on a laptop.** Catalogue read p95 ≤ 300 ms and `POST /sales` p95 ≤ 500 ms, re-measured after PRs #47–#49: 5× headroom or more. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-release-gate) |
| 9 | **The same budgets on PostgreSQL 17, in CI.** One seller has 10× headroom even on a two-CPU runner: p95 29 ms for the catalogue read, 49 ms for a sale. Six sellers asking back to back stay within budget, but by as little as 3 %. CI therefore gates the one-seller cases and prints the rest. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-first-postgresql-17-figures-and-what-ci-fails-on) · CI job `hot-path` |
| 10 | **`taps-to-sale` ≤ 5**, for a model with a suggested price. | [hot path report](hot-path-budget-report.md#update--2026-10-01-the-suggested-price) |
| 11 | **The API refuses to start in production without its secrets**, and hides its API docs there. | `test_config.py`, `test_app.py` |
| 12 | **Store and organization boundaries hold** on every command. | invariants I12/I13; the reviews in each report |
| 13 | **Docker logs are bounded.** *This branch.* 5 × 10 MB per service, so the disk cannot fill with them. | `infra/docker-compose.yml`; CI validates the file |
| 14 | **A runbook for the server.** *This branch.* Install, update, go back, and the security that applies. | [server runbook](server-runbook.md) |

## Still to do — and who does it

| # | | Who | Status |
|---|---|---|---|
| 15 | **The shops' existing stock gets in.** The owner chose on 2026-10-01: either lists with review (ADR-0005, server side built) or photos of the notebooks → a separate parser → JSON. Whatever is still missing is added one by one. Neither has a screen yet. | agent, then the shops | **blocker: build next** |
| 16 | **A server:** domain, HTTPS, Docker, `.env` with `BIRKA_APP_ENV=production`. | administrator | not started |
| 17 | **The bot's menu button** opens `https://<domain>/`. | administrator | not started |
| 18 | **The owner and the shop's places** (`seed_organization`), then the sellers (`scripts.people`). | administrator, on the owner's word | not started |
| 19 | **Backups on the server:** the owner's key, the first night, cron, the owner's computer collecting copies, and «Start» pressed in the bot. | administrator, owner | not started |
| 20 | **One full restore rehearsed on the server**, as the runbook's "restoring for real" describes. The nightly drill restores every night, but the manual sequence has never run. | administrator | not started |
| 21 | **`time-to-sale` ≤ 15 s**, a person timing a real sale on a phone, in the shop. | owner or a seller | not measured |
| 22 | **The owner's sign-off.** | owner | — |

## Decided not to block the release

| | |
|---|---|
| **Moving goods between warehouses has no screen** | Not needed. Both stores sell from one shared warehouse (owner, 2026-10-01). Build it when a separate warehouse appears; the server side exists. |
| **Store states** (blocked, archived), **payments and installments** | Owner decisions from 2026-09-15. They need the owner's rules before any code. |
| **A return to the supplier** | Written off with a note until it has a step of its own. |
| **Returns at another store** | An open owner question. A return goes through the store that sold. |
| **Renaming a store** | No command yet. The seed names them «Основний магазин» and «Другий магазин». |
| **Catalog: verified promotion and broader ambiguity resolution** (M1-021/022) | Needs human-confirmed evaluation data that does not exist yet. Review by a person works today. |
| **Q5, confirming a transfer on arrival** | Transfers are single-step; nothing uses them yet. |
| **A real device profile** (phone, mobile network, Telegram webview) | Row 21 is its practical form. |
