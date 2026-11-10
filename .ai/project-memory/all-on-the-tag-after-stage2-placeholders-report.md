# «Усе на бірці», after stage 2's audit, batch 4: every place read its shape in grey, «Завантажуємо …» said to a reader alone; a screen opened at its top, by its header; the goods' reads that failed on the warning's plate — 2026-11-10

Baseline: `c2c5923b` (the audit's third batch, PR #185, merged), and
three tasks of the audit after stage 2:
- [frame P1-4](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  the shared grey shapes and the five places no section took;
- [frame P1-3](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  every screen opens at its heading;
- [goods P1-1](redesign/2026-11-09-redesign-tz-after-stage2-goods.md) —
  the goods' reads that failed on the warning's plate, as everywhere.

Status: built; proof below — 1026 of 1027 journeys on a fresh seed, the one
the known Mac-only failure. 28 of 28 mutants caught. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-placeholders`. Task: the audit's fourth batch,
chosen in chat after #185 was merged (2026-11-10, «Yes, start batch 4»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-10 (audit after stage
2, batch 4: …)". No owner's question is open for these tasks; В-К1 stays
as it was.

Where it stood:
- the shared `Placeholder` knew a sale's row, a debt's row, a field and
  the model tags; five places drew «Завантажуємо …» on the screen with no
  section's task to change them — «Магазини», «Нова модель»'s sizes,
  «Брак»'s warehouses, the price on «Прийшов товар» and in its sheet;
  the grey's corner was its own 10 on chips and cells, a field's 14;
- a screen opened from a scrolled one — a tab, a «Ще» row, a «Сьогодні»
  tag — opened where the page had been; four places reset it themselves;
- the 8 goods places the lint held were bare red alerts; the model's
  detail that could not be read had no title; «Повторити пошук» and
  «Перевірити ще раз» stood where every other plate says «Спробувати ще
  раз».

## What exists now

- **One shape a place read**, each the real element's size and corner, in
  `shared/Placeholder.tsx`: a list's row 64 with a round mark 40 or
  without; a tag 76 of a line and its meta; a store's tag 96; a field 52
  under its label (corner 8); a row of size cells 60 × 60 (corner 6); a
  row of choices in the real row's class (a chip's corner 14); the model
  tags with their cells, as before. «Завантажуємо …» is said to a reader
  alone.
- **The five places:** «Магазини» — two stores' tags in grey, the first
  tag where the first store's comes; «Нова модель» — four grey cells where
  the sizes come; «Брак» — two grey choices where the warehouses come;
  the price — a field row in grey, on «Прийшов товар» and in the price
  sheet.
- **A screen begins at its top:** `ScreenHeader` puts the page at 0 before
  it is painted whenever a header is drawn, its title changes, or the
  screen it says it stands for (`screen`) — every tab, «Ще» row,
  «Сьогодні» tag, row's card, «←» and Telegram's «Назад». A sheet,
  «Показати ще», a switch, a filter, a search keep the place. The same
  screen drawn again — the order's card read anew with its step moved on —
  keeps it too. «Закриття»'s list, the report's table and a list's row back
  from its line fall open where they were left, before the paint.
- **The goods' reads that failed** — the family search, the model's
  detail, «Прийшов товар», «Залишки», «Інвентаризація», the lists' check,
  the price ×2 — are the warning's plate with «Спробувати ще раз»; the
  model's detail heads it with the model's name and «←». The lint has no
  exception left.

## Decided here, not by the owner

Each is in business-rules.md with its reason.
- **«Брак»'s warehouses are grey choices**, not rows: the real element is
  a row of chips, as «Повернення»'s warehouses, whose grey chips stood
  already.
- **«Нова модель»'s grey cells** only while nothing stands there: sizes
  typed by hand keep the real row, the words said to a reader.
- **The price's «field row»** is a label and a field 52.
- **Two shapes no screen uses yet** (the row with a mark, the tag 76) are
  in the `Placeholder` for the sections' tasks; a journey measures them.
- **A title of parts** (a mark, a button in it) is no screen's name: its
  header's coming is. **A screen that says which it is** (`screen`) is put
  at its top only when it is another than the last one put there: the
  order's card says its order, so the same waybill's other order opens at
  its top, and the card read anew keeps the place; «Змінити спосіб
  оплати» says its list and its operation, under one title.
- **«Моделі»'s row back from its model** is focused just after the paint,
  as before: taken before it, the focus was lost.
- **The sales report's own reset** for a screen of its own went too —
  five removed, not four.
- **14 other resets of their own are left** — each redundant or at a step
  the header does not see.
- **The lists' check's retry**, quiet before, is the plate's secondary.

## How it was built and proven

- **Files:**
  - `frontend/src/shared/Placeholder.tsx`: `avatar`, `lineTags`, `stores`,
    `cells`, `chips` with `className`; the tags only when asked for; one
    status line said to a reader;
  - `frontend/src/styles.css`: the corners of a chip, a cell and a field in
    grey, the mark's grey; the tag 76; a store's name line 26;
  - `frontend/src/stores/Stores.tsx`, `catalog/NewModel.tsx`,
    `damaged/Damaged.tsx`, `prices/SuggestedPrice.tsx`: the shapes;
  - `frontend/src/shared/ScreenHeader.tsx`: the reset, `screen`;
    `orders/Order.tsx`: `screen={order.id}`; `cash/Fix.tsx`: its list's
    and its operation's; `App.tsx`, `stores/Stores.tsx`,
    `backups/Backups.tsx`, `reports/SalesReport.tsx`: their own resets
    gone; `cash/History.tsx`, `reports/SalesReport.tsx`,
    `openings/Openings.tsx`: the place restored in a layout effect;
  - `frontend/src/catalog/FamilySearch.tsx`, `inventory/Model.tsx`,
    `inventory/Receive.tsx`, `inventory/Stock.tsx`,
    `inventory/Stocktaking.tsx`, `openings/Openings.tsx`,
    `prices/SuggestedPrice.tsx`: `Unread`; three local `Failure`s gone.
  - No backend change.
- **Journeys:** 1027 in all, 1016 before.
  - New, the shapes (frame P1-4): `design-system` — every shape beside the
    real element where a screen draws one (a sale's row, a store's tag, a
    field, a size cell, a chip), its height and corner, and the grey; the
    row with a mark and the tag 76 as the `Placeholder` draws them;
    `stores`, `catalog`, `damaged`, `price` — each place read slowly
    (held by its route until it is seen): its grey shapes where the real
    ones come, «Завантажуємо …» said to a reader and never drawn; on
    «Магазини» and the sizes the first real element no further than 4 px
    from its grey.
  - New, the top (frame P1-3): `more-lines` — at 360 × 640, «Ще» scrolled
    to its foot, every row of the owner's opens its screen with its
    heading whole in view, and «←» brings «Ще» back; `today` — the same
    for a tag's verb on «Сьогодні»; `cash-move-fix` — at 360 × 400 an
    operation tapped from the list's foot opens its card at its top, under
    the same title; `sales-report` — at 360 × 400, the report scrolled to
    its foot, «Моделі» read before opens again at its top (one header, its
    title another), and back, the report where it was left.
  - New, the plates (goods P1-1): `openings` — the check that no list
    waits, failed; `stocktake` — the warehouses not read; `price` — the
    price that fails and its retry.
  - Changed: the model's detail not read — the plate under its name and
    «←» (`model`); «Залишки»' and «Прийшов товар»'s plates (`stock`,
    `receive`); «Показати ще» keeps the place at 360 × 640
    (`cash-history`); the same waybill's other order opens at its top, and
    the first read anew with its step moved on keeps where it was read to
    (`orders-card`).

## The independent review

An independent reviewer read the diff against `main` with the three
tasks and the spec's §5, §6.2, §6.23 and §6.27; it ran the type check and
ESLint on every changed file. No high finding; the five removed resets
each covered, the layout effects' order holding, no header remounted or
retitled by a switch, a filter, a search, «Показати ще» or a sheet.
Settled in the code or the journeys:
- **The order's card read anew** — back from the carrier's app, with its
  step or its history moved on — is drawn again from its mount, and its
  header put the page at its top. Now a screen that says which it is
  resets only when it is another than the last one reset: the card keeps
  the place, and a journey reads it so.
- **The grey mark** took the mark's own fold, not the grey; now the grey,
  and the journey reads its colour.
- **«Змінити спосіб оплати»:** an operation tapped from low in the list
  opened its card where the list had been (one title over both; before
  this batch too). Now each says which it is; a journey taps it from the
  foot.
- **One frame at the top after Telegram's «Назад»:** «Початкові
  залишки»' row back from its line is put in place before the paint now.
  «Моделі»'s row was tried the same way and lost its focus (two «Моделі»
  journeys); it stays as it was, focused just after the paint.
- **Journeys:** a route held for «read slowly» lets go by itself after
  10 s, so a failed assertion leaves no fetch hanging at the context's
  end; «Ще»'s rows wait for the new screen's heading before they measure
  it.
- **The grey chip's rule** was written twice; one now.
- Seen and left: the `design-system` journey draws the row with a mark
  and the tag 76 from the `Placeholder`'s markup copied, as no screen uses
  them yet — a drift there would pass until a section takes them.
- Found by the first runs, not the review: the new model's sizes measured
  against the page moved with the sheet's growing (now against the sizes'
  block); a real row is 67 with its lines, not 64 (now each grey row
  against a real one, ±4); a read of the order on its way answers the
  journey's first return (it returns again until the new answer is
  drawn).

## Mutants

`~/.cache/birka-runtime/helpers/mutate34.py`: 28 mutants, each undoing
one thing this batch made — 25 of the three tasks, 3 of the review's
fixes. `mutants34.sh` ran each against the journeys that should catch it,
on a fresh seed each, one failure ending the run; the lint's mutant by
ESLint over `src/`.
- **The three tasks:** «Магазини»' grey, its door and its name line; the
  status drawn; the cells' grey and their corner; the chips' grey, their
  corner and their row's class; the field's corner; the price's grey; the
  tag 76; the header's reset, its title as its key and «Сьогодні»'s way
  to it; the order's `screen`; the eight plates back as bare alerts
  (the family search, «Залишки», «Інвентаризація», «Прийшов товар»,
  «Початкові залишки», the price, the model's detail) and the model's
  title gone; a goods place's alert unmarked for the lint.
- **The review's:** the reset not deduplicated; the grey mark's fold;
  «Змінити спосіб оплати»'s keys gone.
- **28 caught.** The first pass ran 29: 27 caught. Of the two left, one
  was equivalent — the grey mark's own round corner, which the mark's own
  rule gives already: the line is gone. The other — the reset not watching
  the title — was missed because the only screen whose one header changes
  its title, the report's, opened a screen too short to stay scrolled; a
  new journey opens «Моделі», read before, long, from the report's foot,
  and catches it.
- Logs: `go-mutants34-first.log`, `go-mutants34-second.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean; the journeys' type check at the baseline's 44.
  Prettier is clean on the files that were clean at the baseline; in the
  files that were not, this batch adds nothing to what it would change.
- **Every journey,** on a fresh seed, one worker: 1026 of 1027 in 27.5
  minutes — `go-b4-full.log`. The one: `backups.spec.ts:93`, «the owner is
  shown last night's failed copy…» — this Mac's backups' history, failing
  alike on the last baselines; GitHub's run is the proof.
- **GitHub's first run,** at `cbde83e7`: 1026 of 1027. The one,
  `today.spec.ts:2548` (since #158), looked for «120» in what is kept for
  «Бачу» — a moment's digits too, and that day's noon held them. It reads
  the keys for words and the values for numbers now.
- **The affected specs while building,** each on a fresh seed:
  - the 16 specs this batch touches — 20 failed at first, most the shared
    seed's state (the catalog's «Лоран», the openings, the stocktake) and
    passing on a fresh one; three were the journeys' own (the sizes'
    place, a real row's height, «Ще»'s way back), each settled;
  - after the review's fixes, `b4-run3` — 199 of 202: two «Моделі»
    journeys (the focus taken before the paint, put back) and the order
    read anew (the read on its way, the journey returns again);
  - then `models`, `orders-card`, `cash-move-fix` — 97 of 97, `b4-run4`;
  - the report's new journey, on the code and on the mutant it was made
    for (the page left at 72).

## Not covered

- A real phone.
- The 21 places on the screen with «Завантажуємо …» the sections' TZs took
  (goods P2-2, money P1-3, sale's `FromCatalog`).
- A screen that draws its loading state with no header puts the page at
  its top when its header comes, not as it opens.
- The row with a mark and the tag 76 are measured as copied from the
  `Placeholder`, not drawn by a screen: no screen uses them yet.
- «Моделі»'s row back from its model may show one frame at the top after
  Telegram's «Назад» (focused just after the paint).

## For the owner

- Nothing to answer for these tasks. What changes for the eye: a place
  being read shows the shape of what comes, with no «Завантажуємо …»
  written; every screen opens at its title; the goods' failed reads are
  the yellow plate with «Спробувати ще раз», as everywhere else.
