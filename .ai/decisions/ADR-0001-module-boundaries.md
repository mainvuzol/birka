# ADR-0001 — Modular monolith with CI-enforced module boundaries

Status: Accepted (planning run 2, conceptual approval)

## Context

Milestone 1 builds catalog identity, inventory ledger, sales, refunds, transfers, legacy import, auth and RBAC at once. Those concerns have very different risk profiles: a mistake in the catalog matcher costs a confusing product list, a mistake in the inventory ledger costs money and trust.

The governing documents constrain the answer. `constitution.md` §14 forbids distributed infrastructure without measured need. `PRODUCT_EXCELLENCE_STANDARD.md` §8 prefers a modular monolith and boring infrastructure. `skills/modular-monolith-guardian.md` names the target modules and requires that extraction stays possible later.

The real risk is not deployment topology — it is that internal boundaries erode. A sales module that reaches directly into the inventory tables is faster to write today and makes invariant I3 ("every quantity change has a ledger entry") unenforceable tomorrow, because the code that changes stock is no longer in one place.

The deployment target is a single small VPS running two shops. There is no measured load, no isolation requirement and no regulatory boundary that would justify separate services.

## Decision

One deployable FastAPI application, organized into modules with explicitly declared dependency edges, and a build that fails when an edge is violated.

Modules: `core`, `identity`, `tenancy`, `authz`, `catalog`, `inventory`, `sales`, `refunds`, `transfers`, `audit`, `telegram`.

Permitted edges:

```text
sales     → inventory, catalog, authz, tenancy, core
refunds   → sales, inventory, authz, tenancy, core
transfers → inventory, authz, tenancy, core
inventory → catalog (read-only), tenancy (store validation), core
catalog   → core            (leaf: catalog depends on nothing but core)
identity  → authz, tenancy, core
authz     → tenancy, core
*         → audit  (any module that changes business state writes its own
                    audit entry, inside the same transaction as the change)
telegram  → identity, core
api/v1    → modules (routers call services only)
```

`sales → audit` and the other audit edges exist because an audit row written
in a different transaction from the change it describes is worse than none: it
either records something that did not happen or misses something that did. The
module making the change therefore writes its own entry.

`identity → authz` is the authentication flow asking authorization what the
user may do before it issues a session. The reverse edge is forbidden, which is
why the "is this user still active?" check lives in the API layer
(`api/deps.py`) rather than inside `resolve_scope` — putting it there would
make `authz` depend on `identity` and close the cycle.

Rules:

1. Cross-module access goes through a service function. No module imports another module's repositories, ORM models or SQL.
2. `inventory` is the only module that writes the `inventory` and `stock_movement` tables. This is what makes invariant I3 checkable.
3. Routers parse the request, call one service, and shape the response. Business rules and transaction boundaries live in services (`conventions.md`).
4. The boundary is enforced by `import-linter` contracts executed in CI (task M1-004). A violating import fails the build, not a review.
5. A contract may only name modules that exist — import-linter errors on a missing module. So **each contract ships with the module it constrains**, and every task that introduces a module must add its contract in the same change. `backend/pyproject.toml` lists the contracts still to be added and the gate that owns each. Until a contract exists, invariant I19 is enforced only for the relationships already encoded; the plan says so rather than claiming blanket coverage.
5. Introducing microservices, a message broker, Kubernetes, Elasticsearch, Redis or a second database requires a new ADR citing measured evidence.

## Alternatives considered

- **Layered monolith (controllers / services / repositories, no module boundaries).** Simpler to start, and the usual outcome is that `SaleService` grows inventory SQL inside it. Rejected: it makes the ledger invariant unverifiable, which is the single most valuable property of this system.
- **Services split by domain (catalog service, inventory service, POS service).** Rejected: no measured need, and it converts every invariant that currently commits in one transaction into a distributed-transaction problem. The sale flow in `architecture.md` depends on a single ACID boundary.
- **Boundaries by convention only, checked in code review.** Rejected: conventions decay under delivery pressure, and this project explicitly prefers deterministic enforcement over intention (`constitution.md` §15).
- **Separate database schemas per module.** Deferred. It would strengthen the boundary but complicates the cross-module transactions the sale flow needs. Revisit if module coupling becomes a real problem.

## Consequences

Positive:

- One transaction can span catalog lookup, inventory update and sale insert — required by `workflows/sale.md`.
- One deployment, one database, one log stream. Operable by one person.
- The ledger invariant becomes mechanically checkable because exactly one module writes stock.
- Extraction stays possible: a module with declared edges and no foreign table access is the unit you would extract later.

Negative:

- Import rules add friction when a genuine new dependency is needed; the contract must be updated deliberately, which is the point but costs time.
- Shared process means a runaway query in the catalog module can affect sale latency. Accepted at two-shop scale; revisit against measured p95.
- `inventory → catalog` read-only coupling is a compromise: inventory needs variant display data. Kept read-only and narrow so it does not become a two-way dependency.

## Operational impact

- **Deployment:** single Docker Compose stack (API, web, PostgreSQL, Caddy). No orchestration.
- **Migration:** one Alembic history for the whole application; module ownership of tables is a code convention, not a database boundary.
- **Monitoring:** one correlation id per request flows through every module and into the audit log.
- **Rollback:** one artifact to roll back. Migration rollback is reviewed per migration (M1-006).
- **CI cost:** the import-linter contract runs in seconds; it is a lint job, not a test suite.

2026-09-14 clarification: inventory validates catalog and active store ownership through public service functions before stock materialization. Sales reads correction references through inventory.service; it does not query inventory ORM tables.

2026-09-28 amendment (M1-023, [ADR-0005](ADR-0005-legacy-snapshot-import.md)): module `snapshots` owns the legacy stock lists (`inventory_snapshot`, `inventory_snapshot_row`, `inventory_snapshot_allocation`), which plan §8 had placed inside `inventory`. Permitted edges: `snapshots → inventory, catalog, authz, tenancy, core` (+ audit). It writes raw evidence through `catalog.raw_lines` and opening stock through `inventory.service.apply_opening_balance`; lots, movements and the history check stay in `inventory`. No other module may import it, and it may import neither `sales`, `refunds`, `transfers`, `orders` nor `identity`. Contracts in `backend/pyproject.toml`. (Module `orders`, added on 2026-09-23, has its contracts there too.)

2026-09-30 amendment (M1-028, the owner hears about the backups): two modules.
- `telegram` sends one message from the shop's bot to one person, and nothing
  else. ADR-0001 named `telegram → identity, core`; it needs neither today, and
  a contract keeps it out of every other module.
- `backups` owns `backup_run` and `backup_alert`, which describe the server
  and carry no `organization_id`. Permitted edges: `backups → authz, identity,
  telegram, core`. It asks authz who holds `backup:view` organization-wide
  (`organization_wide_holders`), identity for their Telegram chats
  (`telegram_chats`), and sends through telegram. It reads no shop's
  business, and no module imports it: only the API and the scripts that run
  the nights and the watcher.

Contracts in `backend/pyproject.toml`.

2026-10-01 amendment («Брак»): module `damaged` owns `damaged_unit`, one row
per unit a return put in a store's «Брак». Permitted edges: `damaged →
transfers, inventory, authz, tenancy, core` (+ audit).
- A unit goes back on sale through `transfers.move_goods`, the transfer
  command's own core, so it is a transfer in the ledger (I24).
- It is written off through `inventory.record_adjustment`, the stock
  correction's own core (ADR-0007).
- Only `refunds`, which registers the units, and the API import it. Contracts
  are in `backend/pyproject.toml`.

2026-10-01 amendment (store states): module `stores` changes a store's state
— trading, blocked, archived — on the owner's word. Its tables stay in
`tenancy` (`store.state`, `store_state_change`), which every module already
reads. Permitted edges: `stores → inventory, orders, identity, authz,
tenancy, core` (+ audit).
- It reads how many units stand in the store's own warehouses and its «Брак»
  (`inventory.units_held`) and how many of its orders are open
  (`orders.open_order_count`), because only an empty store is archived.
- It moves no goods and no money. What a store that does not trade may not do
  is refused by the person's scope (`authz/scope.py`) and held at the
  ledger's door (`tenancy.hold_stores`), never by this module.
- No module imports it; only the API does. Contracts are in
  `backend/pyproject.toml`.

2026-10-01 amendment (returns to a supplier): module `suppliers` owns the
network's suppliers and the goods returned to them (`supplier`,
`supplier_return`, `supplier_return_line`, `supplier_return_cancel`).
Permitted edges: `suppliers → inventory, catalog, identity, authz, tenancy,
core` (+ audit).
- Goods leave and come back as ledger movements (`SUPPLIER_RETURN`,
  `SUPPLIER_RETURN_CANCEL`) through `inventory.apply_movements`.
- A unit from «Брак» goes back, and comes back, through the «Брак» section:
  `damaged → suppliers` is the one edge into this module besides the API. So
  stock in «Брак» still changes only through returns and that section, and
  this module never imports `damaged`.
- Contracts are in `backend/pyproject.toml`.

2026-10-01 amendment (the store's purchases in parts): what a store owes its
suppliers lives inside module `suppliers`, in `suppliers.invoices`
(`supplier_invoice`, `supplier_invoice_entry`,
`supplier_invoice_entry_cancel`, `supplier_invoice_cancel`). It is the same
supplier and the same returns, so it is no module of its own.
- It is money and moves no goods: `suppliers.invoices` and
  `suppliers.common` never reach `inventory`, not even indirectly, and never
  import the returns' service. A set-off only names a return that already
  moved the goods.
- The returns ask it whether a set-off of a return stands
  (`suppliers.service → suppliers.invoices`), and refuse to cancel one that
  does.
- Contract "what a store owes its suppliers moves no goods" is in
  `backend/pyproject.toml` (25 in all).

2026-10-01 amendment (goods borrowed from another shop): `suppliers.borrowed`
counts what a store borrowed from a supplier, or took under consignment, per
stock lot, and turns "sold" into an invoice and "unsold" into a return.
- It reads lots and their deliveries (`inventory.models`), which module
  `suppliers` already may, and calls the invoices and the returns.
- `suppliers.invoices` still never reaches the ledger. An invoice names its
  lot by id alone, and is told the lot's name.
- Receiving records the supplier (`goods_receipt.supplier_id`); module
  `inventory` still never imports `suppliers`.

2026-10-02 amendment (the sales report): module `reports` sums what the
stores sold and returned and the money through their tills.
Permitted edges: `reports → sales, refunds, credit, identity, authz, tenancy,
core`.
- It reads their models and writes nothing: no stock, no money, no audit
  record. It never imports their services, so a figure cannot change what it
  sums.
- Nothing imports it; only the API does.
- Contracts "a report only reads" and "nothing depends on the reports" are in
  `backend/pyproject.toml` (27 in all).


2026-10-03 amendment (correcting the catalogue, [ADR-0008](ADR-0008-catalog-correction.md)):
module `catalog_correction` merges a duplicate into the model that stays, and
retires a model and brings it back.
Permitted edges: `catalog_correction → catalog, inventory (service), orders
(models), suppliers (borrowed lots), snapshots (models), tenancy, authz,
audit, core`.
- It reads what stops a merge: open orders, borrowed lots on hand, stock in
  «Брак», opening lists that wait. It never reaches `damaged`.
- It moves stock only through `inventory.apply_catalog_merge`, the one writer
  of the merge's two reasons.
- Nothing imports it; only the API does.
- Renaming stays in `catalog`, which stays a leaf, with the primitives every
  correction shares (`catalog.corrections`).
- `reports` may now read `catalog.read`, to count a merged model with the
  model that stays and name each line as its model is named now.
- `refunds`, `damaged` and `suppliers` ask `inventory.current_variants` which
  model goods come back as; `refunds` and `damaged` still never read the
  catalogue themselves.
- Contracts "a merge moves stock only through the ledger's own door" and
  "nothing depends on the catalogue corrections" are in
  `backend/pyproject.toml` (29 in all).

2026-10-04 amendment (cash and card, the day's close,
[ADR-0012](ADR-0012-cash-and-card.md)): module `cash` counts the drawer: the
day's close and its reason, cash taken out and put in, corrections of a way
of paying, and the bot's messages of a difference (`cash_close`,
`cash_close_reason`, `cash_movement`, `payment_correction`, `cash_message`).
Permitted edges: `cash → sales (models, payment), credit (models), refunds
(models), orders (models), identity (models, telegram_chats), authz,
tenancy (models, hold_stores), audit, telegram, core`.
- It reads the money rows and moves no goods. It never records a sale, a
  payment or a refund: it reaches only their models, never their services,
  `sales.order_collection` or `sales.shelf`.
- The way of paying is not a module of its own: `sales.payment` holds it,
  since every money module already imports `sales`.
- No money module imports `cash`. A money row is placed in its drawer's
  period by the database (a trigger), and the API layer merges the current
  ways into the answers of sales, debts and orders (`cash.current`).
- Only the API, the report and the watcher depend on it. `reports` reads
  `cash.models` and `cash.current`, never its commands, reads or messages;
  the watcher script (`scripts/backup_watch.py`) sends `cash.messages`.
- Its messages copy the backups' sending algorithm rather than share it:
  `backups` may not be imported by a shop module, and `telegram` may not
  reach the people.
- Contracts "the drawer counts money and moves no goods" and "only the API,
  the report and the watcher depend on the drawer" are new. Twelve others
  name `cash` too:
  - "catalog is a leaf", "authz must not depend on business modules",
    "backups reads no shop's business" and "telegram only talks to Telegram"
    forbid it;
  - "a report only reads" forbids `cash.service`, `cash.read` and
    `cash.messages`;
  - "nothing depends on the legacy list workflow", "nothing depends on the
    backups section", "only a return puts units in «Брак»", "nothing depends
    on the store-state command", "only «Брак» and the API use the supplier
    returns", "nothing depends on the catalogue corrections" and "nothing
    depends on the reports" keep it from importing those.
- import-linter skips a forbidden module that does not exist, silently. A
  unit test now imports every module the contracts name
  (`test_import_contracts_name_real_modules.py`).
- Contracts are in `backend/pyproject.toml` (31 in all).
