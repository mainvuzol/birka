# Bootstrap repair and confirmed next steps — 2026-09-23

This report records the first bootstrap slice. Subsequent private warehouse control is implemented: see [2026-09-23 private control report](private-location-report.md). The historical scope and counts below describe the earlier slice.

## Delivered scope

First bounded change following the business-model review: clean setup plus
authorized warehouse discovery. This is not completion of customer orders,
reservations or strict private-manager isolation.

- `scripts/seed_organization.py` now creates a shared warehouse and explicit
  MAIN/SECOND sell/receive grants. No stock is created or moved.
- `--with-child-warehouse` optionally creates a SECOND-only warehouse, including
  on a later run. Repeated invocation does not remove it when the flag is absent.
- Immutable bootstrap audit events record target UUIDs. Repeat setup uses these
  mappings, preserves renamed/paused locations and does not restore revoked
  warehouse grants. Audit retention must preserve these bootstrap records.
- Existing unmapped warehouses, missing mapped targets and ambiguous organization
  names refuse setup instead of guessing. This CLI bootstraps two explicit stores;
  general child-store onboarding remains separate.
- Transaction ownership and organization/user advisory locks protect atomic
  concurrent CLI runs. Other administration tools must not run conflicting setup
  concurrently; the CLI is not a public authorization endpoint.
- `GET /api/v1/stock-locations?store_id=…` returns authorized empty/paused locations,
  names, activity and store capability flags. Person permission `inventory:view`,
  store scope and tenant checks remain required. Flags are not effective user
  authority and do not bypass command checks.

Changed application files: `backend/scripts/seed_organization.py`,
`backend/app/modules/tenancy/service.py`, `backend/app/api/v1/locations.py`,
`backend/app/api/v1/router.py`. New tests: `test_seed_organization.py` (13 cases)
and `test_bootstrap_api.py` (3 cases). README documents CLI and API behavior.

No schema changes or new migrations. Historical migrations remain unchanged.
The current script is an initial-setup tool, not a migration of existing shop
configuration; it refuses ambiguous legacy state rather than widening access.

## Evidence

- Full backend suite: **491 passed, zero skipped**, two dependency deprecations.
- Added assertion that seed rerun after receipt/sale preserves the stock balance;
  reran the three API cases after that assertion: **3 passed**.
- New golden path: seed twice → discover empty warehouses → create product →
  receive two at shared warehouse via MAIN → sell one via SECOND → seed again →
  both stores observe the same remaining unit.
- Tests cover grant revocation, paused visibility, permission/membership denial,
  explicit optional warehouse, ambiguity refusal, rollback and concurrent setup.
- Ruff passes; format **105 files**; mypy **60 files**; **11 import contracts**.
- All existing migrations applied to a new disposable database; `alembic check`
  reports no drift. Actual CLI invocation with the optional flag also succeeded.
- Independent static reviewer found no blocking issue in this bounded scope.
- Local PostgreSQL **16.2**, Python 3.12, task-specific `/tmp` runtime and database
  `birka_bootstrap_check` on the isolated Birka cluster at `127.0.0.1:55442`.
  PostgreSQL 17 CI/Docker and Telegram/frontend E2E **not rerun** for these changes.

The initial new API test expected an incorrect nested error envelope; it was
corrected to the existing top-level `code` contract. Application refusal was
already correct. No existing regression was weakened.

## Historical bootstrap handoff (superseded by later implementation)

Private access is implemented; owner confirmed sale recognition at customer collection. See [current order report](customer-orders-report.md). The remainder below records the earlier handoff, not current blockers.

## Latest confirmed owner decisions

These supersede the earlier proposed interpretation of postal statuses as
warehouse-transfer states. They are requirements, not shipped features:

1. Postal workflow is **delivery to a customer**: needs dispatch → dispatched →
   arrived at the post office. Arrival is not evidence the customer collected it.
2. At needs-dispatch stage the goods are **ordered only**. Owner accepted the
   proposed reservation model: physically present stock stays unchanged, available
   stock falls by reserved units; dispatch consumes the reservation and decrements
   physical stock once; arrival changes delivery state only; pre-dispatch
   cancellation releases the reservation; after dispatch a real return is required.
3. Warehouse receipt immediately increases stock through normal audited receipt;
   no postal lifecycle is attached to that operation.
4. Child warehouses are managed only by the corresponding child manager. The
   existing organization-wide membership behavior has **not** yet been changed.
5. Payment state is separate from delivery state. The point at which the order
   becomes a completed financial sale remains open: asked whether dispatch or
   confirmed customer collection. Do not infer payment or book a sale on arrival.

## Next implementation sequence and invariants

1. **Private-manager authorization:** define and implement explicit private-location
   management and membership scope. Current org-wide OWNER/MANAGER can still act
   through SECOND; therefore this bootstrap is not proof of private-manager
   isolation. Preserve explicitly permitted seller flows and shared-warehouse
   access; do not bypass store/location boundaries via organization role alone.
   Test primary, two children, sibling refusal, org-wide refusal and replay.
2. **Orders/reservations:** add separate customer-order identity and reservation
   lifecycle, not states on warehouse transfers. Agree financial sale recognition
   before the dependent dispatch/sale integration. Do not create duplicate sales
   or alter immutable historical receipts.
3. **Dispatch/arrival/cancellation:** permanent command identity per action,
   fingerprint and durable response; serialize competing actions and retries.
   Delivery status, payment status and sale recognition are separate facts.

Reservation design must protect **every** stock-out path, not only orders:
ordinary sales, transfers, adjustments and missing-at-sale corrections must not
consume another order's reservation. Available = physical − active reservations;
physical and available never negative. Lock the same `(location, variant, size)`
key in a globally consistent order for reserve, release, dispatch and other stock
writes. A reserved unit cannot also be promised/sold by another store sharing the
warehouse. Reservations need traceable events but are not physical stock movements.

Acceptance scenarios: two stores reserve the last coat; sale races reservation;
transfer/adjustment attempts to consume reserved units; duplicate dispatch;
dispatch races cancellation; access revoked before retry; arrival repeated with no
stock write; paused warehouse; post-dispatch return counted once. No automatic
reservation expiry, partial shipments or installment accounting is assumed.

No application changes for orders, no production actions, commit, push or merge
were performed in this bounded bootstrap delivery.
