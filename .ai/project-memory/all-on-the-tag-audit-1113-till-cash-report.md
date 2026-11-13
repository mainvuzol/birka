# «Усе на бірці», audit 2026-11-13, batch 3: a way's refusal said in the till's tray over the ways, the page never moved; «Оплата частинами» a switch row; «Каса»'s rows and lists on a list's white block, nothing faded while its write is on its way (sale P1-3, P2-6, orders-cash P1-2) — 2026-11-13

Baseline: `43b738a0` (the audit's second batch, PR #203, merged). This batch
is the audit's next in its own order («merged, go next»): the P1s left that
wait on no owner's answer — the sale task list's «Партия 2 «Касса»» (P1-3
with P2-6), and the orders-cash list's P1-2, next after its P1-1.

Status: built and proven in the journeys (the full run before the review's
fixes 1107 of 1108 — the stand's own `backups:93`; the 29 specs touched,
after them, 588 of 588); 33 of 34 mutants caught and one equivalent; the
review's findings fixed; not committed.
Not yet seen on a real phone.
- Branch: `feat/audit-1113-till-cash`.
- Task: the audit's third batch, after #203's merge (2026-11-13).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-13 (audit
  2026-11-13, batch 3: …)".

Where it stood:
- The till: a way's refusal stood as a paragraph after the list, and the
  page scrolled down to it — the tag the seller looked at gone from under
  the finger; what the terms needed, the basket's sheet closed over it,
  stood under the list too. Over the tray two lines: the refusal and the
  terminal's hint.
- «Оплата частинами» was a tick 23 px in a row, the one tick on the
  till's five-step path in parts, next to the paper's switch row.
- «Каса»'s rows, the seller's own operations, a day's operations and
  «Закриття» lay on the paper — the only lists left off the white block
  that «Гроші», «Покупці» and «Ще» have; while a write of «Каса» was on
  its way its rows faded whole to 45 % (2.85:1 light, 4.17:1 dark).

## What exists now

- **A way's refusal in the tray** (sale P1-3; `frontend/src/sales/Sale.tsx`,
  `frontend/src/styles.css`, `frontend/src/shared/Sheet.tsx`):
  - one line in the tray, in its own flow between «Разом» and the ways —
    the place the task list gives «Ще надсилаємо…», which is drawn over the
    tray: a way's refusal, or what the terms need once the basket's sheet
    is closed over it, one at a time; a way pressed takes the last refusal
    away at once, the terms changed take what they needed (review); the error's
    colour and crossed circle 16, 14/500, no plate of its own; read aloud,
    one error buzz, as before; over the tray only the terminal's hint;
  - the tray rises by it under a long list, the ways where they were, the
    page not moved — the scroll to the refusal is gone;
  - an emptied basket takes the tray and what it said: a coat added after
    starts a tray that says nothing (decided here);
  - a sheet closed gives the cursor back to the button that opened it
    without moving the page when that button is on what sticks — the tray,
    a dock (decided here): Chromium scrolled the page by ≈ 300 px to where
    a sticky button would stand unstuck, each time the basket's sheet
    closed over a long list (found by this batch's journey); a cell under
    the tray is still brought into view, as before;
  - words unchanged; the basket's sheet and the shelf's question keep their
    own refusals.
- **«Оплата частинами» a switch row** (sale P2-6; `frontend/src/shared/SwitchRow.tsx`
  new, `frontend/src/credits/Terms.tsx`, `frontend/src/sales/paperMark.tsx`):
  the paper switch's markup made one component; «Оплата частинами» its
  words on the left, the switch on the right, the whole 44 row the target,
  read aloud as a switch; turned on, the cursor in the name, as before. In
  the till's basket sheet and in «Клієнт забрав»'s, which share the terms.
  A switch that takes no tap keeps its words in pencil, unfaded; the switch
  itself dimmed (review — the paper switch's words had faded to 45 %).
- **«Каса» on the white block** (orders-cash P1-2; `frontend/src/cash/Cash.tsx`,
  `Fix.tsx`, `History.tsx`, `Placeholders.tsx`, `frontend/src/styles.css`):
  - «Каса»'s rows, «Ваші операції», «Операції дня» and «Закриття» on
    `.list-block` — the card's white, 4 round; rows' sides 16, a hairline
    from 16, none under the last; a day nobody closed the same; their
    places while read on the same block; a «Каса» row's chevron
    `sale-open`;
  - while a write of «Каса» is on its way, its rows that take no tap (all
    but «Закриття», open as before) do not fade: titles in pencil — the rule a list's row has everywhere, now
    reaching `.cash-row-title` (suppliers' and «Сьогодні»'s search rows
    too, when held);
  - with none of «Каса»'s tasks, no empty block (`.list-block:empty`,
    decided here);
  - the thread «Видано й внесено після закриття» and «Закрити касу» stay
    on the paper.

## The independent review

An independent reviewer read the diff cold (no Playwright, nothing
edited), after the first full run.
- **Medium, fixed:** a refusal and the terms' need could stand together in
  the tray — a way refused (409), then pressed with «Оплата частинами» on
  and no name: `send()` set the terms' words and returned before the old
  refusal was cleared, so two alerts stood over the ways, the old one
  saying «Натисніть спосіб оплати ще раз» though nothing was sent; and the
  terms' words stayed after «Оплата частинами» was turned off. Now a way
  pressed clears the last refusal first, and the terms changed clear what
  they needed (as «Клієнт забрав» does). A journey proves both
  (`till-shortage`, the review's).
- **Low, fixed:**
  - a switch row that takes no tap faded its words to 45 % (the paper
    switch while a sale is on its way; «Оплата частинами» in a stopped
    store's «Клієнт забрав»): now its words are in pencil, the switch
    alone dimmed (`till-redesign` checks it);
  - the tray's tap waited for nothing: it now waits for the way to be
    enabled;
  - the no-fade check looked at «Каса»'s rows only under the sheet's
    scrim: the kept take-out's journey now checks the row unscrimmed;
  - two claims overstated: «Ще надсилаємо…» is drawn over the tray, not
    between «Разом» and the ways (the refusal takes that place in the
    tray's flow); «Закриття» stays tappable while a write is on its way —
    the docs now say so;
  - the journeys' count: 1109 by `--list`.
- **Checked, no defect:** the sheet's `preventScroll` touches only openers
  on something sticky (the tray, a dock, the search) — no root sticks;
  `.list-block:empty` hides only empty blocks; the no-fade rule's
  specificity over `.correct-row:disabled` changes no colour
  (`--text-2` is pencil); rows of orders and the report never disabled.
- **Low, left:** the emptied basket's journey proves the refusal goes, not
  the terms' words — a coat put in clears those already.

## How it was built and proven

- Journeys, new:
  - `till-shortage`, light and dark: one line, ten tags, 360 × 640, the
    page at its start; «Готівка» → 409 → the refusal in the tray between
    «Разом» and the ways, the page's only alert, `scrollY` 0, «Готівка»
    where it was (±1 px), the error's colour, crossed circle 16, 14/500,
    no plate, ≤ 4 lines, 4.5:1; the basket emptied — no tray, no alert;
    a coat again — a tray that says nothing;
  - `till-shortage`: the terms' need with the sheet closed — in the sheet
    alone while it is open, in the tray once Escape closed it, the page
    not moved, nothing sent;
  - `cash-move-fix`, light and dark: «Каса»'s rows on the block (each
    row's sides, hairlines, the last's none; first and last by §6.8);
    «Видати з каси» on its way — every row disabled, opacity 1, title in
    pencil, 4.5:1; answered, enabled; «Ваші операції» on the block;
  - `cash-polish`: a day's operations read — three rows' places on the
    block; with none of «Каса»'s tasks — no block shown;
  - `cash-history`: a list of closes that ends on a day nobody closed — no
    hairline under that day;
  - `till-shortage` (the review's): a way refused, then pressed with the
    terms unmet — one line in the tray, the terms' need alone; the terms
    turned off — nothing.
- Journeys, changed:
  - `till-shortage`: an answer refused for its own reason under a long
    list — in the tray, the page's only alert, the ways where they were
    (was: brought into view at the page's end);
  - `till-receipt`: «Оплата частинами» a switch, its row 44, the switch's
    box the whole row, pressed on its words; `till-taps`: five taps, the
    switch; `orders-card`: «Клієнт забрав»'s sheet — the switch, the five
    ways on the screen at 360 × 640, none chosen;
  - `cash-correct`, `cash-history` (both themes): «Операції дня» and
    «Закриття» with its days nobody closed on the block; `cash-polish`:
    the places while read on the block;
  - `cash-move-fix`: the kept take-out's row, its sheet closed — unfaded,
    title in pencil, 4.5:1, nothing over it; `till-redesign`: the paper
    switch held under a sale on its way — words in pencil, unfaded, the
    switch at 45 %;
  - `fixtures`: `expectListBlock` — a block's white and corner, every
    row's sides and hairline, the last's none.
- Found while proving: a locator's click on a sticky button scrolls the
  page "into view" first (Playwright), as no finger does — the tray's
  journeys tap where the button stands (`tapInPlace`); with it the sheet's
  own scroll on closing showed (above), and is fixed.
- Measured at 360 px: the conflict's refusal 3 lines; «Частина цих
  одиниць у резерві замовлення…» 5; «Цього товару вже немає в обліку…»
  (from paper) 6, the tray then 302 px of 640.

## Mutants

`mutate51.py`, 34 mutants, each applied alone, its journey run, the source
restored (`mutants51.sh`): 33 caught, each at the check meant for it, and
one equivalent.
- The tray's refusal (10): the refusal not drawn; scrolled to as it comes;
  the terms' need not drawn, or drawn in the tray with the sheet open; the
  emptied basket not clearing it; a plate under it; its sign 20, or the
  glyph's mask 20 in a 16 box; its words 16; the sheet's cursor returned
  with the page moved.
- The switch (4): «Оплата частинами» a tick again (the till's sheet, and
  «Клієнт забрав»'s); the row not a switch to a reader; the box not
  inset — equivalent: absolute at 100 % from the row's start covers the
  same row, nothing a finger or a reader can tell.
- «Каса» on the block (15): «Каса»'s rows, «Ваші операції», «Операції
  дня», «Закриття» off the block; a «Каса» row's chevron not the set's;
  a day nobody closed with the paper's sides, without its hairline, or
  with one under the list's last; held rows faded, or their titles in ink;
  an empty block drawn; the four places while read off the block.
- The first pass had 29, 26 caught. Two lived, and each found a check
  missing: `cssmask` (the glyph's mask left at 20 in its 16 box — the
  journey looked at the box, not the mask: now it reads `mask-size`) and
  `unclosedlast` (no list ended on a day nobody closed: now one does,
  `cash-history`). Both caught on the second pass.
- The review's fixes (5): a way pressed not clearing the last refusal; the
  terms changed not clearing what they needed; «Каса»'s held row faded
  with nothing over it; a switch's words faded when it takes no tap; the
  switch itself not dimmed. All caught.

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1107 of
  1108 in 30.5 min. The one: `backups:93` — the stand's own, as in every
  full run since batch 8.
- After the review's fixes, a fresh seed, the 29 specs these files touch
  (every `till-*`, `cash*`, `credits*`, `orders-card`,
  `returns-sale-screen`, `size`, `outage`, `shelf`): 587 of 588 in 13.8
  min; the one, «Змінити спосіб оплати»'s five taps, began before midnight
  and drew after it — its operation «today at 20:05» by the Mac's clock
  read «13.11, 20:05»; run again alone, it passes.
- Before them, `cash.spec` failed twice on the stand's drawer, closed that
  day by an earlier run; after a fresh seed it passes.
- Types: `tsc --noEmit` clean; ESLint clean on every file touched; Prettier
  clean on what this batch changed — `Sale.tsx`, `Cash.tsx`,
  `till-shortage.spec.ts`, `till-taps.spec.ts` and `till-redesign.spec.ts`
  are unformatted on main and left so outside it; `styles.css` left as on
  main.

## Not covered

- A real phone; Telegram's own WebView on iOS (WebKit) scrolling to a
  focused sticky button.
- The tray on a short list (in the page's flow): no journey measures the
  ways there.
- «Сьогодні»'s search rows and suppliers' rows held: no journey looks at
  them while held after the rule reached them.

## For the owner

- **Done:** a refusal at the till is said right over the buttons to press
  again, and the list stays where it was; «Оплата частинами» is a switch
  like «Вношу продаж з паперу»; «Каса» looks like «Гроші» and «Ще», and its
  rows stay readable while a record is sent.
- **To read:** a long refusal at 360 px takes 5–6 lines in the tray (the
  task list asked 4): the words are yours and are not cut; on a list of
  one model the tray stands under it and grows down; «Зніміть «Оплата
  частинами»» was written for a tick — on a switch «вимкніть»?
- **Still open:** В13-П1, В13-П2, В13-З1, В13-Г1/Г2, В13-Т1/Т2 and the
  questions of earlier batches, as listed in the task lists.
