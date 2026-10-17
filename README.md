# birka

Inventory and Stock Management for Outerwear Stores (Telegram Mini App)

Two related women's outerwear shops currently run on a paper notebook. birka has to be faster
than that notebook at the counter while keeping stock, money and product identity provably
correct.

## Status

**Milestone 1 is not complete.**
- **What a shop needs on day one is built and verified,** except, for the
  way in the owner chose on 2026-10-08 for the shops' existing stock, its
  final local CI run, the edge's body check, and a file picked on a real
  phone in Telegram (release checklist, row 26), still to come. That way in
  is built: photos → parser → JSON files in Birka's format
  ([`formats/birka-stock-list/`](formats/birka-stock-list/README.md)), which
  fill a warehouse's list in «Початкові залишки», every line reviewed by a
  person ([report](.ai/project-memory/json-stock-import-report.md)). It was
  reviewed adversarially on 2026-10-09; its findings fixed, or kept with the
  reason (report, "Review of the built change"). The owner confirmed the
  last six readings of how it is carried out as built on 2026-10-09.
- **The catalogue's verified promotion (M1-021/022) is still partial.** It
  waits for human-confirmed data.
- **The release is blocked** on steps only the owner, an administrator with
  a server, or the shops can take: a server and the bot, the real
  organization and its people, backups there, the shops' existing stock
  (the parser's files, and a file picked on a real phone in Telegram), a
  sale timed in the shop, and the owner's sign-off. The hot path's release
  reading, every case gated, was taken again on 2026-10-08, after the outage
  work's mark on a sale: every case passes (release checklist, row 22).
- **The shops' existing stock goes in before anything else moves** in a
  warehouse. The first delivery or sale there closes it to an opening list
  for good ([server runbook, step 9](.ai/project-memory/server-runbook.md#9-the-shops-existing-stock-before-anything-moves)).

See the
[release checklist](.ai/project-memory/release-checklist.md); the
[server runbook](.ai/project-memory/server-runbook.md) covers installing,
the shops' existing stock, updating and going back.

CI verifies every pull request, at each push to it, and every push to main
(a pull request with a merge conflict runs nothing until its base is merged
in; CI can also be run on a branch by hand, from the Actions tab):
- every backend test, on PostgreSQL 17 with the production locale;
- 261 Playwright journeys on a phone profile, against the real API
  (249 before the JSON stock import);
- the nightly backup and its restore drill, from the `ops` image;
- the hot-path budgets;
- lint, strict types, the architecture contracts and the frontend build.

The plan, the decisions and the current state live in [`.ai/`](.ai/):

| Document | What it is |
|---|---|
| [`.ai/project-memory/milestone-1-plan.md`](.ai/project-memory/milestone-1-plan.md) | The plan: domain model, 25 invariants, 30 tasks, 4 gates |
| [`.ai/project-memory/current-milestone.md`](.ai/project-memory/current-milestone.md) | Where the work stands right now |
| [`.ai/project-memory/release-checklist.md`](.ai/project-memory/release-checklist.md) | What stands between this and the shops |
| [`.ai/project-memory/server-runbook.md`](.ai/project-memory/server-runbook.md) | Installing, updating and going back on a server |
| [`.ai/decisions/`](.ai/decisions/) | Architecture decision records |
| [`.ai/constitution.md`](.ai/constitution.md) | Engineering rules this repository is governed by |

## Layout

```text
backend/      FastAPI modular monolith, SQLAlchemy async, Alembic
frontend/     React + TypeScript + Vite Telegram Mini App: the sellers' and owner's app
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
backend/.venv/Scripts/python.exe -m pip install --no-deps --require-hashes -r requirements-dev.lock
```

```bash
backend/.venv/Scripts/python.exe -m pip install --no-deps -e ".[dev]"
```

The first installs the versions CI tests and the server runs
(`backend/requirements.lock`), each file checked against its hash; the
second, the backend itself and nothing else. Without the lock pip takes
whatever is newest. On Windows the lock leaves `uvloop` out and takes
`colorama`, as its two marked lines say.

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

## Who works where

Everyone but the bootstrap owner is added on the server, by the number of
their Telegram account, and only on an owner's word (owner decision,
2026-10-01). Someone not yet added opens the app and sees that number, to
pass on. Each change names the owner with `--approved-by`. That owner must
hold `user:manage` there, and every permission of the role concerned. A
child store's owner decides only in that store.

```sh
python -m scripts.people list
python -m scripts.people grant --approved-by <owner> --telegram-user-id <id> --store MAIN --role SELLER
python -m scripts.people remove --approved-by <owner> --telegram-user-id <id> --store MAIN
python -m scripts.people deactivate --approved-by <owner> --telegram-user-id <id>   # every store
```

- **Roles** are `SELLER`, `MANAGER`, `OWNER`, or one the organization
  composed.
- **`--all-stores`** in place of `--store` gives, or takes away, a role in
  every store.
- **Nothing is deleted.** A removed person's history stays under their name,
  and the next `grant` lets them back in.
- **On the server:** `docker compose run --rm --no-deps api python -m
  scripts.people …`.

See the [people report](.ai/project-memory/people-report.md).

The stores' names are given at setup (`seed_organization --main-name …
--second-name …`). Later, an owner's word changes one:
`python -m scripts.stores rename --approved-by <owner> --store MAIN --name "…"`.

## Paying in parts

A customer may take the goods, pay part now and owe the rest to the store
that sold (owner decisions, 2026-10-01). `POST /sales` takes
`credit: {customer_name, customer_phone, paid_now}`.

Each payment says how it was paid (owner decisions, 2026-10-04; see "Cash
and card, the day's close"). The sale's `payment_method` is the way of the
part paid now, beside `credit`, not inside it; each later payment carries
its own.

- **Debts:** `GET /api/v1/credits?store_id=` lists a store's debts.
- **Payments:** `POST /api/v1/credits/{id}/payments` takes one, with its
  `payment_method`: `CASH`, `CARD` or `TRANSFER`. A payment's history entry
  says its way, and `corrected` when it was fixed.
- **Write-offs:** the owner writes a debt off at
  `POST /api/v1/credits/{id}/write-off`, with a reason.
- **Returns:** a return's answer says how much lowers the debt and how much
  goes back, and which way. A return that only lowers the debt needs no way.
  `GET /sales` says which sales were `paid_in_parts`.

- **By customer:** `GET /api/v1/credits/customers?store_id=` groups a store's
  debts by customer, where one phone is one customer.
  `GET /api/v1/credits/summary?store_id=` says what the store is owed in all.
- **The customer erased** (owner decisions, 2026-10-09;
  [ADR-0015](.ai/decisions/ADR-0015-customer-data-retention.md)): a year
  after a debt was paid or returned, three after a write-off, the
  `backup-watch` service erases the name and phone hourly, with a
  write-off's reason; every sum stays. The owner (`credit:erase_customer`)
  erases a customer who asks at `POST /api/v1/credits/{id}/erase-customer`:
  every closed debt under the same phone, the network's owner in the whole
  network, a store's owner in that store (`network` in the answer); an open
  one is refused, `STILL_OWED`. An
  erased debt reads `customer_name`, `customer_phone` and, by customer,
  `phone_digits` as `null`, with `customer_erased_at`, and is found by
  neither.
- **Orders:** `POST /api/v1/orders/{id}/collect` takes the same `credit` as a
  sale.

In the app: «Оплата частинами» at the till and on collecting an order, and a
«Борги» section for `sale:credit`, where «Готівка», «Картка» and «Переказ»
take a payment. Only `credit:write_off` writes a debt off, and only the
owner erases a customer («Стерти дані покупця»), a store's owner in that
store. See the
[credit report](.ai/project-memory/customer-credit-report.md), the
[credit screens report](.ai/project-memory/credit-screens-report.md) and the
[customers' data report](.ai/project-memory/customer-data-retention-report.md).

## Cash and card, the day's close

Every payment says how it was paid, and each store's drawer is counted once
a day (owner decisions, 2026-10-04; see
[ADR-0012](.ai/decisions/ADR-0012-cash-and-card.md)).

- **The way of paying:** `payment_method`, one per payment, never split.
  - `POST /sales`, `POST /credits/{id}/payments` and
    `POST /sales/{id}/refunds` take `CASH`, `CARD` or `TRANSFER`. A refund's
    way is how the money went back; the screen suggests the sale's.
  - `POST /orders/{id}/collect` also takes `PREPAID_TRANSFER` (in advance by
    transfer) and `CARRIER_COD` (cash on delivery).
  - A new command without it is refused `PAYMENT_METHOD_REQUIRED`, with
    `recorded: false`. A command recorded before still replays. Sales
    recorded before migration `0035` read «не вказано».
  - In the app «Продати» is three buttons, «Готівка», «Картка» and
    «Переказ»: a sale is still 5 taps. Press first, then charge the terminal.
- **Only cash is counted.** Cash at the till, cash handed back, and cash paid
  at the counter for an order are the drawer's. Card and transfer are shown
  at the close, to compare with the terminal's slip.
- **The day's close:** `POST /cash/closes?age=` with the count, named by a
  `command_id`. The seller on duty counts without seeing what the drawer
  should hold (`GET /cash/drawer` never says), then sees the difference.
  - Once per business day, 06:00 to 06:00, Kyiv time
    (`ALREADY_CLOSED_TODAY`). A count more than 10 minutes old is not
    recorded (`COUNT_IS_STALE`).
  - The count is the next day's starting cash. The first close only records
    it.
  - A difference of 1,00 грн or more needs a reason,
    `POST /cash/closes/{id}/reason`, by whoever counted. Until it is
    written, only «Каса» is open on their phone.
  - A blocked store is closed by the network's owner only.
- **Cash taken out and put in:** `POST /cash/movements`. A seller
  (`cash:expense`) records «Витрати» and «Кур’єру постачальника»; the owner
  and managers (`cash:take_out`) also «Власнику» and «Внесено в касу
  (розмін)».
- **A wrong way** is fixed by a new record, `POST /cash/corrections`: a
  seller their own sale, payment or return before the close; the owner and
  managers (`cash:correct`) any, any day. A fix of a closed day explains that
  close's difference and leaves today's cash alone.
- **Who reads:** the closes, `GET /cash/closes`, and a day's money,
  `GET /cash/events`, need `report:view_financial`. A seller reads only their
  own close.
- **The bot** tells the network's owner of a difference, silently: once its
  reason is written, or 15 minutes after the close. `backup-watch` sends it.
- **Going back** by the code alone across `0035` is not safe once phones run
  the new version: see the
  [server runbook](.ai/project-memory/server-runbook.md#going-back). After
  the update, reopen the app on every phone.

In the app: «Каса», for whoever closes, takes out cash or reads the money.
See the [report](.ai/project-memory/cash-and-card-report.md).

## When the server does not answer

The shops sell on paper, and type the sales in when the server answers
(owner decisions, 2026-10-04 and 2026-10-07; see
[ADR-0013](.ai/decisions/ADR-0013-the-server-is-unreachable.md)).

- **The seller is told** «Сервер не відповідає. Продавайте на папері:
  модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть
  продажі до закриття каси.» on no answer, a timeout, a 502, 503 or 504.
  - A database that does not answer, or a schema behind the code, answers
    `503 SERVER_UNAVAILABLE` (`reason`: `DATABASE` or `SCHEMA`) instead of a
    500. A fault in the code keeps its «Номер запиту».
- **A refusal that proves nothing was recorded says so** (`recorded:
  false`) on every seller's command refused after its lookup: sales, empty
  shelves, debt payments and write-offs, orders, returns, deliveries and
  stock corrections. A kept attempt refused so on resend settles the phone.
  One resent after its store was blocked, or its warehouse closed, is
  refused before the lookup, with no `recorded`, and stays kept until the
  store trades or the warehouse reopens (owner, 2026-10-08).
- **The phone checks a kept operation by itself,** with the same command:
  once when the server answers again (while something waits it asks
  `/api/v1/ready` every 20 seconds), and once when the app is opened with
  it. The banner says since when it waits, and to write it on paper «у
  телефоні — <ім’я>» without typing it in.
- **A sale typed from paper** («Вношу продаж з паперу» at the till) sends
  `outage: {sold_by_user_id, sold_at}`, both optional, with `POST /sales`.
  - It is an ordinary sale, dated when it is typed, marked «продано під час
    збою» on the receipt, in the sales list and in «Звіт», which also names
    who typed it. The mark is never changed (migration `0036`).
  - `GET /stores/{id}/sellers` lists who may be named. The paper time is
    today or yesterday only. It may not answer the shelf
    (`OUTAGE_SHELF_REPORT`), and goods gone from the ledger are refused
    until a manager fixes the balance.
- **The bot** says «Продавці продають на папері.», and when the server
  answers again «продажі з паперу можна вносити».
- **The sellers' page,** to print:
  [paper-when-the-server-is-down.md](.ai/project-memory/paper-when-the-server-is-down.md),
  confirmed by the owner on 2026-10-08.

See the [server runbook](.ai/project-memory/server-runbook.md#when-the-server-does-not-answer)
and the [report](.ai/project-memory/outage-fallback-report.md).

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
Collection says how the order was paid (`payment_method`, one of five; see
"Cash and card, the day's close"), and may be paid in parts (`credit`, as on
a sale; see "Paying in parts"); the customer's name and phone are then kept
on the debt. Otherwise
an order records no name, phone or address (see "Where an order goes").
Partial shipments and reservation expiry remain out of scope. Migration
rollback refuses existing order/reservation history.

**Where an order goes** (owner decisions, 2026-10-01):
- **When it is made:** `destination` is `UKRAINE` (the default) or `ABROAD`.
  Within Ukraine a `carrier` is required: `NOVA_POSHTA`, `UKRPOSHTA` or
  `MEEST`.
- **When it is sent, or later:** `POST /orders/{id}/dispatch` may carry a
  `waybill` within Ukraine, or an `abroad_note` (city, country and how it
  went) abroad.
- **Corrections:** `POST /orders/{id}/shipping` states all of it again while
  the order is open. Every version is in `shipping_history`.
- **One waybill on two orders** is saved; each order lists the other in
  `same_waybill`. `GET /orders?waybill=` finds orders by it, however spaced.
- No name, phone or address is recorded. See the
  [report](.ai/project-memory/order-shipping-report.md).

## Checks

Everything below runs in CI on every pull request and every push to main,
and all of it must pass.

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
accepts `store_id`, an optional `location_id`, `limit`, `offset` and an optional `query`
(every word in the model's name, source or colour), returning named stock
options by name, each model's sizes together, and `has_more`; each row names its
warehouse (`location_id`), and without `location_id` every warehouse the store
sells from is listed (ADR-0004, 2026-10-17). Order responses now document frozen size labels and
creation dates in OpenAPI; old command snapshots remain compatible.

Run `npm run dev` in `frontend/`; `/api` proxies to `http://127.0.0.1:8000` by
default. Set `BIRKA_DEV_API_URL` for a different local API. Production still uses
same-origin `/api` through Caddy. Opening outside Telegram shows entry guidance;
there is no production test-login bypass.

Pending commands are retained in browser local storage under organization/user/store
keys, without auth tokens. Retry keeps the original command and refreshes the
current order. Do not clear that journal to recover an uncertain operation;
restore access/connectivity and retry. The phone also retries it by itself,
once when the server answers again and once when the app is opened with it
([when the server does not answer](#when-the-server-does-not-answer)). Paying
in parts has its own section above. See [verification and E2E setup](.ai/project-memory/order-ui-report.md).

**Returns at the till** («Повернення»): the seller finds the sale in the
store's list (`GET /sales?store_id=…&q=…`) and states, for each unit, whether
it came back intact or damaged. Intact goes back to the warehouse it was sold
from; damaged goes to the store's own «Брак», which `seed_organization`
creates for every store and nothing sells from. In the «Брак» section,
anyone who takes returns takes a unit for inspection. It then goes back on
sale in the warehouse it was sold from, or is confirmed damaged and later
written off. Stock in «Брак» changes through nothing else. See the
[returns](.ai/project-memory/till-returns-report.md) and
[«Брак»](.ai/project-memory/damaged-inspection-report.md) reports.

**Returns at another store:** any store of the network takes back goods
another one sold, and hands the money back.
- **Finding the sale:** `GET /sales?store_id=<this store>&elsewhere=true&q=…`
  searches the other stores' sales. It needs `sale:refund` and a search.
- **Taking it back:** `POST /sales/{id}/refunds` with `store_id` names the
  store taking the goods back. Intact goods go where they were sold from.
  Where this store does not reach that warehouse, a line states `location_id`,
  one of this store's own. Damaged goods go to this store's «Брак».
- **The record:** a refund answers `taken_at_store_id`. See the
  [report](.ai/project-memory/returns-elsewhere-report.md).

**Store states:** the owner of the network blocks a store, archives one that
stopped trading and opens either again, saying why («Магазини» in the app).
- **The change:** `POST /stores/{id}/state` with `state` (`ACTIVE`,
  `BLOCKED`, `ARCHIVED`) and a `reason`, named by a `command_id`;
  `GET /stores` lists them. Both need `store:manage` held network-wide.
  Only an empty store is archived: a refusal lists its `leftovers`.
- **A store that does not trade** answers every change with
  `STORE_NOT_TRADING`. A network-wide role still reads it; its own people see
  only its `state` in `/me`.
- **Its debts** are found at a store that trades with
  `GET /credits/customers?elsewhere=true&query=…` and paid there with
  `store_id` on the payment. See the
  [report](.ai/project-memory/store-states-report.md).

**Returns to a supplier:** the owner and managers (`supplier:return`) send
goods back to a supplier from the network's list («Постачальникам»).
- **From a warehouse:** `POST /supplier-returns` with a `command_id`, the
  warehouse, the supplier and the lines. Only goods free to sell leave, never
  from a «Брак».
- **From «Брак»:** `POST /damaged-units/{id}/return-to-supplier`, for a unit
  whose damage is confirmed.
- **Cancelling:** whole, once, with a reason, through
  `POST /supplier-returns/{id}/cancel` or, for a unit from «Брак»,
  `/damaged-units/{id}/cancel-supplier-return`.
- **The list:** `GET/POST/PUT /suppliers`. See the
  [report](.ai/project-memory/supplier-returns-report.md).
- **A return set off against an invoice** is not cancelled until that
  set-off is (`SET_OFF`).

**What a store owes its suppliers:** the owner and managers (`supplier:debt`)
record invoices on their own, never with a delivery («Накладні»).
- **An invoice:** `POST /supplier-invoices` with a `command_id`, the supplier,
  the sum on it and what was paid at once, from nothing to all of it.
- **Paying, in parts:** `POST /supplier-invoices/{id}/payments`, never more
  than is owed. While the store does not trade, another store that trades
  pays with `store_id` (`elsewhere=true` lists those invoices).
- **A set-off:** `POST /supplier-invoices/{id}/set-offs` names a return to
  the same supplier from the same store, for the sum the supplier counted.
- **Mistakes:** `POST /supplier-invoices/{id}/entries/{entry_id}/cancel` and
  `POST /supplier-invoices/{id}/cancel`, with a reason; an invoice only once
  nothing on it stands. The owner writes off what is left with
  `POST /supplier-invoices/{id}/write-off` (`supplier:write_off`).
- **What the store owes:** `GET /supplier-invoices/summary`, in all and by
  supplier. See the [report](.ai/project-memory/supplier-invoices-report.md).

**Borrowed goods, and goods under consignment** (owner decisions,
2026-10-01): paid for only once sold, at a price agreed for each.
- **Taken:** `POST /inventory/receipts` with lines `BORROWED` or
  `CONSIGNMENT`, a `supplier_id` and a `unit_cost` for each. It needs
  `supplier:debt` (`SUPPLIER`, `PRICE`).
- **The list:** `GET /borrowed` shows what was taken, sold, returned and is
  still on hand («Постачальникам»).
- **Sold:** `POST /supplier-invoices/sold` with a `stock_lot_id` and a
  quantity is an invoice for their price. Cancelling it puts them back on
  hand.
- **Unsold:** `POST /supplier-returns` with the `stock_lot_id` sends them
  back to their supplier, never more than is on hand (`MORE_THAN_ON_HAND`).
  See the [report](.ai/project-memory/borrowed-goods-report.md).

**The sales report** (owner decisions, 2026-10-02): what each store sold and
took back, and the money through its till («Звіт»). The owner and managers
read it (`report:view_financial`), each for the stores they hold it in.
- **Each store, and the stores together:** `GET /reports/sales` for today,
  or `date_from` and `date_to`, one day to a year (`PERIOD`), by the store's
  own clock.
- **The models sold:** `GET /reports/sales/models`, the most money first.
- **Every sale and return:** `GET /reports/sales/entries`, the newest first.
  Both read one store with `store_id`, or every store the report shows.
- A sale and its returns are the store's that sold; money is the store's
  whose till it went through. A return counts on the day it was taken. See
  the [report](.ai/project-memory/sales-report-report.md).
- **Since 2026-10-04 the money is split by way:** `money` (renamed from
  `cash`), and `ways` for cash, card, transfer and «не вказано», whose nets
  add up to it. An order paid in advance or on delivery is in `off_till`,
  outside «Разом». A fix of a way counts on the day it is made, so a past
  day never changes. Each entry says its `payment_method`, and `method_now`
  when it was fixed.

**Correcting the catalogue** (owner decision, 2026-10-03): the owner and
managers (`catalog:merge`) put a typo right in «Моделі». See
[ADR-0008](.ai/decisions/ADR-0008-catalog-correction.md).
- **Finding a model:** `GET /catalog/models?store_id=&query=`, retired ones
  too; `GET /catalog/models/{id}` is its card.
- **Renaming one model:** `POST /catalog/models/{id}/rename` states its whole
  name again. It keeps its id, stock and prices; old receipts keep their
  name. A name another model has is refused (`SAME_AS`), to be merged.
- **Merging a duplicate:** `GET /catalog/models/{id}/merge/{into}` previews
  both models, the stock that would move and what stops it;
  `POST /catalog/models/{id}/merge` does it, for good. Its stock moves to the
  model that stays in every warehouse and size, as the merge's own ledger
  movements; the duplicate's price fills only where the model that stays has
  none. It needs the right in every store, and waits while the duplicate has
  anything open (`MERGE_BLOCKED`). Afterwards the old name leads to the model
  that stays: returns, «Звіт», search.
- **Retiring:** `POST /catalog/models/{id}/retire` and `/restore`. A retired
  model's stock still sells; nothing new is received (`MODEL_RETIRED`).
- **A similar name at creation** (a Latin letter in a Cyrillic word) is
  refused once with `CATALOG_SIMILAR`; `similar_confirmed` creates it as
  typed. See the [report](.ai/project-memory/catalog-correction-report.md).

**One size, one spelling** (owner decision, 2026-10-03): `m`, `м` and `M`
are one size, `2XL` is `XXL` (and `1XL` is `XL`), and `46 – 48` is `46-48`;
`46/48` stays another size. A size is shown in one spelling, capital Latin
with the X's written out, and the size system does not separate sizes: `M`
typed under «Інша» is the shop's `M`. A product's answer gives each size's
spelling with what was `typed`, and «Створити товар з опису» says «Набрано
«м» — це розмір «M»». See
[ADR-0009](.ai/decisions/ADR-0009-one-size-one-spelling.md) and the
[report](.ai/project-memory/size-spelling-report.md).

**Before the public domain** (owner decisions, 2026-10-03; see
[ADR-0010](.ai/decisions/ADR-0010-before-the-public-domain.md)):
- **No customer's name or phone** reaches the API's log, Caddy's log or
  Sentry: query strings and a refused row's values are cut.
- **Limits:** Caddy refuses a body over 1 MB; the API takes 30 sign-ins a
  minute from one address (`RATE_LIMITED`).
- **Sessions** last 12 hours. `scripts.people sign-out` ends every sign-in of
  a person, on the owner's word, and keeps their access; turning someone off
  ends them too. The app sends its launch data once.
- **Updates** happen while the shops are closed. The page is never cached,
  the previous bundle stays for 30 days, and no source maps are shipped.
- **The server installs exactly the tested libraries**
  (`backend/requirements.lock`), audited in CI.
- **The bot tells the owner** a week before the site's certificate runs out.

See the [report](.ai/project-memory/public-hardening-report.md).

**Failures are visible** (owner decisions, 2026-10-03; see
[ADR-0011](.ai/decisions/ADR-0011-failures-are-visible.md)):
- **`backup-watch` also watches the server**, every minute:
  - the API and its database (`/internal/status`, on the compose network
    only);
  - the disk;
  - whether people can sign in.
- **The bot tells the owner and the administrators**
  (`BIRKA_ADMIN_TELEGRAM_IDS`) when the app has not answered for 5 minutes,
  the disk is nearly full, or nobody could sign in for 10 minutes.
  - It writes once, then daily, then when it works again.
  - Messages have a sound from 9:00 to 20:00, Kyiv time, and are silent
    otherwise.
  - The «Резервні копії» section shows the same.
- **A server that dies whole** is noticed by an outside service, which the
  watcher checks in with every 10 minutes (`BIRKA_HEARTBEAT_URL`).
- **`GET /api/v1/ready`** answers only when the database does and its schema
  is current. Compose checks the API's health with it.
- **A broken screen** shows «Щось пішло не так» and «Перезапустити»
  instead of a blank page, and leaves a note in the server's log with no
  personal data.
- **A server error** shows its «Номер запиту». Since 2026-10-08 a database
  that does not answer shows the paper text instead
  ([when the server does not answer](#when-the-server-does-not-answer)).
- **Sentry** is ready for the API and the watcher, and stays off until a
  DSN is set.

See the [report](.ai/project-memory/failures-visible-report.md).

**Suggested selling price:** the till prefills it when a model is picked, and
the seller may still agree another. The owner and managers set it
(`catalog:set_price`) where goods arrive and on the stock screen. It is one
price for the whole shop (`POST /catalog/prices`, `applies_to: ORGANIZATION`),
which needs the permission organization-wide or in every store. A store may
override it with its own (`STORE`), which needs the permission in that store. A change states the price the screen showed, and is refused
with `PRICE_CHANGED` if that no longer stands. See the
[report](.ai/project-memory/suggested-price-report.md).

**Nothing on the shelf** («На полиці немає жодної»): a line the seller finds
none of is dropped from the sale (`missing_in_store` with `quantity: 0`). Its
shortage is recorded, and the rest is sold. When nothing is left to sell,
`POST /shelf-shortages` records the shortage without a sale, under the
basket's own `command_id`. A basket becomes a sale or an empty shelf, never
both. See the [report](.ai/project-memory/empty-shelf-report.md).

Every Playwright journey also runs in CI (job `e2e`) on every pull request
and every push to main. It uses the real API and PostgreSQL 17 with the
production locale, on a Pixel 7 profile. The job's steps are the recipe for a
local run; see the [E2E in CI report](.ai/project-memory/m1-027-e2e-ci-report.md).


## Catalog parser preview (M1-020)

From `backend/`, pipe one raw line into `python -m scripts.preview_catalog`.
Parser v1 returns candidate attributes with exact text evidence and preserves
unknown descriptors, including rare item codes. It does not create products,
choose matches or change inventory. Slash lists require review; quantities are
never divided automatically. See [scope and verification](.ai/project-memory/m1-020-parser-report.md).

## Legacy stock lists → opening balances (M1-023, ADR-0014)

A paper or PDF availability list, or a parser's files read from photos of
the notebooks, becomes stock in three steps, never one
([ADR-0005](.ai/decisions/ADR-0005-legacy-snapshot-import.md),
[ADR-0014](.ai/decisions/ADR-0014-opening-stock-from-a-json-file.md)).

**In the app,** «Початкові залишки» does all three:
- the owner or a manager fills the list: a parser's file, further files, and
  lines typed by hand; a file put in by mistake is removed, with its answers;
- the owner or a manager answers each line;
- the owner approves the list or rejects it.

See the [opening stock report](.ai/project-memory/opening-stock-screen-report.md)
and the [JSON stock import report](.ai/project-memory/json-stock-import-report.md).
The parser's author needs only the format package,
[`formats/birka-stock-list/`](formats/birka-stock-list/README.md): its
description, JSON Schema, example and reference validator
(`python -m scripts.check_stock_file FILE.json`).
Through the API:

1. `POST /api/v1/snapshots` with a client `command_id` (unique within the
   organization; a retry repeats it), `store_id`, `location_id` and exactly
   one of:
   - up to 1 000 `lines` of at most 500 characters (100 000 in all), kept
     verbatim and parsed;
   - a `file` in Birka's format, `birka.stock-list` version 1, with its
     `file_name`: each line keeps its text, its photo's name and line, and
     the parser's reading as a hint. A file's refusal (422) names its line.
     No 422 on a list's routes echoes the request, and a 422 on any route
     lists at most 50 refusals, `detail_truncated` counting the rest.

   Nothing is matched, created or counted. The response's `snapshot_id`
   names the list from then on. `snapshot:import` (manager, owner).

   A list is filled by parts, each a file or a typed text of up to 1 000
   lines:
   - `POST .../parts` adds one, with its own `command_id` (201, or 200 on a
     retry); the same file twice in one list is refused
     (`SNAPSHOT_CONFLICT`, `PART_DUPLICATE`);
   - `POST .../parts/{part_id}/remove` removes one with its answers, never
     the last (`LAST_PART`); its lines stay as evidence, `REMOVED`;
   - `GET .../parts` lists them, with who added and removed each.

   A list holds at most 5 000 lines not removed and 5 000 allocations, as
   measured (ADR-0014 §10), and the owner kept that limit (2026-10-08): the
   shops' largest warehouse comes to at most that (owner, 2026-10-09). A
   part over the lines, the 10 000 rows with removed files' lines, or the
   1 000 parts is refused with `409 SNAPSHOT_CONFLICT`, `LIST_FULL`; an
   answer over the allocations, at step 2, with `422 VALIDATION_ERROR`,
   reason `LIST_FULL`, `what: "allocations"`.
2. `PUT /api/v1/snapshots/{id}/lines/{line_no}`: say what the line is. That is
   either `allocations` (`product_variant_id`, `size_id` or
   `size_unknown: true`, `quantity`) with a `quantity_basis`, or a
   `skip_reason`:
   - `STATED` — exactly the line's own count, in one allocation; never for a
     line naming several sizes or colours;
   - `STATED_BY_SIZE` — only for a file line whose text writes each size
     joined to its count by a sign («S-1 M-2 L-1», «Лоран M-3»), and
     nothing beside them but a price, a count with «шт» or a length: one
     model, one allocation per size with exactly its count. A record that
     may also be a range of sizes (`shown_split[].may_be_range`: a number
     size whose count, also a number, reads as a larger size after it
     («42-44», «98-104»), whatever the catalogue holds, or a record whose
     count or whole is a size of the catalogue) needs
     `split_read_as: "SIZE_WITH_COUNT"`, what the person chose, with
     `split_read_records`, the records the person was asked about as
     `shown_split[].written` writes them (by `shown_split[].size` when
     `written` is null, a record the text no longer shows); without it, or
     with a record that may be a range as the answer arrives left out of
     them, the answer is refused (422, `SPLIT_MAY_BE_RANGE`, naming the
     records, which the app then asks about), checked again
     at the answer (owner decision, 2026-10-09; the records since the
     review's third round, the same day). The line keeps it
     (`split_read_as`), with exactly the records named
     (`split_read_records`), and the approval reads each again;
   - `LINE_IMPLIES_ONE` — a line with no number that could be a count, taken
     as one piece;
   - `RECOUNTED` or `OWNER_KNOWLEDGE` — with a `note`.

   A removed line is refused (`PART_REMOVED`).
3. `POST /api/v1/snapshots/{id}/approve` with `expected_review_revision`.
   This writes `OPENING_BALANCE` lots and movements, only into a warehouse
   with **no stock history**. `snapshot:approve` (owner). For a child store's
   private warehouse, the approver must hold the owner's role in the child
   store itself. Alternatively, `POST .../reject` with a `reason` keeps
   everything as evidence. A line answered by size whose record has since
   become a possible range, a size having been created, stops the approval:
   `409 SNAPSHOT_CONFLICT`, `SPLIT_MAY_BE_RANGE`, with its `line_nos`, until
   it is answered again (review, 2026-10-09).

   A list whose own store is blocked or archived (`store_state`) is rejected
   through the other store, which releases its warehouse; nothing else is
   done to it, through either store: through the other one the refusal is
   `SNAPSHOT_CONFLICT`, `LIST_STORE_NOT_TRADING` (owner decision,
   2026-10-09). So too while that store no longer holds `can_receive` at the
   warehouse: `SNAPSHOT_CONFLICT`, `LIST_STORE_CANNOT_RECEIVE` (review,
   2026-10-09).

Approve a warehouse's list before anything else is recorded there. Paper sales
made between the count and the approval are entered afterwards, as ordinary
sales (owner decision, 2026-09-29). Entering one first closes the warehouse to
its list for good.

**While a list waits, so does its warehouse** (owner decision, 2026-10-02):
in a warehouse with no stock history, every movement but the opening balance
is refused with `409 OPENING_LIST_PENDING` until the list is approved or
rejected. A list for a warehouse that already has history holds nothing back.
Goods found later go in through «Приймання», with their size.

`GET /api/v1/snapshots?store_id=` (optionally `&location_id=`),
`GET /api/v1/snapshots/{id}` and `GET .../lines` (optionally `?part_id=`)
read lists, their summary by basis, and each line's evidence and answer.
`GET .../application` pages what an approved list became. Every route on a
list takes `?store_id=`, the store acted through: a list of the shared
warehouse is reached from either store that may receive there. A decided
list, and its parts, are frozen by the database.

Apply migration `0015` in a maintenance window, with no older instance of the
app running. It adds CHECKs to `stock_movement` and `stock_lot` under an
exclusive lock, and code before it takes no warehouse lock. Migration `0037`
(a list's parts) also runs in a maintenance window: it locks the three
snapshot tables, and makes each existing list its first part.

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
- A sale's answer (`POST /api/v1/sales`, `GET /api/v1/sales/{id}`) names each
  line's frozen `size` («UNKNOWN» for a size not known) and counts its in-sale
  corrections in units, from the movements written: `found_quantity`,
  `missing_quantity` and `clarified: [{size, quantity}]` (redesign P1-1).
  Answers stored before these fields give them as null.
- The paper mark (`outage`) on a sale, a return and a debt payment takes
  `first_days: true` for the first days' paper, «з паперу» (ADR-0013 §5.8,
  revision 0041): its paper time may be of the last 14 days, today among
  them, an outage's of today or yesterday; `OUTAGE_TIME_TOO_OLD` says
  `days`, the days before today taken (13 or 1). Every answer that
  carries the mark, and «Звіт»'s entries, say `first_days`; absent or false
  is an outage's mark, printed as before.
- `GET /stock-locations` says `awaiting_first_stock` for a warehouse where
  nothing has been recorded yet, its opening list typed or not: the till
  says to sell on paper there (redesign P1-5; owner, 2026-10-16).
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
`infra/pull-backups.sh`, and deletes its nights older than 3 months, keeping
the newest that can be restored (owner, 2026-10-09). Only the owner holds
the private key.

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
