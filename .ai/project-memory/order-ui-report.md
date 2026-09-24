# Seller order interface — 2026-09-24

Status: implemented and locally verified. Baseline `d66afed` (PR #21).
This is the order slice of M1D; it does not close all of M1D or the release gate.

## Delivered scope and acceptance

- Telegram signed launch data is submitted to the existing backend login; session
  token stays in memory. No development login bypass. Ready/theme bridge calls
  are centralized in `shared/telegram.ts`.
- Seller explicitly chooses store, warehouse, product/size, quantity and negotiated
  unit price. Prices remain decimal strings with bigint arithmetic in UI.
- Paginated order list/detail and create, dispatch, arrive, collect, cancel,
  physically confirmed return. Collection records the sale, not payment.
- Loading/error/empty states, mobile layout, accessible labels, keyboard controls.
- One pending immutable command per current store journal. Journal survives
  closing/reopening and is scoped to org/user/store, never contains credentials.
  Lost response does not mint a new UUID. Success is followed by reading current
  order state; historic replay response cannot regress the visible status.
- A later access denial cannot erase an earlier uncertain command. A first,
  definitive validation/conflict rejection leaves the draft editable.
- Protected read APIs supply order pages and named stock options. SQL filters
  inaccessible orders before pagination; catalog remains a leaf module.
- No schema migration or production action; server remains stock/money authority.

## Verification

Backend: **535 passed**, no skips, 2 dependency deprecation warnings (41.92s),
including list pagination, revoked/private/cross-tenant access and legacy lifecycle.
Ruff lint/format, mypy (64 source files), and 11 import contracts passed.
Frontend lint, strict typecheck and production build passed.
Playwright: **7 passed** (4.2s). Chromium tests use the actual FastAPI server and isolated PostgreSQL
16.2; Telegram auth is real signature verification with a synthetic bot token.
The bridge-only ready/theme test uses a simulated Telegram host.
See `output/verification/2026-09-24-order-ui/` for logs and mobile screenshot.

Independent review found two retry defects (session-only persistence and dropping
uncertain commands after denied retries). Both were fixed and covered through
browser tests. It found no blocking backend read-access issue. The return form
was also hidden after successful physical return.

## Reproducing the browser checks

Use a disposable PostgreSQL database named `birka_orders_ui` on
`127.0.0.1:55442`, user `birka_review`; fixture refuses other targets. Apply normal
migrations first. From `backend/`, with its test dependencies installed:

```sh
export BIRKA_TEST_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55442/birka_orders_ui
export BIRKA_E2E_FIXTURE=/tmp/birka-orders-ui-fixture.json
python -m scripts.seed_orders_e2e
BIRKA_DATABASE_URL="$BIRKA_TEST_DATABASE_URL" BIRKA_TELEGRAM_BOT_TOKEN=123456:TEST-TOKEN-not-a-real-secret BIRKA_SESSION_SECRET=birka-e2e-only-not-a-real-secret-20260924 uvicorn app.main:create_app --factory --host 127.0.0.1 --port 58042
```

In another terminal, from `frontend/`:

```sh
npm ci
PLAYWRIGHT_BROWSERS_PATH=/tmp/birka-orders-ui-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/birka-orders-ui-browsers npm run test:e2e
```

The tests start their own Vite server on 5178. Only synthetic credentials belong
in this fixture. Do not point it at a work/production database.

## Remaining scope and limits

- Real Android/iOS Telegram webviews, PostgreSQL 17 and staging were not exercised
  for this slice. The browser suite emulates a mobile viewport in Chromium.
- Simultaneous independent tabs are not globally coordinated; this UI is designed
  for one active Mini App view. Backend command idempotency still holds.
- No customer contacts/tracking number, payments/installments, order editing,
  partial shipments, automatic reservation expiry or ordinary POS/refund UI here.
- Names may repeat for distinct product families; no product merging was added.
- Pending payloads include product/pricing data; they remain locally until resolved.
  Corrupt journals fail closed and require support rather than silent deletion.
- No push/merge/deployment; product owner handles Git publication.

Cleanup: test API stopped, task-specific `birka_orders_ui` database dropped,
isolated PostgreSQL stopped. No work database, Docker image or other project changed.
