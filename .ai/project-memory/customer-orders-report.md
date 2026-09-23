# Customer orders / reservations — 2026-09-23

Owner decision: a completed sale is recorded when the customer collects the
shipment. Dispatch, postal arrival and payment are separate facts.

## Delivered backend scope

- `READY_TO_DISPATCH` reserves an explicit basket; physical stock is unchanged.
- `DISPATCHED` consumes the reservation and writes `ORDER_DISPATCH` once.
- `ARRIVED` changes postal status only; `COLLECTED` creates one completed sale,
  using frozen order names/prices, without another stock decrement.
- `CANCELLED` is available before dispatch; releases holds even at paused locations.
- Before collection, `RETURNED` requires explicit physical receipt and a reason;
  goods return once to their original warehouse. Collected sales use sale refunds.
- Current tenant, store and private-location permissions checked before replay.
- Permanent command fingerprint/response, order row locks and ordered stock locks
  serialize retries and competing operations. Prices use Decimal and NUMERIC.
- Physical/reserved/available quantities are exposed separately. Sales, transfers
  and corrections cannot consume reservations belonging to another order.
- Migration 0010 adds reservations; 0011 adds orders. No historical sales or stock
  are backfilled. Downgrade refuses order/reservation history. Older builds that
  ignore reservations/private controls are unsafe while such data exists.

API and request details are in the README. This slice is backend-only: no
seller UI, postal provider integration, customer/contact directory, partial
shipment, reservation expiry or payment/installment accounting is implied.
Whole orders transition together; postal arrival precedes collection.

## Verification

Isolated portable PostgreSQL 16.2 in `/tmp`, port 55442; disposable databases
`birka_orders_check` and `birka_orders_migration`. No work databases, Docker
images, global configuration or other projects were modified.

- Full pytest: **532 passed**, no skips, 2 dependency deprecation warnings, 24.42s.
  See `output/verification/2026-09-23-customer-orders/pytest.txt`.
- Ruff lint/format, mypy and all 11 import-boundary contracts passed.
- Fresh upgrade to head, downgrade to base and re-upgrade passed.
- `alembic check`: no schema drift.
- Populated-order downgrade was refused with its intentional history guard;
  schema remained at head and drift check still passed.
- Initial independent review identified misleading correction advice for reserved
  stock and inability to cancel a paused warehouse hold; both fixed with regression
  coverage. Further independent review status is recorded below.

PostgreSQL 17 and frontend E2E have not been rerun for this slice. The prior
PostgreSQL 17 evidence covers earlier milestones, not these new migrations.

A second specialist independently reviewed the collection financial helper,
reservation core and migration 0010 and reported no blocking findings. Root
reviewed order authorization, transitions, permanent replay and migration 0011.
Twelve focused order tests passed, including observed PostgreSQL lock contention
for competing collections and dispatch versus cancellation. Review is bounded
by this backend scope; it is not production release approval.

Both task-specific databases were dropped and the isolated PostgreSQL server
was stopped after verification. Changes remain local; no commit, push or merge.
