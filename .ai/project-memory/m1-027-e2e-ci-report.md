# Every journey in CI (M1-027) — 2026-10-01

Baseline: `92d7a67` (PR #44).
Status: implemented and replayed locally. CI only — no code, schema or API
change.
Branch: `feat/m1-027-e2e-in-ci`.

## Why this was next

Gate M1D's exit criterion is that "golden paths pass end to end". The
`golden-path-release-gate` skill asks that they "run against release
candidates" and "block release on failure". The 61 Playwright journeys ran
only on a developer's machine, against PostgreSQL 16.2, and only when someone
remembered. CI checked the frontend's lint, types and build, never its
behaviour.

## What exists now

A CI job, `e2e`, runs on every push and pull request:

1. It starts PostgreSQL 17 with the production locale (ICU `uk-UA`). The
   service is shaped exactly as the seed demands: user `birka_review`, no
   password, `127.0.0.1:55442`, database `birka_orders_ui`. The seed refuses
   any other, so it cannot be pointed at a real shop.
2. It migrates, then seeds the synthetic shop, its owner and their backup
   nights.
3. It starts the real API.
4. It runs every journey in Chromium on a Pixel 7 profile. On failure it
   keeps the traces and the API log.

## The golden paths, and where each is proven

| Golden path (`golden-path-release-gate`) | Journeys |
|---|---|
| Open the app | every spec: signed Telegram launch data → `/auth/telegram` → `/me` |
| Find a product | `sale.spec`, `catalog.spec`, `receive.spec` |
| Make a sale | `sale.spec`, `size.spec` |
| See the stock it moved | `sale.spec` («a seller sells stock the ledger agrees with…»), `stock.spec`, `correct.spec` |
| Refund or return | **a customer order's return only** (`orders.spec`). **A till sale cannot be returned from the app yet.** |

The last row is open. `POST /sales/{sale_id}/refunds` exists (M1-017), but no
screen calls it, and it cannot be built without the owner. On 2026-09-15 the
owner asked that returned units be marked intact or damaged, and that
"damaged" not silently go back on sale. What happens to a damaged unit was
left "to be designed" (owner-decisions-2026-09-15.md §3). The refund command
still takes a single `restock` yes/no.

## Evidence

- **The job's steps, replayed locally** with the same environment:
  - a fresh database;
  - the seed and its fixture;
  - the API reporting `"environment": "ci"`;
  - **61 of 61 journeys passed** in 28 s.
- **Not yet run on GitHub.** This PR's own CI is the first run on PostgreSQL
  17. It is also the first time the browser is installed by
  `playwright install --with-deps`.

## Changed files

- `.github/workflows/ci.yml` — the `e2e` job.
- `README.md` — where the journeys run.
- The milestone status and this report.
