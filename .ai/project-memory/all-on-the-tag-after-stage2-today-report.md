# «Усе на бірці», after stage 2's audit, batch 2: «Сьогодні» names both stores; a list's row by §6.8; «←» unread in orders; «Прибув на пошту»'s ring — 2026-11-09

Baseline: `0f03f41e` (the audit's first batch, PR #183, merged), and four
tasks of the audit after stage 2:
- [frame P0-2](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  «Сьогодні»: two answers at one glance;
- [frame P2-2](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) — a
  list's row by spec §6.8;
- [frame P2-3](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  «←» in orders never read aloud;
- [orders-cash P2-5](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md)
  — «Прибув на пошту» on its row: the ring on the pressed verb while its
  send is on its way.

Status: built; proof below — 1010 of 1011 journeys on a fresh seed, the one the known Mac-only failure. 66 of 66 mutants caught. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-today`. Task: the audit's second batch, chosen in
chat after #183 was merged (2026-11-09, «Yes, start batch 2»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-09 (audit after stage
2, batch 2: …)". The owner's open question В-К1 (the 700 px fold): built
by its (б), «if no».

Where it stood:
- «Сьогодні»'s folded line under 700 px named no store: «Сьогодні досі ·
  12 050,00 грн · 6 шт.»;
- the day-tag with «Центр + Ринок» at 390 × 741: 366 px, each store's sum
  and units in one row, the tag's padding 26 16 12 and 2 px of its own
  between its rows;
- a list's row 56 high with sides of 4, a separator the whole width, no
  pressed look; 64 only in «Ще» and «Повернення»; the chevron the text «›»
  at 24 in twelve places;
- «← До замовлень» and «← Замовлення» read aloud with their arrow in five
  places of orders;
- «Прибув на пошту» on a row: every verb greyed alike while its send was
  on its way, no ring on the one pressed.

## What exists now

- **«Сьогодні» folded** (under 700 px of Telegram's steady height): with
  two stores, «Сьогодні досі · 12 050,00 грн · «Центр» 6 950,00 грн ·
  «Ринок» 5 100,00 грн» — the report's day, then each store's, every sum
  a field the server answered; it breaks between its parts only. One
  store, three and more, or a store the report has no figures for: the
  sum and its units, as before.
- **The day-tag** at 390 × 741: a store's «N шт.» in its name's row on
  the right, in `meta`; its sum alone on its line; the tag's padding 28 16
  16 by §6.10, nothing of its own between its rows. 366 → 350 px. The
  same height in the dark theme.
- **A list's row**, one rule for every list (§6.8): 64 high at least; its
  title 17/600 in ink, its meta 14/500 in pencil; pressed, the fold under
  it; taking no tap, its title in pencil with nothing faded over it; its
  chevron the set's 16 in pencil. On a list's white block, its sides 16, a
  hairline under it from its text's edge (68 past a customer's two
  letters), none under its block's last.
- **On a white block now:** «Покупці»'s lists, those found in another
  store, the till's list of one customer's debts, «Повернення»'s rows a
  block a day under the day's heading, and their places while read. A
  store's debts on the customer's card lie on that block's own white.
- **The chevron** the set's 16 in the twelve places the audit named:
  «Ще», «Гроші» (its rows and a place's), «Повернення», «Покупці» and a
  customer's debts, the till's debts, «Внесок»'s sheet, the till's tray
  and its paper's series, a debt's «Історія», «Зроблено сьогодні». The
  orders' and «Каса»'s text «›» stays, 24, for their own task.
- **«←»** drawn, never read, in the five places of orders: «До замовлень»
  and «Замовлення» are the buttons' names.
- **«Прибув на пошту» on its way:** the pressed verb turns the eyelet's
  ring before its words in its colour, the others held as before;
  answered, it keeps its ring and takes no tap until the list is read
  again, then the toast, the row in its place, one `success` buzz.

## Decided here, not by the owner

All in business-rules.md under the heading above. In short:
- **The folded line with two stores** names each with its own sum after
  the day's; with a store the report lacks, the line as before — never a
  sum made on the phone.
- **The day-tag's levers, measured** (390 × 741, light, «Центр + Ринок»,
  the e2e day, this Mac's font): (1) a store's units in its name's row —
  366 → 350; (2) the drawer's and «Винні …» lines on one line — nothing
  to gain: the drawer's already is, «Винні 8 400,00 грн · 4 людини» does
  not fit a column of 154; (3) the padding 28 16 16 and no gaps of its own
  — 350 → 350.
- **Not met: two work tags over the menu** (P0-2's first criterion). With
  the tag at 350 the first work tag ends 41 px under the menu's top, the
  second's title some 83 px. By В-К1 (б) the fold stays at 700 px; the
  screenshot below.
- **The debts to pay into in «Внесок»'s sheet** are not on a block: a
  sheet is already the card's white.
- **Lists still on the paper** keep the row's rule there (sides 4, the
  hairline whole): «Каса», «Закриття», «Замовлення»'s lists, suppliers',
  the report's, the search's results — their sections' tasks.

## How it was built and proven

- **Files:**
  - `frontend/src/today/Today.tsx`: the folded line's parts; a store's
    units in its name's row; the done link's chevron;
  - `frontend/src/styles.css`: the day-tag's padding and rows; the list's
    row (64, the title, the meta, pressed, taking no tap, the chevron);
    the list's block's sides and hairline, 68 past two letters; the
    customer's card's debts on its own white; the text «›» left at 24; the
    paper's series' glyph; «Повернути постачальнику»'s rows 64;
  - `frontend/src/orders/Orders.tsx`: the pressed verb, its ring, held
    till the list is read again; «←» hidden;
  - `frontend/src/orders/Order.tsx`, `NewOrder.tsx`, `Returned.tsx`,
    `frontend/src/App.tsx`: «←» hidden;
  - `frontend/src/returns/Returns.tsx`, `SaleRow.tsx`: a day's rows on a
    block, keyed by its date;
  - `frontend/src/shared/Placeholder.tsx`: the places on a block, where
    their list is;
  - `frontend/src/credits/Credits.tsx`, `Customer.tsx`, `CustomerRow.tsx`,
    `Debts.tsx`, `Debt.tsx`: the lists on blocks, the chevrons;
  - `frontend/src/money/Money.tsx`, `frontend/src/shared/More.tsx`,
    `frontend/src/sales/Sale.tsx`, `frontend/src/sales/paperMark.tsx`: the
    chevrons.
  - No backend change.
- **Journeys:** 1011 in all, 1008 before.
  - `e2e/today.spec.ts`, 2 new, 9 changed — at 390 × 741 in both themes,
    in the app's own face: the tag's padding, its rows' margins, a
    store's units beside its name in pencil, its sum on one line under
    them, the tag whole over the menu, the same height; under 700 px the
    line naming both stores, each part a line high, broken between them;
    the report's own sum where it is more than the stores', the old line
    where a store has no figures; one store and three as before;
    «Зроблено сьогодні»'s chevron.
  - `e2e/orders-list.spec.ts`, 1 new — «Прибув на пошту» held: the ring
    on the pressed verb alone in its colour, not faded, the other held;
    answered and its list's read held, the ring stays and a forced tap
    sends nothing; then the toast, its place, one buzz.
  - `e2e/fixtures.ts`: `listRow` — a row by §6.8 on its block: 64, sides
    16, the hairline at 16 or 68, none under the last, the title 17/600
    ink, the chevron the set's 16 pencil, no «›», the fold when pressed,
    nothing opened when let go elsewhere; `expectSeries` — the series'
    chevron pencil whatever is said.
  - `listRow` on «Ще»'s first and last rows (`design-system`), «Гроші»'s
    first row, one line (`money`), «Покупці»'s row with two letters
    (`credits-list`), her card's row and her debts (`credits-debt`), the
    till's debts of one phone (`credits`), «Повернення»'s row in both
    themes (`returns-list`).
  - Changed: the customer's card's debts the card's width
    (`credits-debt`); «Хто винен» elsewhere on a block (`credits-debt`);
    «Внесок»'s sheet's chevrons and no block (`credits`); «Ще»'s row held
    — its label pencil, not faded (`outage`); a debt's «Історія» chevron
    turned down (`outage-mark-debts-returns`); the tray's chevron
    (`till-cells`); «Гроші»'s rows and a place's chevron (`money`); the
    order's tray «›» at 24 (`orders-new`); the places on a block
    (`returns-list`; `credits-list` — the store's, «Сплачені»'s, and the
    closed stores', their read held); «Повернення»'s day heading 8 over
    its block (`returns-list`); «←» never in a button's name
    (`telegram-back`; the back buttons named exactly in `orders-card`,
    `orders-list`, `orders-new`, `today-search`, `till-sections`); a
    row's glyph apart from its chevron (`more-lines`, `today`).

## The independent review

An independent reviewer read the diff against `origin/main` with the four
tasks, §6.8 and §6.10, the decisions and the journeys; it ran the type
check and the linter. No blocker. Settled in the code or the journeys,
each a person sees in business-rules.md («Settled in the review»):
- **A block in a block:** the customer's card's debts were put on a list's
  white block inside the store's white block — two outlines, 26 px of a
  row lost at 360. Now on the store's block itself; a journey measures the
  rows the card's width.
- **The hairline under a customer's two letters** ran from 16; §6.8 says
  68. Now 68, measured on a row that is not its block's last.
- **«Прибув на пошту» answered:** the run lets go before the list is read
  again; the ring went on spinning on a verb that took a tap, and a second
  tap would have sent a second write. Now held till the list comes; the
  journey holds that read.
- **A row taking no tap faded twice:** its title pencil under the
  buttons' 45 %, about 2:1. Now its title pencil alone; a held «Ще» row
  is measured.
- **The text «›» left to orders and «Каса»** lost its 24; now 24 as before
  (measured on the order's tray). **The paper's series' chevron** took
  its glyph's ink, or the warning's colour while unsaid; now pencil.
- **The journeys:** the check that the folded line breaks between its
  parts could not fail (a part's one box whatever its lines) — now each
  part a line high and the last under the first; the day's sum was never
  shown to be the report's own (the fixtures' total was the stores' sum)
  — now a report whose day is more; the colour test missed the fade —
  now its opacity; the tag's measures hang on the display face, which
  can come too late — now in the app's face, checked drawn.
- **«Повернення»'s days** keyed by their date, not their first sale.
  **«Повернути постачальнику»'s model rows** 64, not their own 56.
- Seen and left: a pressed row still on the paper turns the fold, barely
  seen in the light theme (those lists' tasks put them on a block); a
  customer's two letters, the fold's colour, are lost in a pressed row; a
  store's column reads its units before its sum, as the task draws it.

## Mutants

`~/.cache/birka-runtime/helpers/mutate32.py`: 66 mutants, each undoing
one thing this batch made — 58 of the four tasks, 8 of the review's
fixes. `mutants32.sh` ran each against the journeys that should catch it,
on a fresh seed each, one failure ending the run.
- **The four tasks:** the folded line (two stores, three, one, a store
  the report lacks, the sums added on the phone, the quotes, the day's
  sum, its parts); the day-tag (the units in the name's row, its row's
  flex, the units' pencil, the padding, the money line's margin, the
  parcels' margin, the done link's chevron); the ring (pressed, the
  others pressed, the ring, the class, its end, its start); «←» in each
  of the five places; the row (64, pressed, taking no tap, its title,
  its meta, «Покупці»'s name, «Ще»'s label, the chevron's colour, «Ще»'s
  chevron, the sides, the hairline's 16, the last one wrapped or not, a
  day's heading); the chevron in eleven places; the blocks (a day's rows,
  «Покупці», another store's, the till's debts, the customer's, the
  places).
- **The review's:** taking no tap not faded; the 68; the card's debts
  flush; the text «›» at 24; the paper's series' chevron; the pressed
  verb held till the list comes; the closed stores' places on a block,
  and the store's.
- **63 caught in the first pass**, each at an assertion about what it
  changes.
- **Two survived,** and the journeys were tightened for them:
  - `rowmin` — a row's 64 back to 56: every row measured had two lines,
    64 without it. Now «Гроші»'s first row, one line, is measured.
  - `creditswait` — the closed stores' places off their block: no journey
    held their read. Now `credits-list` holds it and looks.
  - Run again with a new one for the store's own places (`blockwait`):
    **all three caught — 66 of 66.**
- Logs: `go-mutants32.log`, `go-mutants32-tight.log`,
  `go-mutants32-tight2.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean. Prettier is clean on the files that were clean at the
  baseline, and on every hunk of this batch in the files that were not
  (`App.tsx`, `Credits.tsx`, `Debt.tsx`, `Returned.tsx`, `Returns.tsx`,
  `Sale.tsx`, `More.tsx`, `styles.css`, `Today.tsx`, `fixtures.ts`,
  `today.spec.ts`, `credits-debt.spec.ts`, `outage.spec.ts`,
  `telegram-back.spec.ts`, `till-sections.spec.ts`).
- **Every journey,** on a fresh seed, one worker: 1010 of 1011 in 27.1
  minutes — `go-b2-full.log`. The one: `backups.spec.ts:93`, «the owner is
  shown last night's failed copy…» — this Mac's backups' history (14
  nights where it waits for 3), failing alike on the last baselines;
  GitHub's run is the proof. `till-sections`' eight journeys of Ліда at
  «Центр», which fail when that spec runs alone, passed in the full run.
- **The affected specs while building,** each on a fresh seed:
  - `credits-debt`, `design-system`, `orders-card`, `today`, `more-lines`,
    `first-sign-in`, `cash-polish`, `till-placeholders` — 169 of 169,
    `b2-run2.txt`;
  - `today`, `returns-list`, `credits-list`, `credits-debt`,
    `design-system` — 131 of 131, `b2-run3.txt`;
  - after the review's fixes, the thirteen specs they touch — 375 of 376,
    `b2-run4.txt`: the one, the new journey of the report's own sums,
    opened the same launch link twice, which does not reload the app; it
    goes to a blank page between, and passed.
- **Screenshots** (`frontend/test-results/`, wiped by the next Playwright
  run): `today-day-tag-390-{light,dark}.png` — «Сьогодні» at 390 × 741,
  «Центр + Ринок»: each store's units beside its name, its sum alone on
  its line, the tag 350 px, the first work tag's top over the menu and its
  end under it; `returns-list-{light,dark}.png` — «Повернення» a white
  block under «Сьогодні», the hairline from the text's edge, the whole
  returned sale's goods in pencil. Seen by eye while building.

## For the owner

- **В-К1 still open:** after every lever the task named, the day-tag of
  two stores is 350 px at 390 × 741; the first work tag ends 41 px under
  the menu, the second's title about 83 px. The fold stays under 700 px
  until you say otherwise; the screenshot is
  `frontend/test-results/today-day-tag-390-light.png`.

## Not covered

- A real phone: the day-tag and the rows in Telegram's own themes; a
  finger's press on a row (the fold is measured on a mouse's).
- CI's font: the day-tag's measures are taken in the app's own face; the
  stores' columns in Roboto are GitHub's run.
- «Прибув на пошту» pressed and the card opened by its row meanwhile:
  back on the list while it is still on its way, the verbs are held as
  before but none turns its ring (the ring is the list's own, and the
  list was left).
- «Повернення»'s rows keyed by their day's date: no journey makes a sale
  come on top while a row has the focus.
