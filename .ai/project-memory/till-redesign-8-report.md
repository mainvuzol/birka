# The day's count on the till's receipt (В8) — 2026-10-17

Baseline: `2e148d3` (money in one format, the till's words and its refusals,
PR #96).
Status: TODO.
Branch: `feat/till-sold-today`. Tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
§11 В8. Owner: business-rules.md, "the day's count at the till, В8"
(2026-10-17); В8 (а) itself on 2026-10-16.

## Why this was next

The owner decided on 2026-10-16 that the seller sees «Сьогодні ви продали N
шт.», units only, so the drawer's blind count keeps nothing to go by; it
needed a count from the server, and was the one thing decided and not yet
built. Asked again, the owner chose it next and said how to count it.

## What exists now

- **On the receipt after a sale,** under «Продаж записано»: «Сьогодні ви
  продали 5 шт.». Nowhere else: not on an empty till, not on «Продажу
  немає», not on a kept sale confirmed later.
- **Counted by the server** (`GET /sales/sold-today?store_id=`, in module
  `cash`, `cash.sold_today`), each time it is asked:
  - the store's business day, 06:00 to 06:00 in its zone, as the drawer's;
    a sale typed from paper counts on the day it was typed;
  - the caller's sales: on a sale typed from paper, whoever is named under
    «Хто продав», else whoever typed it;
  - the till's only: a collected order's sale is not one;
  - less every unit returned from those same sales, whoever took it back
    and wherever, by the day's end;
  - each store its own; only for someone who may sell there
    (`sale:create`); the units and the day, and nothing else.
- **A sale typed from paper for someone else** shows nothing, and asks the
  server nothing.
- **The line is kept while the figure is read,** so nothing on the receipt
  moves under the finger; if the server does not answer it stays empty, and
  the receipt is the same.

Nothing about money, stock or who may do what changes. No migration.

## Decided here, not by the owner

- **The module:** `cash`, which owns the drawer's 06:00 day and already
  reads sales, returns and orders; the report's module counts calendar days
  and may not read orders. No import contract changes.
- **A sale typed from paper counts on the day it was typed,** as in «Звіт»
  and the drawer, and as the till tells the seller («Він увійде в
  сьогоднішні продажі»), whatever day the paper says — the first days'
  paper of up to two weeks back too.
- **Every unit returned counts,** whether or not the goods came back.
- **Each store its own** for someone who sells in two.
- **Not on «Продажу немає» or a kept sale confirmed later:** neither is the
  receipt after a sale.

## How it was built and proven

- **The count, against real PostgreSQL** (`test_sold_today.py`, 9, signed
  in as the network's people):
  - a seller's units today less those returned, the manager taking one
    back; the answer the day and the units, nothing else;
  - only the caller's own: a colleague's sale and its return, and the
    owner's, each their own;
  - a sale typed from paper for the one named under «Хто продав», and for
    whoever typed it when nobody is;
  - a collected order not counted, a till sale after it counted;
  - each store its own, for the owner selling in two;
  - the day by the store's own clock: sales dated 03:00 and 07:00 on a day
    long past — 03:00 the evening before's, 07:00 the day's, which a day
    counted by UTC would miss — and the 06:00 boundary at chosen moments;
    a return today of a sale of that day changes neither;
  - only someone who may sell there reads it, a store not theirs refused
    before it is looked up; the path never taken for a sale's id.
- **The receipt** (`till-sold-today.spec.ts`, 5; the goods and the sale's
  answer stubbed, the count the real API's unless said):
  - after a sale, «Сьогодні ви продали N шт.» with the real server's N for
    the till's store, announced (`role="status"`);
  - the line kept while the figure is held back: «Новий продаж» does not
    move when it comes;
  - a figure refused (500) leaves the receipt as it is, and no alert;
  - a sale typed from paper for someone else shows nothing and asks
    nothing; naming nobody, or the seller, shows the seller's.
  - This journey caught a real defect on its first run: the till asked
    for `/api/v1/api/v1/sales/sold-today`, which the backend's tests could
    not see.
- **Mutation:** twenty ways of breaking it, one at a time, each against
  the tests or journeys meant to catch it, after the unchanged tree passed:
  all caught on the first run
  (`output/verification/2026-10-17-till-sold-today/`) — a paper sale for
  whoever typed it, everyone's sales, a collected order, no returns taken
  off, the day from midnight or by UTC, the store's returns of the day
  whoever's sale, a return after the day's end, another store's sales, the
  day never ending or the days before counted, anyone reading it, and on
  the receipt: no figure, the path doubled, no store, the paper's three
  cases, the line not kept, the figure not announced.

## Review

An independent review before the first commit found no blocker: the
count's queries, the right to read it and the receipt's condition right
against the owner's rules, the day right on the days the clock moves, and
nothing beyond the units and the day answered. It found the following, all
addressed before the first commit:
- **Three rules no test held:** a day counted by UTC, the store's returns
  of the day taken off whoever's sale they were, and a return after the
  day's end. Each has a test now — sales dated 03:00 and 07:00 by the
  store's clock, a colleague's return, a return today of a past day's sale
  — and a mutant that it catches.
- **The error journey** could pass before the server's refusal came; it
  waits for it now.
- **Smaller:** the right ADR section cited; a sale typed from paper
  counting on the day it was typed listed among what was decided here; a
  store not the caller's refused before it is looked up, pinned; two
  checks that could not fail dropped, one made to; the CSS rule and an
  ADR's line placed and wrapped right.

## Evidence

TODO

## Not covered here

- **On a real phone:** the receipt's line in Telegram's own web view, on
  Android and on iOS, is not tried on a device yet.
- **The hot path** has no budget for the new read, after each sale: the
  store looked up and two sums over its sales of the day, by the store's
  and day's index.
- **P2-5, P2-6; В9, В10;** and the bot's «6100,00 грн».
