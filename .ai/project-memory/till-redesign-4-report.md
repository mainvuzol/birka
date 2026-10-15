# The sections and the header; the till's reminder after an outage — 2026-10-16

Baseline: `e76e828` (the till's receipt and its small things, PR #92).
Status: built, reviewed and proven: the whole CI run locally passed, and
thirty-one of thirty-one ways of breaking it caught. Not yet seen on a real
phone.
Branch: `feat/till-sections`. Tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P1-6, P1-7. Owner: business-rules.md, "the sections and the header; the
till's reminder after an outage" (2026-10-15).

## Why this was next

After PR #92 a coat sold in three taps and the receipt read as tags, but
above the till stood up to seventeen buttons of sections — ten for a
seller — wrapping over several rows, «Замовлення» first and «+ Нове
замовлення» third, under a header «РОБОЧЕ МІСЦЕ ПРОДАВЦЯ / Бірка / магазин»
and a second line with the store. The till began below all of that. And
when the server answered again after an outage, the till said nothing: the
owner and the administrator heard it from the bot, the seller who had
written on paper did not, and paper not typed before the drawer closes
reads as a surplus and a shortage. The owner chose these next on
2026-10-15, kept the paper return from a receipt as built, and answered В7:
the bot does not tell sellers; the till does.

## What exists now

- **One row of the counter's work** (P1-6): «Продаж», «Повернення»,
  «Борги», «Каса», each for whoever may do it, and «Ще».
  - «Ще» opens every other section beneath the row, each shown by the same
    right and held by the same rule as before (`blocked`, `otherThan*`);
    any section is two taps away. A section chosen closes it, the focus
    staying on «Ще»; so does the app turning to another section by itself
    (the receipt's «Оформити повернення»), since «Ще» is open only on the
    section it was opened on. Coming back to that section does not open it
    again.
  - The section open is always told: its button is marked (`aria-current`),
    «Ще» is marked when the section is one of its own (`aria-current`, and
    its colour), and every screen has its own heading.
  - «Ще ⚠» when the backups or the server need the owner, as «Резервні
    копії ⚠» beneath it.
  - At 360 px the row is one line of 48 px targets, no label cut: four of
    the counter's and «Ще» for a seller, «Ще ⚠» for the owner with about
    6 px to spare. Narrower, a label is cut short rather than push the page
    sideways.
  - Whoever does none of the counter's work has «Ще» alone.
- **The header is one line** (P1-6): «Центр · Ліда», the store and who
  works in it, with «Змінити магазин» beside it for whoever has two or more
  stores, held while an operation's outcome is unknown, as before. «РОБОЧЕ
  МІСЦЕ ПРОДАВЦЯ» is gone; «Бірка» stays on the screens before a store
  opens, on the crash screen and in the title. A store that does not trade
  shows the same line over its state.
- **The till's reminder** (P1-7): once this phone has seen the server lost
  (no answer, a timeout, a 502, 503 or 504) and then any answer of its own,
  the till says «Сервер знову відповідає: продажі з паперу можна вносити.
  Внесіть їх до закриття каси.», with «Вношу продаж з паперу», which ticks
  the same switch as the tick, and «Пізніше».
  - Either answers it, and so does the paper switch ticked on any screen,
    or the server coming back while the paper mode is on: the paper is
    being typed, and nothing is said once the switch is unticked. It is
    said again only after the server is lost and back once more, and never
    while the server does not answer. Its button waits, as the tick does,
    while a sale is on its way.
  - Only in the phone's memory: a reopened app says nothing until it sees
    an outage itself. The bot tells sellers nothing (owner, В7 (б)).

Nothing about money, stock, marks or who may do what changes.

## How it was built and proven

- **Journeys** (`till-sections.spec.ts`, 8):
  - a seller's row at 360 px: the four and «Ще», one line, no label cut,
    no sideways scroll, under «Центр · Ліда» with no «Змінити магазин»;
    «Ще» holding exactly the seller's six; two taps to «Залишки», «Ще»
    closing on it with the focus kept and marked as the section's own;
    «Ще» never opening again on the till, nor on a section pressed again;
  - whoever does none of the counter's work: «Ще» alone, holding only what
    they may open;
  - the owner's row at 360 px, «Ще ⚠» included, and «Ще» holding the
    owner's sections;
  - the reminder: said once the server is back, its button ticking the
    switch, nothing after the switch is unticked; «Пізніше» putting it
    away until the next outage, nothing said while the server is lost
    again, the tick answering it; its button waiting while a sale is on
    its way; a server back while the paper is typed asking for nothing;
    a phone that never lost the server never reminded.
- **Every journey opens sections as a person does** (`fixtures.ts`:
  `section`, `more`, `sections`), and each one that says a section is
  absent or held opens «Ще» first. The kept-command journeys of
  «Постачальникам», «Накладні», «Моделі» and «Магазини» see their own
  section open and «Залишки» held; «Замовлення» pressed on an order leads
  back to the list; the receipt's «Оформити повернення» closes «Ще»; the
  backups and the server's trouble mark «Ще ⚠» and «Резервні копії ⚠».
- **Seen at 360 px** in light and dark: the row, «Ще» open, the reminder,
  and the owner's «Ще ⚠» (screenshots taken locally, not kept).
- **Mutation:** thirty-one ways of breaking it, one at a time, each against
  the journeys meant to catch it on a fresh seed, after the unchanged tree
  passed: all caught (`output/verification/2026-10-16-till-sections/`).
  - A first run caught 25 of 28. Three survived, and a journey now closes
    each: a section with a rule of its own held like every other while its
    own command is kept; «Замовлення» leaving an order open; and the
    reminder's guard against the paper mode, which nothing could reach.
    That guard became a rule: the server back while the paper is typed
    answers the reminder.
  - The three other sections with rules of their own («Накладні»,
    «Моделі», «Магазини») were added to the second run.
  - The backups journey that counts nights fails on the shared E2E
    database, which keeps every run's nights, unchanged as with each
    mutant; it is left out of the verdicts, and passes in CI's fresh one.

## Review

An independent review of the change before its first commit found no
blocker and every section's right and rule the same as before, and the
following, all addressed in `bdda1c6`:
- **«Ще» opened again by itself** on the section it was opened on, coming
  back to it, its menu over the till: a section chosen now forgets it.
- **The check that the reminder goes while the server is lost again could
  not fail:** it ran after «Пізніше» had put it away. It now runs first.
- **The focus fell to the page** when the chosen button went with «Ще»: it
  stays on «Ще», which now says when the section open is its own.
- **The openings' «Рядки списку» filter spread out** on wide screens, by
  the narrowed rule: restored.
- **A row that cannot shrink** pushed the page sideways on a narrower
  screen: a label is cut short instead, and the journeys check none is cut
  at 360 px.
- **Nothing checked «Резервні копії ⚠» for the server's trouble**, nor the
  reminder's button while a sale is on its way: both are journeys now.

## Evidence

- [`output/verification/2026-10-16-till-sections/`](../../output/verification/2026-10-16-till-sections/):
  `mutants.py` and `mutants.txt`, thirty-one ways of breaking it, all
  caught.
- **CI, run locally at `1768c58`** ([summary](../../output/verification/2026-10-16-till-sections-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 420 on PostgreSQL 17;
  - e2e: 322 journeys, the backups one among them on CI's fresh database;
  - hot path: worst p95 91.9 ms (the search by six sellers) and 70.0 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.
- **A first full run of the journeys was lost, not failed by this change:**
  the test web server (Vite) stopped answering about two thirds through,
  at full CPU, and every journey after it timed out signing in. Stopped,
  and run again: 320 of 321 passed, the backups journey that counts the
  shared database's nights the one left, as before this change.

## Not covered here

- **On a real phone:** the row at 360 px with the phone's own fonts, and a
  text size set larger than standard, are not seen on a device yet.
- **The design direction's bottom tabs** («Огляд», «Товар», «Клієнти») wait
  for those screens; the row stays at the top, as the task list has it.
- **The first days' paper mark (В2)** and the till's empty states (P1-5)
  are next in the task list's order, with P1-3, P1-4 and the P2 tasks.
