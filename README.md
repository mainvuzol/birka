# birka

Inventory and Stock Management for Outerwear Stores (Telegram Mini App)

Two related women's outerwear shops currently run on a paper notebook. birka has to be faster
than that notebook at the counter while keeping stock, money and product identity provably
correct.

## Status

**Milestone 1, gate M1A (platform foundation) — implemented and independently reviewed.**
Gate M1B (first complete sale vertical slice) has not started.

Locally verified: lint, formatting, strict type checking, architecture contracts and
95 tests. Not verified locally, because this machine has no Docker, no PostgreSQL and
no Node: the database integration tests (15), `docker compose up`, and the frontend
build. Those run in CI, and the first CI run on push is what proves them.

The plan, the decisions and the current state live in [`.ai/`](.ai/):

| Document | What it is |
|---|---|
| [`.ai/project-memory/milestone-1-plan.md`](.ai/project-memory/milestone-1-plan.md) | The plan: domain model, 22 invariants, 28 tasks, 4 gates |
| [`.ai/project-memory/current-milestone.md`](.ai/project-memory/current-milestone.md) | Where the work stands right now |
| [`.ai/decisions/`](.ai/decisions/) | Architecture decision records |
| [`.ai/constitution.md`](.ai/constitution.md) | Engineering rules this repository is governed by |

## Layout

```text
backend/      FastAPI modular monolith, SQLAlchemy async, Alembic
frontend/     React + TypeScript + Vite Telegram Mini App (scaffold; built in gate M1D)
infra/        Docker Compose, Caddy, environment template
data/legacy/  private legacy shop documents — gitignored, never committed
.ai/          engineering operating system and project memory
```

## Running the backend locally

Requires Python 3.12+ and PostgreSQL 15 or newer (17 is what CI and production use —
`UNIQUE NULLS NOT DISTINCT` does not parse below 15, see
[ADR-0002](.ai/decisions/ADR-0002-catalog-identity-and-nullable-uniqueness.md)).

```bash
cd backend
py -3.12 -m venv .venv
```

```bash
backend/.venv/Scripts/python.exe -m pip install -e ".[dev]"
```

Set the environment (copy `infra/.env.example`), then apply migrations and start the API:

```bash
backend/.venv/Scripts/python.exe -m alembic upgrade head
```

```bash
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

Create the first organization, its two stores, a shared warehouse with explicit
access for both stores, the default roles and an owner:

```bash
backend/.venv/Scripts/python.exe -m scripts.seed_organization --telegram-user-id 123456789
```

Optionally append `--with-child-warehouse` to create a separate warehouse with
an access row for SECOND only. It can also be added on a later seed invocation.
On macOS/Linux, use `python -m scripts.seed_organization` from `backend/` with
the project's virtual environment activated and the database URL configured.

Repeated setup preserves balances, paused locations and revoked warehouse
grants. Bootstrap audit records retain the created UUID mappings: do not delete
them or infer authority from a warehouse's name/code. Existing locations without
this mapping cause setup to refuse; configure those explicitly rather than
rerunning old migrations or creating duplicate stock. This tool currently
bootstraps MAIN and SECOND, not arbitrary additional children.

`GET /api/v1/stock-locations?store_id=<uuid>` lists explicitly accessible
warehouses, including empty and paused ones, with names, activity and store
capability flags. It requires `inventory:view` in that store. The flags are store
grants, not permission to bypass the user's role or active-location checks.

The optional child warehouse is private to its managing store (migration 0009).
An organization-wide manager/owner does not automatically gain private-stock
rights. Explicit active membership in the child store with the exact operation
permission is required, including for the initial bootstrap owner. Configure the
child manager explicitly; bootstrap does not create that membership silently.
Existing legacy warehouses without an explicit bootstrap mapping are not guessed
private. Customer order reservations and postal delivery are implemented in the backend.

Apply migrations through 0011 before this version. Downgrade refuses private assignments;
older application builds that ignore private controls are also unsafe to deploy
while those assignments exist. See the [private control report](.ai/project-memory/private-location-report.md).

## Customer orders

`POST /api/v1/orders` accepts `store_id`, permanent `command_id`, and price/quantity
lines with an explicit `source_location_id`. It reserves available goods without
creating a completed sale. Inventory responses expose `quantity` (physical),
`reserved_quantity`, and `available_quantity`.

`POST /api/v1/orders/{id}/{dispatch,arrive,collect,cancel}` accepts `command_id`.
Dispatch removes physical stock once; arrival is postal status only; collection
creates the sale using frozen order prices without removing stock again. Use
`GET /api/v1/orders/{id}` for current state; retry responses preserve the original
command result even after later transitions. The same command UUID must be reused
for retries. These endpoints use durable commands without the optional HTTP
idempotency response cache used by older endpoints.

Cancellation is allowed before dispatch and releases the hold, including on a
paused warehouse. After dispatch, `/orders/{id}/return` requires `command_id`,
`physically_received: true`, and a nonblank `reason`; it restores goods to their
original warehouse. After collection use the existing sale refund command.
Collection does not record payment. Partial shipments, reservation expiry,
customer/contact tracking and installment accounting remain out of scope. Migration rollback refuses existing order/reservation history.

## Checks

Everything below runs in CI on every push, and all of it must pass.

```bash
backend/.venv/Scripts/python.exe -m ruff check . ; backend/.venv/Scripts/python.exe -m ruff format --check .
```

```bash
backend/.venv/Scripts/python.exe -m mypy app scripts
```

```bash
backend/.venv/Scripts/lint-imports.exe --config pyproject.toml
```

```bash
backend/.venv/Scripts/python.exe -m pytest -q
```

Database integration tests need a real PostgreSQL and are skipped without one. To run them,
set `BIRKA_TEST_DATABASE_URL` to a migrated test database. A skipped run is never evidence
that the database behaviour works.

With Docker installed, a local PostgreSQL 17 (same image and locale as CI) and the whole CI
backend pipeline, including the "integration tests really ran" assertion, are one command:

```powershell
.\infra\dev.ps1 test
```

`.\infra\dev.ps1 up | down | reset | migrate | psql` manage the dev database
([`infra/docker-compose.dev.yml`](infra/docker-compose.dev.yml), `127.0.0.1:5432`, `birka`/`birka`,
databases `birka` and `birka_test`).

## The rules that matter most

- PostgreSQL committed state is authoritative. Stock can never go negative.
- Every stock change is explained by a `StockMovement`; sale and stock effects commit atomically.
- Money is `NUMERIC` and `Decimal`, never a float. Historical sale lines never change.
- Raw human catalog input is immutable evidence; interpretation is stored beside it.
- An uncertain catalog match asks a human. It never silently merges two products.
- Authorization is server-side; a client-supplied store id is data to validate, not proof.


## Seller order interface

The frontend now supports Telegram login, explicit store and warehouse selection,
stock selection by name/size, negotiated unit prices, order lists and the full
reserve → dispatch → postal arrival → collection workflow. It also supports
pre-dispatch cancellation and confirmed physical return before collection.

`GET /api/v1/orders?store_id=...&limit=50&offset=0` returns `orders` and `has_more`;
access filtering happens before pagination. `GET /api/v1/catalog/stock-options`
accepts `store_id`, `location_id`, `limit` and `offset`, returning named stock
options and `has_more`. Order responses now document frozen size labels and
creation dates in OpenAPI; old command snapshots remain compatible.

Run `npm run dev` in `frontend/`; `/api` proxies to `http://127.0.0.1:8000` by
default. Set `BIRKA_DEV_API_URL` for a different local API. Production still uses
same-origin `/api` through Caddy. Opening outside Telegram shows entry guidance;
there is no production test-login bypass.

Pending commands are retained in browser local storage under organization/user/store
keys, without auth tokens. Retry keeps the original command and refreshes the
current order. Do not clear that journal to recover an uncertain operation;
restore access/connectivity and retry. Payment tracking remains separate.
See [verification and E2E setup](.ai/project-memory/order-ui-report.md).

Every Playwright journey also runs in CI (job `e2e`) on every push and pull
request. It uses the real API and PostgreSQL 17 with the production locale,
on a Pixel 7 profile. The job's steps are the recipe for a local run; see the
[E2E in CI report](.ai/project-memory/m1-027-e2e-ci-report.md).


## Catalog parser preview (M1-020)

From `backend/`, pipe one raw line into `python -m scripts.preview_catalog`.
Parser v1 returns candidate attributes with exact text evidence and preserves
unknown descriptors, including rare item codes. It does not create products,
choose matches or change inventory. Slash lists require review; quantities are
never divided automatically. See [scope and verification](.ai/project-memory/m1-020-parser-report.md).

## Legacy stock lists → opening balances (M1-023)

A paper or PDF availability list becomes stock in three steps, never one
([ADR-0005](.ai/decisions/ADR-0005-legacy-snapshot-import.md)):

1. `POST /api/v1/snapshots` with a client `command_id` (unique within the
   organization; a retry repeats it), `store_id`, `location_id` and up to 1000
   `lines` of at most 500 characters (100 000 in all), kept verbatim and
   parsed. Nothing is matched, created or counted. The response's
   `snapshot_id` names the list from then on. `snapshot:import` (manager,
   owner).
2. `PUT /api/v1/snapshots/{id}/lines/{line_no}`: say what the line is. That is
   either `allocations` (`product_variant_id`, `size_id` or
   `size_unknown: true`, `quantity`) with a `quantity_basis`, or a
   `skip_reason`:
   - `STATED` — exactly the line's own count, in one allocation; never for a
     line naming several sizes or colours;
   - `LINE_IMPLIES_ONE` — a line with no number that could be a count, taken
     as one piece;
   - `RECOUNTED` or `OWNER_KNOWLEDGE` — with a `note`.

   A list takes at most 5 000 allocations in all.
3. `POST /api/v1/snapshots/{id}/approve` with `expected_review_revision`.
   This writes `OPENING_BALANCE` lots and movements, only into a warehouse
   with **no stock history**. `snapshot:approve` (owner). For a child store's
   private warehouse, the approver must hold the owner's role in the child
   store itself. Alternatively, `POST .../reject` with a `reason` keeps
   everything as evidence.

Approve a warehouse's list before anything else is recorded there. Paper sales
made between the count and the approval are entered afterwards, as ordinary
sales (owner decision, 2026-09-29). Entering one first closes the warehouse to
its list for good.

`GET /api/v1/snapshots?store_id=`, `GET /api/v1/snapshots/{id}` and
`GET .../lines` read lists, their summary by basis, and each line's evidence and
answer. A decided list is frozen by the database.

Apply migration `0015` in a maintenance window, with no older instance of the
app running. It adds CHECKs to `stock_movement` and `stock_lot` under an
exclusive lock, and code before it takes no warehouse lock.

Related changes elsewhere:

- Receipts now accept only `PURCHASE`, `CONSIGNMENT` or `BORROWED` lots.
- "Size not known" stock enters only from a list:
  - receipts and positive adjustments refuse that size;
  - the catalog reserves its code (`UNSPECIFIED` / `UNKNOWN`);
  - a «фізично є» correction is refused (`UNKNOWN_SIZE_STOCK`) when it would
    add such a unit, or a sized unit of a model held at that warehouse with
    size not known.
- A seller gives such a coat its size at the counter: `POST /api/v1/sales`
  takes `size_clarified: [{line_index, quantity}]`. The line is sold as the
  size the seller read, and `quantity` of its units first move out of the same
  model's size-not-known balance at that warehouse. `quantity` must be exactly
  the line's shortfall at that size. It needs `inventory:correct_during_sale`
  (sellers have it) and is audited. The response lists both movements in
  `size_reclassifications`.
- `POST /inventory/adjustments` no longer accepts the two
  `SIZE_RECLASSIFICATION_*` reasons (422): each is half of a pair only a sale
  writes.

See the [M1-023 report](.ai/project-memory/m1-023-snapshot-import-report.md).

## Backups and the restore drill (M1-028)

Every night the server:

1. backs up the database;
2. restores the copy into a scratch database and proves it is the same data;
3. encrypts it to the owner's age public key;
4. keeps every daily copy 7 days and each month's first copy 3 months.

The owner's own computer collects the encrypted copies with
`infra/pull-backups.sh`. Only the owner holds the private key.

```sh
docker compose --profile ops run --rm ops         # the nightly run, as cron runs it
python -m scripts.restore_drill /backups/birka-<time>.dump \
    --scratch-url postgresql+asyncpg://…/postgres  # a drill on its own
```

The restore drill passes only when:

- the archive matches its checksum;
- every table has the same row count;
- every trigger is present and enabled;
- the locale still lowercases Cyrillic;
- the stock ledger reconciles.

It writes to no database but its own scratch copy, which it drops. The
`ops` image carries the PostgreSQL 17 client tools and `age`. Elsewhere, set
`BIRKA_PG_BIN`.

Each night also leaves one row in `backup_run`. From it the owner sees the
«Резервні копії» section in the app, and the `backup-watch` service sends the
owner a Telegram message when a night fails, when none has run for 26 hours,
or when backups were never set up:

```sh
docker compose run --rm backup-watch python -m scripts.backup_watch --status   # exit 0 only if OK
```

Setup, key custody and restoring for real are in the
[runbook](.ai/project-memory/backup-restore-runbook.md).
