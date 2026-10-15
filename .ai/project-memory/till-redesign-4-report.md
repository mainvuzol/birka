# The sections and the header; the till's reminder after an outage — 2026-10-16

Baseline: `e76e828` (the till's receipt and its small things, PR #92).
Status: TODO(final).
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
  - Either answers it, and so does the paper switch ticked on any screen;
    it is said again only after the server is lost and back once more, and
    never while the paper mode is on or the server does not answer. Its
    button waits, as the tick does, while a sale is on its way.
  - Only in the phone's memory: a reopened app says nothing until it sees
    an outage itself. The bot tells sellers nothing (owner, В7 (б)).

Nothing about money, stock, marks or who may do what changes.

## How it was built and proven

TODO(final)

## Review

TODO(final)

## Evidence

TODO(final)

## Not covered here

- **On a real phone:** the row at 360 px with the phone's own fonts, and a
  text size set larger than standard, are not seen on a device yet.
- **The design direction's bottom tabs** («Огляд», «Товар», «Клієнти») wait
  for those screens; the row stays at the top, as the task list has it.
- **The first days' paper mark (В2)** and the till's empty states (P1-5)
  are next in the task list's order, with P1-3, P1-4 and the P2 tasks.
