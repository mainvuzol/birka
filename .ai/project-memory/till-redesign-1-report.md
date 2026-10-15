# The till in the new design, first part — 2026-10-15

Baseline: `cacfae1` (the approved redesign direction, PR #89).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-three of twenty-three ways of breaking it caught. Not yet seen on a
real phone.
Branch: `feat/till-redesign`. Direction:
[design-direction.md](redesign/design-direction.md) (approved 2026-10-11);
tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P0-1, P0-4, P0-5, P0-6. Owner: business-rules.md, "the till in the new
design, first part" (2026-10-14).

## Why this was next

After PR #87 the owner approved a redesign direction for the whole app and
had a task list written for the till: a sale took five or six taps, with no
search, the total and the three ways at the end of a long form, warnings
unreadable in Telegram's dark theme, and a part-payment receipt that showed
the whole sum for the terminal. On 2026-10-14 the owner chose the till
first, and answered three of the list's questions (В1, В3, В6).

The list's order is kept: this first part takes the tasks that need no
server change (P0-1, P0-4, P0-5, P0-6); the second takes the search (P0-2,
with its server change) and one tap of a size into the basket (P0-3).

## What exists now

- **P0-1, the app opens on the till.** One store opens without the choice,
  and without «Змінити магазин»; with two or more the person chooses each
  time, nothing chosen beforehand and nothing remembered (owner, В6), and the
  choice says «Продажі запишуться на той магазин, у якому ви зараз.» The
  first tab is
  «Продаж» for whoever may sell in a store that trades, else «Замовлення».
  A kept operation still opens its own tab; a kept order now opens
  «Замовлення» itself, which the default no longer did.
- **P0-5, the direction's palette, light and dark.** Every colour of the
  stylesheet is a token (`--bg`, `--surface`, `--text`, `--accent`,
  `--warn`, `--debt`…), with the direction's values; the theme is taken
  from Telegram's background by Telegram's own rule (`isColorDark`), set
  before the first paint (`data-theme`), or from the device outside
  Telegram. Telegram's own colours are no longer painted: its dark theme
  drew light text on the light notices. Departures, chosen here: the dark
  backgrounds of the meaning colours, tokens the direction does not name
  (edges, focus, shadows), and a light theme that changes visibly.
- **P0-4, under the thumb.** Once the basket holds something (direction
  §5), a panel held at the bottom of the screen with the safe area says
  what is sold («Лоран шоколад · M», or «У кошику: 3 од.»), «Разом» with
  «,00 грн» smaller and quieter, and «Готівка / Картка / Переказ» in one
  row, 54 px; with «Оплата частинами» it reads «Зараз … · винен …», from
  what was typed. In paper mode the buttons say «З паперу · …» and the
  seller line stays on the panel. The panel's height is kept clear wherever
  the page scrolls (`scroll-padding-bottom`). The server's shortage answer
  opens above it, scrolled into view and focused, and its basket line is
  marked. A seller who may correct a shortage but not write a shelf off is
  told «Немає на полиці? Приберіть рядок і попросіть менеджера виправити
  залишок.»; «Прибрати з кошика» replaces «Прибрати цей рядок із кошика».
  Whatever holds the other tabs holds the till too, now that it opens
  first.
- **P0-6, a sale paid in parts.** Its receipt leads with what is paid now
  and how — «Картка · Проведіть на терміналі 1000,00 грн», «Готівка · Зараз
  …», «Переказ · Зараз … — перевірте, що переказ надійшов…», and from paper
  «… — оплату провели під час збою, на терміналі не проводьте ще раз» —
  then «Разом за товар», «Сплачено зараз», «Покупець винен». Sums are the
  server's.

Nothing about money, stock or who may do what changes; the server does not
change.

## How it was built and proven

- **Journeys** (`till-redesign.spec.ts`, 11; `credits.spec.ts`, 4 new; `orders.spec.ts`, 1 new):
  - one store opens on the till, with nothing to change to; two are chosen,
    and chosen again when the app is opened again; whoever does not sell
    opens on the orders; a single store that does not trade shows its
    state;
  - no panel on an empty basket; on a 360 × 640 phone what is sold, the
    total and the three ways are in view, below the basket's last line,
    with no sideways scroll; paid in parts the panel says what is paid now
    and left;
  - the shortage answer is in view and focused, wholly above the panel,
    its line marked, and a seller without the right to write a shelf off is
    told what to do;
  - an invoice operation kept on the phone that cannot be read holds the
    till, which now opens first, as it holds every other tab;
  - an order kept on the phone whose own check on reopening loses its
    answer again opens on «Замовлення», not on the till, and is settled by
    the same command;
  - in Telegram's dark theme and in a light one, the paper band, the hint,
    the kept sale's banner and an alert read at 4.5:1 or more; in the dark
    one the shortage answer and a paper sale's mark too;
  - a part payment by card, cash and transfer leads with the 1000 paid
    now, never «Проведіть на терміналі 3000»; from paper, never to charge
    the card again.
- **Every other journey** was brought to the new opening: people with one
  store open straight, so `openStore()` (`e2e/fixtures.ts`) presses a
  store's button only where the choice shows, and then checks that store
  opened (120 places); journeys about
  the choice itself, or about leaving a store, give their person a second
  store; orders journeys open «Замовлення».
- **Mutation:** twenty-three ways of breaking it, one at a time, all
  caught, each by the journey meant to catch it. The unchanged tree runs
  first and must pass, and the database is reseeded before every run.
  - A first run was void: seeded once, the orders journeys ran out of
    stock from the eighth mutant on, so every later catch was that.
  - It left one survivor: a kept order that the phone cannot settle on
    reopening left the person on the till, as the journey's own check
    always settled it. A journey now closes it.

## Review

An independent review of `3101c32` found the following, all addressed in
`ee5b97f`:
- **The shortage answer could open under the panel,** its «Прибрати з
  кошика» covered. The panel's measured height is kept clear wherever the
  page scrolls, and a journey checks the answer lies wholly above it.
- **The till was not held by every unsettled journal** that held the
  other tabs: the store states', suppliers', invoices' and corrections'.
  It is now, and a journey proves it for an unreadable kept invoice.
- **The dark theme was read by a brightness rule of its own.** It is now
  Telegram's own `isColorDark`, applied before the first paint.
- **В6 was not tested on reopening,** and `openStore()` did not check
  which store opened. Both are now.
- **Undeclared departures from the direction:** the panel on an empty
  basket and without what is sold (direction §5), the cents as large as
  the whole, invented tokens and hard-coded shadows, a focus colour too
  light. Each is now the direction's or named as a departure.
- **Docs:** the owner's answers worded as the recommended option, contrast
  claims limited to what is measured, the seller's text made
  gender-neutral.

## Evidence

- [`output/verification/2026-10-15-till-redesign-1/`](../../output/verification/2026-10-15-till-redesign-1/):
  `mutants.py` and `mutants.txt`, twenty-three ways of breaking it, all
  caught.
- **CI, run locally at `4594f2e`** ([summary](../../output/verification/2026-10-15-till-redesign-1-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 400 on PostgreSQL 17;
  - e2e: 294 journeys;
  - hot path: worst p95 67.1 ms (catalogue read) and 109.7 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **P0-2 and P0-3** — the search and one tap of a size into the basket —
  are the second part; the till's taps are recounted with them.
- **On a real phone:** the keyboard over a price field and the iPhone's
  safe area are not seen on a device yet.
- **В1 and В3** are decided and recorded, not built.
- **The other screens** take the palette, nothing more; their layout is the
  direction's stage 2.
