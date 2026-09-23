# Private warehouse control — 2026-09-23

Status: implemented and locally verified; customer orders/reservations remain separate.

## Behavior

`stock_location.managing_store_id` identifies a private warehouse's controlling
store, not ownership of its goods. Every stock operation there requires the
acting store to match and the exact permission to be granted directly in that
store. Organization-wide rights cannot fill a missing direct permission, even
when the user has direct view access. This applies to inventory/discovery,
receipts, adjustments, sales and their corrections, restocking refunds and
transfers, before cached or durable replay. Explicitly authorized child sellers
retain sales/refunds; manager operations still require their separate permissions.

Shared/legacy warehouses with NULL control retain existing ACL behavior. A
private warehouse's extra ACL for a primary/sibling store cannot bypass its
control assignment. A paused private warehouse stays readable to its authorized
users and rejects mutations under the existing activity rules.

## Migration and onboarding

New revision `0009_private_locations` adds a nullable, composite tenant-bound
foreign key. It backfills only explicit `bootstrap.child_warehouse.v1` audit
mappings; malformed or ambiguous evidence aborts. No quantities, movement rows,
financial history or audit rows are rewritten. Unknown legacy warehouses remain
unclassified: an operator must explicitly classify them before claiming their
private isolation; names/kinds/codes never decide authority.

Seed now marks the optional child warehouse private and refuses mismatched
recorded control instead of silently changing it. It still grants the initial
account an organization-wide OWNER membership only. Operating the child warehouse
requires an explicit active child-store membership with the appropriate role.
Bootstrap does not invent a child manager account or silently grant the initial
owner that membership. No public management/provisioning UI is added here.

Downgrade refuses while any private assignment exists. A simple rollback to old
application code is also unsafe: old code ignores the new control column. Keep a
control-aware build deployed while private locations exist; do not clear controls
merely to force rollback. Apply migration before starting this version.

## Evidence

- Full backend: **511 passed, zero skipped**, two dependency deprecation warnings.
- Ruff clean, **108 files** formatted, mypy **61 files**, **11 import contracts**.
- Migration probe: empty 0008→0009→0008, explicit audit mapping backfill,
  unclassified legacy preservation, audit unchanged, populated downgrade refused,
  `alembic check` reports no drift.
- Nineteen private-location cases cover global/primary/sibling refusal, direct
  view without global privilege promotion, exact correction rights, cache and
  permanent-command replay after revocation, cross-tenant FK refusal, child
  manager transfer in both directions, and child seller sale/restock refund.
- Existing bootstrap API expectation now correctly excludes the private location
  for organization-wide OWNER without direct child membership.
- Frozen-history test now records the unchanged shipped 0008 digest, leaving only
  the new 0009 under development; no historical migration was modified.
- Independent static security/migration review found no blocking code issue.

All database verification used the isolated PostgreSQL **16.2** Birka cluster
under `/tmp`, port 55442, with disposable databases `birka_private_check` and
`birka_private_migration`. PostgreSQL 17 CI/Docker, Telegram E2E and performance
were not rerun. Migration probe source is in
`output/verification/2026-09-23-private-locations/migration_check.py`.

## Files and boundaries

Core files: tenancy model/service, new `authz/locations.py`, inventory/sales/
refunds/transfers services and their API routes, location discovery, seed,
revision 0009, private-location integration tests, bootstrap API test and migration
history test. README and project memory document rollout and latest owner scope.

Private stock controls do not redefine commercial sale-history permissions or
money-only refunds: those retain store-level financial permissions. This is not
a promise to hide all commercial history from organization administrators.

Next: customer orders and reservations, followed by postal dispatch/arrival.
The owner confirmed needs-dispatch goods are merely ordered, so they need a
reservation rather than a completed sale. Financial sale-recognition timing
(dispatch or confirmed customer collection) is still unanswered and must not be
invented. Arrival at a post office is a delivery event, not a warehouse receipt.
No order/payment feature, production deployment, commit, push or merge occurred.
