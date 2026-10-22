# «Каса»: the owner's and managers' correction by day and rows — 2026-10-23

Baseline: `ede5334` (#125, «Каса»'s words and places, on main `9160903`),
and «Каса»'s task list
([redesign/2026-10-21-redesign-tz-cash.md](redesign/2026-10-21-redesign-tz-cash.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-two of twenty-two ways of breaking it caught. The screen waits for
the owner's approval; not yet tried on a real phone. Stacked on #125.
Branch: `feat/cash-correct`, stacked on #125. Task: P2-4, and the server's
«Розмін». Owner: business-rules.md, "after #125 was opened" (2026-10-22).

## Why this was next

The owner approved #125's words, asked for «Розмін» from the server too,
and chose P2-4. The owner's and managers' correction asked for a day on a
native date field, then listed the day's money as quiet buttons of six
parts — «20:05 · Продаж: … · 700,00 грн · Картка (виправлено) · Оля» — one
that could not be changed said nothing of why, and a closed day's note
stood on a warning's plate.

## What exists now

- **The day as a switch:** «Сьогодні», «Вчора» — the drawer's days, 06:00
  to 06:00 — and «Інший день», the calendar only for it.
- **A row an operation:** «Продаж · 20:05 · Оля» and its sum beside it; the
  goods and the close it fell in the row's whole width under them, its way
  as a pill under the goods; one that may not be changed says «змінити не
  можна», as readable as any.
- **The close an operation fell in, named by the server** (`close_day`).
- **One chosen:** the card of P1-3, «Пояснить різницю закриття 22.10» a line
  under it. Today's operation in five taps, yesterday's in six. A refusal
  goes with another day.
- **«Розмін» from the server** where cash put in explains a close.

What is sent and the money are unchanged; no migration. The server's
changes are read-only: a word made when read, and a day it already had.

## Decided here, not by the owner

- **The screen,** from the task list: to be approved from the
  [screenshots](../../output/verification/2026-10-23-cash-correct/screens/).
- **«Сьогодні» and «Вчора» are the drawer's days by the phone's clock**
  (G8), as the server reads them: at 00:30 «Сьогодні» is the evening just
  worked. The date field before opened on the calendar's day, which before
  06:00 read a day not yet begun.
- **The way under the goods, the sum beside the title,** where the task list
  put both on the right: at 360 px a collected order's «Накладений платіж ·
  виправлено» there left the goods a word a line. As «Закриття»'s pill.
- **The server names the close an operation fell in,** where the task list
  said no backend: the phone named it from the last ten closes it had read,
  and for a day further back named the wrong one — on the card before this
  change too.
- **«Інший день» reads nothing until a day is chosen,** where the date field
  opened on today before.

## How it was built and proven

- **`cash-correct.spec.ts` (new, stubbed, the owner), 8 journeys:**
  - at 360×640: «Сьогодні» chosen and no calendar; «Вчора» reads
    yesterday's drawer day; a row «Продаж · 18:40 · Оля», «Пальто Ірис · L
    · закриття 22.10», «700,00 грн», «Картка · виправлено»; a closed return
    still to be changed; chosen, «Пояснить різницю закриття 22.10» under
    the card and no plate; changed — the body as before, «… Пояснює
    різницю закриття 22.10.», six taps;
  - today's operation changed in five taps;
  - «Інший день»: «Оберіть день.», nothing read until a day is typed; a
    day twenty back names its own close on the row and the card, though
    the phone has read only yesterday's;
  - a refusal said over that day's list, gone when another day is typed;
  - an operation from before the drawer was first counted: «… · змінити не
    можна», not to be pressed, not faded, its words at 4.5:1;
  - at 00:30 «Сьогодні» reads the evening before, «Вчора» the day before
    that, the calendar's latest day the evening before;
  - both themes: the switch, a row's title, goods, sum and pill at 4.5:1;
    each row — a collected order's «Накладений платіж · виправлено», goods
    of two lines, a Telegram name of one long word — its sum beside the
    title and inside the row, the goods the row's width, the pill under
    them and inside it; nothing wider than the phone; full-page
    screenshots.
- **`test_cash_corrections.py`:** a closed sale names the business day of
  the close that ended its period; an open one, none.
- **`test_cash_movements.py`:** cash put in for change, recorded after
  another phone's close it came before, explains that close as «Розмін: з
  банку».
- **`outside-text.spec.ts`:** a day's hidden characters on the owner's
  correction, the day now chosen with «Інший день».
- **Related journeys:** 369 — «Каса» and every screen of it, the
  receipt, the report, debts, returns, the outage and its paper, failures,
  outside text, the till, its places and its sections — passed with it.
- **Mutation:** 22 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 22 caught
  ([`mutants.txt`](../../output/verification/2026-10-23-cash-correct/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that what is sent is unchanged, the taps counted, the switch a
named group of radios as «Повернення»'s, the day and the choice kept
across «Інша операція» and a refusal, the server's «Розмін» used only in
what explains a close and no test holding the old words, and the
wording. It found, all addressed before the first commit:
- **«Сьогодні» the calendar's day** where the server reads the drawer's,
  06:00 to 06:00 (G8): at 00:30 it read a day not yet begun, and the
  evening just worked stood under «Вчора». Now the drawer's day, as
  `drawerDay` is.
- **A row's close named wrongly for an older day:** the phone took the
  first close after the operation among the last ten it had read. Now the
  server's `close_day`; the card's line too.
- **The row at 360 px** with an order's way: the pill beside the sum left
  the goods a word a line, and one long name ran under the sum. Now the
  sum beside the title, the goods and the pill under them, long words
  broken.
- **An unchangeable row at 2:1** — the browser's faded disabled button —
  and a stub that could not happen (a closed return, which the owner may
  change). Now not faded, its title and sum muted, and the stub an
  operation from before the drawer was first counted.
- **Smaller:** a refusal kept over another typed day; the "nothing read"
  check racing a read; «Внесено в касу (розмін)» left in the README, the
  glossary and ADR-0012.

## Evidence

- [`output/verification/2026-10-23-cash-correct/`](../../output/verification/2026-10-23-cash-correct/):
  `mutants.py`, `mutants.txt`, and `screens/` — the day's rows, light and
  dark.
- **CI, run locally at `09162ff`**
  ([summary](../../output/verification/2026-10-23-cash-correct-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 463 on PostgreSQL 17;
  - e2e: 551 journeys;
  - hot path: worst p95 95.1 ms (the search by six sellers) and 74.3 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the calendar «Інший день» opens, Telegram's own;
  the phone's clock in another time zone than the store's (as everywhere
  «Каса» uses the drawer's day by the phone).
- **Left:** «Каса»'s P2-5 («Каса» at the bottom, with the bottom menu).
