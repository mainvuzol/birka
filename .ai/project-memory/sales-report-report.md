# The sales report — 2026-10-02

Baseline: `12f50ab` (goods borrowed from another shop, merged as PR #61).
Status: implemented and verified locally. No migration.
Branch: `feat/sales-report`.

## Why this was next

With PR #61 merged, the backlog held only the JSON stock import, which waits
for the parser's format. Offered a sales report, a reminder at the till for
borrowed goods, the JSON import or a country field for orders abroad, the
owner chose the report. The app had no figures of any kind for a day or a
period.

The owner answered its rules on 2026-10-02 (business-rules.md, "the sales
report").

## What exists now

**«Звіт», for the owner and managers** (`report:view_financial`, which the
manager's role already held and nothing used).
- **The period:** today when it opens; «Вчора», «Цей тиждень» (from Monday),
  «Цей місяць», or any dates «Від» and «До», one day to a year.
- **Each store the person may see**, and «Усі магазини разом» when there are
  several:
  - «Продажі: N (M од.)» and their sum;
  - «Повернення: N (M од.)» and what the goods were worth;
  - «Продано з урахуванням повернень»;
  - «Гроші в касі»: «Оплачено одразу повністю», «Внески за борг», «Віддано при
    поверненнях», «Разом у касі».
- **A store that does not trade** is marked «заблоковано» or «в архіві», for
  the owner and the network's managers who read it.
- **«Моделі»:** each model sold, how many and for how much, the most money
  first, with what came back of it.
- **«Продажі й повернення»:** every sale and return, the newest first, fifty
  at a time:
  - the time, the sum, who made it, the goods;
  - a sale «оплачено повністю» or «частинами, внесено …»;
  - a return «віддано …» or «лише зменшило борг»;
  - a return taken at another store: «продав «…», прийняв «…»».
- **The models and the list** read one store, or every store, chosen under
  the figures.
- **A seller has no «Звіт».**

**On the server:**
- **`GET /reports/sales`** (`date_from`, `date_to`): each store this person
  holds `report:view_financial` in, a store that does not trade included
  where they may read it; and `total` when there are several. It answers the
  days it read and `today`, by the stores' clock.
- **`GET /reports/sales/models`** and **`GET /reports/sales/entries`**
  (`store_id`, `limit`, `offset`): one store, which needs the right there, or
  every store the report shows.
- **A period** is one day to 366 days (`PERIOD`). A first day alone is that
  day; nothing is today.
- **A day is the store's own:** the period is cut at the store's midnight
  (Europe/Kyiv), each store by its own clock.
- **The figures:**
  - a sale is the selling store's, on the day it was sold;
  - a return is the selling store's, on the day it was taken;
  - a payment towards a debt is the store's that took it
    (`taken_at_store_id`, or the selling store), on its day;
  - money a return handed back is the store's that took it: what the goods
    were worth for a sale paid in full, its `cash_back` alone for one paid in
    parts;
  - «Разом у касі» is sales paid in full and payments, less money handed
    back.
- **Module `reports`**, new. It reads sales, refunds, debts, people and
  stores, and writes nothing. Two contracts keep it so (27 in all).

## Evidence

- **Backend: 1223 passed, 1 skipped** (the `age` test, run by CI). 6 tests
  are new, in `test_sales_report.py`, signed in as the network's people with
  real tokens:
  - **a day of one store:** two sales, one paid in part, a later payment, a
    return of two units for their money and one that only lowered the debt —
    every figure, the other store's zeros and the total;
  - **the sale is the seller's and the money the till's:** a sale of the
    child store returned at the primary one, and the child's debt paid there
    while the child is blocked;
  - **a day is the store's own, a return counts on its day:** a sale at 23:30
    and its return at 00:10 by Kyiv, the 10th and the 11th of March, though
    by UTC both are the 10th;
  - **who reads it:** never a seller; one store's manager that store alone,
    no total, and not another store's lists; the network's manager and owner
    every store; a blocked store by the network, never by its own manager;
  - **a period:** backwards and 367 days refused, 366 read, a first or last
    day alone one day;
  - **the models and the list:** the most money first, returns beside them;
    the newest first, sales and returns, those taken here of another store's
    sales; a sale in parts and its first payment; a return that only lowered
    a debt; paging.
- **Gates:**
  - ruff, format and mypy are clean;
  - 27 import contracts are kept;
  - `alembic check` is clean, and the migrations round-trip.
- **E2E: 130 → 133 passed** against the real API. 3 are new, in
  `sales-report.spec.ts`, in the stores' own network. Other journeys sell
  there the same day, so each figure is checked as what the journey added to
  the report read before it:
  - **the owner reads each store and the stores together:** «Центр» sells two
    coats and takes one back; «Ринок» sells one in parts and «Центр» takes it
    back. Every figure of both stores; «Старий» marked «в архіві»; the models
    of «Центр» alone; the list's sales and returns, named by store;
  - **a manager reads their store alone, and a seller has no report;**
  - **the period:** «Вчора», «Цей тиждень», «Цей місяць» as asked of the
    server, any dates, and a backwards period refused with its reason.

**Mutation testing — 44 mutants, all caught (backend 26, frontend 18).**
- **Survived at first:** a return that only lowered a debt read «віддано
  0,00 грн», not «лише зменшило борг». No journey had such a return. «Ринок»
  now sells two coats in parts, and «Центр» takes one back without handing
  money back.
- **Backend:**
  - a seller reading the report; a store asked for not checked;
  - a day by UTC; the last day left out; a backwards period, or a year and a
    day, accepted; a first day alone running to today;
  - a sale in parts counted as paid in full; units counted as sales, returned
    units as returns;
  - a return counted for the store that took it; a payment, or money handed
    back, counted for the store that sold; a return in parts handing back
    all it was worth;
  - no total for several stores, or one for a single store;
  - net shown as what was sold; the till forgetting what it handed back;
  - the models least money first, their returns forgotten or counted where
    taken;
  - the list oldest first, without the returns taken here, with more when
    exactly a page, a sale in parts taking all its money, a return in parts
    handing back what it was worth.
- **Frontend:**
  - a sum below nothing shown above it; what went out shown as what came in;
  - the week from Sunday, the month thirty days back, yesterday as today;
  - the store or the days chosen not asked for; the first day typed ignored;
  - a seller offered the report; the total hidden; a store to choose for one
    store; an archived store not marked;
  - payments shown as paid in full; a sale in parts shown as paid in full;
  - a sale's store, or a return taken elsewhere, not named;
  - a period refused without saying why.

## Not covered here

- **Cash and card are one sum**, as the owner chose. Splitting them needs the
  till to ask, and its own work. *Done on 2026-10-04; see the update below.*
- **The list has no debt payments**, as the owner chose its contents; their
  sum is in the figures.
- **The figures are summed on every request**, unmeasured, and without an
  index of their own.
- **Profit is not shown:** a sale does not know which delivery its coat came
  from, so what it cost is not known. It was not asked for.
- **Still waiting for the owner:** the JSON stock import (backlog).
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/app/modules/reports/__init__.py`, `sales.py`;
  - `backend/app/api/v1/reports.py`;
  - `backend/tests/integration/test_sales_report.py`;
  - `frontend/src/reports/SalesReport.tsx`, `types.ts`;
  - `frontend/e2e/sales-report.spec.ts`.
- Backend:
  - `api/v1/router.py`: the report's routes;
  - `pyproject.toml`: two contracts.
- Frontend:
  - `src/App.tsx`: «Звіт», for whoever holds the right in the store open;
  - `src/shared/api.ts`: what `PERIOD` says;
  - `src/styles.css`: the two days side by side.
- Docs:
  - business rules;
  - the backlog;
  - the risk register;
  - the milestone;
  - ADR-0001;
  - the README.

## Update — 2026-10-04: cash and card

The till now asks how each payment was made, and the drawer is counted once
a day (owner decisions, 2026-10-04; see the
[cash and card report](cash-and-card-report.md) and
[ADR-0012](../decisions/ADR-0012-cash-and-card.md)). The report changed with
it:
- **The money is split by way.** Each store and the stores together show
  «Готівка», «Картка» and «Переказ» under «За способом оплати»: what came in,
  what went back, what fixes moved, and the net. The four ways' nets add up
  to «Разом».
- **`cash` is renamed `money`,** in the answer and in each entry. It was
  always the money through the till, card and transfer included, never
  banknotes. On the screen the heading «Гроші в касі» is now «Гроші», and
  «Разом у касі» is «Разом»: «Каса» now means the drawer.
- **An order paid off the till** has its own lines, «Замовлення, оплачені
  поза касою»: «Переказ наперед» and «Накладений платіж», outside «Разом».
  Before, its whole price counted in «Оплачено одразу повністю» on the day
  it was collected. Only what was paid at the counter is till money.
- **A fix of a way counts on the day it is made,** at its drawer, as its own
  figure. A row «Виправлення способу оплати» sits before «Разом» when a fix
  moved money into or out of the till, and a line under the ways says what
  moved. A past day never changes.
- **Old sales read «Не вказано».** Money recorded before the way was asked
  is never guessed. The row shows only when it holds something.
- **Each entry** names the way it was paid, and the way now when it was
  fixed («(виправлено: готівкою)»).
- **Cash taken out and put in is not in «Звіт».** It is in «Каса», with the
  closes.
- **On the server:** `GET /reports/sales` answers `money`,
  `corrected_into_till`, `ways` (cash, card, transfer and not stated, always
  in that order) and `off_till`; an entry answers `money`, `payment_method`
  and `method_now`. `reports` reads `cash.models` and `cash.current`, and
  nothing else of the drawer.
- **Tests:** `test_sales_report.py` pins the four ways and the off-till lines
  on every figure it reads, the split, orders paid off the till, a card
  return that does not lower the cash, fixes on the day made with yesterday
  byte for byte the same, and old sales. `sales-report.spec.ts` sells by
  card and by transfer, and returns to the card.

Readings the owner confirmed as built on 2026-10-08 (business rules, cash
and card, "carried out", 28 and 29): a return of an order paid off the till
goes back through the till and lowers «Разом»; «Продажі» still counts every
sale, orders paid off the till included.
