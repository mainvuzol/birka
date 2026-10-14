# The till in the new design, first part — 2026-10-15

Baseline: `cacfae1` (the approved redesign direction, PR #89).
Status: TODO(final).
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
  time, nothing chosen beforehand (owner, В6), and the choice says «Оберіть
  магазин, у якому ви зараз: продажі запишуться на нього.» The first tab is
  «Продаж» for whoever may sell in a store that trades, else «Замовлення».
  A kept operation still opens its own tab; a kept order now opens
  «Замовлення» itself, which the default no longer did.
- **P0-5, the direction's palette, light and dark.** Every colour of the
  stylesheet is a token (`--bg`, `--surface`, `--text`, `--accent`,
  `--warn`, `--debt`…), with the direction's values; the theme is taken
  from the brightness of Telegram's background (`data-theme`), or from the
  device outside Telegram. Telegram's own colours are no longer painted:
  its dark theme drew light text on the light notices. The dark backgrounds
  of the meaning colours are chosen here (a departure from the direction).
- **P0-4, under the thumb.** «Разом» and «Готівка / Картка / Переказ» are
  a panel held at the bottom of the screen with the safe area, the three in
  one row; with «Оплата частинами» it reads «Зараз … · винен …», from what
  was typed. In paper mode the buttons say «З паперу · …» and the seller
  line stays on the panel. The server's shortage answer opens above it,
  scrolled into view and focused, and its basket line is marked. A seller
  who may correct a shortage but not write a shelf off is told «Немає на
  полиці? Приберіть рядок і скажіть менеджеру — залишок виправить він.»;
  «Прибрати з кошика» replaces «Прибрати цей рядок із кошика».
- **P0-6, a sale paid in parts.** Its receipt leads with what is paid now
  and how — «Картка · Проведіть на терміналі 1000,00 грн», «Готівка · Зараз
  …», «Переказ · Зараз … — перевірте, що переказ надійшов…», and from paper
  «… — оплату провели під час збою, на терміналі не проводьте ще раз» —
  then «Разом за товар», «Сплачено зараз», «Покупець винен». Sums are the
  server's.

Nothing about money, stock or who may do what changes; the server does not
change.

## How it was built and proven

- **Journeys** (`till-redesign.spec.ts`, 9; `credits.spec.ts`, 4 new):
  - one store opens on the till, with nothing to change to; two are chosen
    each time; whoever does not sell opens on the orders; a single store
    that does not trade shows its state;
  - on a 360 × 640 phone the total and the three ways are in view, below
    the basket's last line, with no sideways scroll; paid in parts the
    panel says what is paid now and left;
  - the shortage answer is in view and focused, its line marked, and a
    seller without the right to write a shelf off is told what to do;
  - in Telegram's dark theme and in a light one, the paper band, the hint,
    the kept sale's banner and an alert read at 4.5:1 or more;
  - a part payment by card, cash and transfer leads with the 1000 paid
    now, never «Проведіть на терміналі 3000»; from paper, never to charge
    the card again.
- **Every other journey** was brought to the new opening: people with one
  store open straight, so `openStore()` (`e2e/fixtures.ts`) presses a
  store's button only where the choice shows (120 places); journeys about
  the choice itself, or about leaving a store, give their person a second
  store; orders journeys open «Замовлення».
- **Mutation:** TODO(final).

## Review

TODO(final).

## Evidence

TODO(final).

## Not covered here

- **P0-2 and P0-3** — the search and one tap of a size into the basket —
  are the second part; the till's taps are recounted with them.
- **On a real phone:** the keyboard over a price field and the iPhone's
  safe area are not seen on a device yet.
- **В1 and В3** are decided and recorded, not built.
- **The other screens** take the palette, nothing more; their layout is the
  direction's stage 2.
