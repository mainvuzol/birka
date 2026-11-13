# «Усе на бірці», after stage 2's audit, batch 17: «Знайшли товар, якого немає в списку» one screen for the stocktake's entry and its count, the model's sizes as cells; receiving's price a row and the model's sheet (goods P1-2, P1-3) — 2026-11-13

Baseline: `a8e431b1` (the audit's sixteenth batch, PR #199, merged). Every
point left of the goods task list after stage 2
(`.ai/project-memory/redesign/2026-11-09-redesign-tz-after-stage2-goods.md`)
is marked «нужно утверждение», as P1-4 and P1-5 were when the user chose
them; P1-2 and P1-3 are the next in the task list's own order (§8). Built as
the task list gives them, its words and what it did not give readings for
the owner.

Left of the goods task list: P2-4, «нужно утверждение».

Status: built and proven in the journeys (1087 of 1088, the stand's own
`backups:93`); 25 of 25 mutants caught; the review's findings fixed; not
committed.
Not yet seen on a real phone.
- Branch: `feat/after-stage2-found-goods-price`.
- Task: the audit's seventeenth batch, taken after #199 was merged
  (2026-11-13, «merged, go next»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-13 (audit after
  stage 2, batch 17: …)".

Where it stood:
- «Знайшли товар, якого немає в списку» was written twice — on the
  stocktake's entry and in its count —, each a plate in the old direction:
  an h3, a hint of two sentences, the catalogue's search, a `<select>`
  «Розмір» / «Оберіть розмір», «Скасувати». At the entry the correction's
  form stood on the screen with its own «Записати · …» beside Telegram's
  MainButton «Почати інвентаризацію» — two main buttons —, and what it
  recorded was a line. At the count, a size chosen still needed its cell
  tapped: six taps and a list's wheel.
- Receiving's price was «Ціна продажу: X — спільна для всіх магазинів» and
  «Задати / Змінити ціну продажу», which opened the editor in the form — the
  keypad between the model and its sizes, its own «Зберегти · …» and
  «Скасувати» beside the MainButton «Записати прихід» —, and said «Ціну
  збережено.».

## What exists now

- **«Знайшли товар, якого немає в списку»** (P1-2;
  `frontend/src/inventory/FoundGoods.tsx`, one component for the
  stocktake's entry and its count):
  - its own screen, «Товар, якого немає в списку», under «←
    Інвентаризація» and Telegram's «Назад», the menu aside; back where it
    was opened, the cursor on «Знайшли товар…»;
  - one line of hint, «Якщо товар уже є в обліку цього складу, сервер
    скаже, скільки саме.»; the catalogue's search with the cursor in it;
    «Додати нову модель «…»» and the sheet «Нова модель» over the screen,
    as before;
  - a model chosen: its name and «Змінити», as receiving shows it; the
    organization's sizes as cells 60 × 60, in its order. No `<select>`,
    no «Скасувати», no MainButton of the screen's own;
  - at the count (`Stocktake.tsx`): each cell «в обліку N» and the held
    badge, as the count's own cells; a tap opens the count's sheet at
    once; recorded, back to the count with its toast. Four taps and the
    number;
  - at the entry (`Stocktaking.tsx`): a tap opens the correction in a
    sheet «{модель} · {розмір}», Telegram's MainButton «Записати · …» its
    one button (outside Telegram the sheet's own); recorded, back to the
    entry, «Коригування записано: … облік 0 → N.» on a stub over
    «Знайшли товар…». Five taps and the number. The screen is kept for its
    warehouse: a warehouse lost or changed closes it and its sheet.
- **Receiving's price** (P1-3; `frontend/src/prices/SuggestedPrice.tsx`):
  - a row «Ціна продажу X» — the server's suggested price, the store's own
    or the shared —, «Змінити ціну» quiet, for `catalog:set_price`;
  - `PriceSheet`, the same sheet a model's detail opens (`Model.tsx` now
    uses it): named by the model, the keypad in it alone, Telegram's
    MainButton «Зберегти · …»; «Записати прихід» put away while it stands
    (`Receive.tsx`); «Назад» closes it, nothing saved;
  - saved: the toast «Ціну продажу збережено: {модель}.», the row's new
    price, the sizes counted kept, the cursor on «Змінити ціну».
- `Correction.tsx` and the price's editor lost their on-screen branch and
  «Скасувати»: every caller shows them in a sheet now.
- In passing: «Пошук у каталозі» (`CatalogPicker.tsx`) and «Інший колір
  нашої моделі» (`FamilySearch.tsx`) — new words reset the cursor's place
  as they are typed, not after the pause.

## The independent review

An independent review (a fresh agent, the diff and the task list's two
points; no conclusions handed to it) found:
- **High:** none.
- **Medium, fixed:** the entry's screen could outlive its warehouse. With
  one warehouse (none chosen), that warehouse revoked left the menu hidden
  on the entry's ordinary screen; a warehouse back reopened the screen and
  its correction's sheet — the old target, the new warehouse. Now the
  screen keeps its warehouse's id: it and its sheet are cleared once that
  warehouse is not the one shown or `inventory:receive` is gone, and the
  menu follows the screen.
- **Low, fixed:**
  - dead code: the correction's and the price editor's on-screen branches
    and «Скасувати»; `PriceEditor` no longer exported;
  - a comment moved back over its code;
  - a check that could not fail: the journey now sees «Почати
    інвентаризацію» on the MainButton before it goes;
  - no journey saved a price and then recorded the receipt: a step now;
  - the picker's cursor reset only after the pause, so a page landing in
    it could still take the cursor: reset in the field's change now (in
    `FamilySearch.tsx` too);
  - the row worked out `store_price ?? shared_price` itself: now the
    server's `suggested_price`, no pricing rule on the client.
- **Low, left:**
  - outside Telegram the toast stands over the docked «Записати прихід»
    for its time — the shared `.toast` rule ignores the pay panel's height
    everywhere; the frame's, not this batch's;
  - a cell's markup repeats the count's `CountCell`: exporting it from
    `Stocktake.tsx`, which imports `FoundGoods.tsx`, would be a circular
    import; a shared cell is a later move;
  - the correction's stub may go unread aloud (a status inserted with its
    words, the cursor elsewhere) — as S23's stubs, consistent;
  - an empty sizes answer draws an empty «Розмір» group; no dark-theme
    screenshot.
- **Checked and fine** (the review's words): the rights as before; what is
  recorded unchanged; one MainButton at a time; «Назад» closes the sheet
  first, then the screen; the menu; the focus; no sheet over a sheet; the
  guards on close; the typed counts survive the price sheet; the cells
  60 × 60 and nothing past 360; the tap counts, 4 and 5 and the number.

## How it was built and proven

**Code:**
- New `frontend/src/inventory/FoundGoods.tsx`; `Stocktaking.tsx` and
  `Stocktake.tsx`, their two old forms removed.
- `frontend/src/prices/SuggestedPrice.tsx` (`PriceSheet`), `Model.tsx`,
  `Receive.tsx`, `Correction.tsx`.
- `CatalogPicker.tsx` (`autoFocus`, the cursor's reset), `FamilySearch.tsx`
  (the reset).
- `styles.css`: `.stocktake-found .cells` → `.found-goods > .hint`,
  `.found-cells`.
- No backend change.

**Journeys:** 1088 in all, as before — rewritten, none added.
- `stocktake` — the count's «Знайшли товар…»: its screen (the title, the
  counting gone, the menu gone, the cursor in the search, the hint, no
  `<select>` or «Скасувати»); «←» and the cursor back; «Нова модель» added
  and left, the words kept; the model's row; the cells «в обліку 0», 60 ×
  60, nothing past 360; «L» → the count's sheet → 1 → recorded, the toast,
  the cursor on «Знайшли товар…», 4 taps and the number; a held size
  refused by the server.
- `correct` — the entry's, inside Telegram: «Почати інвентаризацію»
  before, no MainButton of the screen, the menu gone; «L» → the sheet
  «Лоран шоколад … · L», «Склад «…»», «В обліку 0», the reason, the
  MainButton «Записати · +2 шт.» its one button, pressed; the stub
  «Коригування записано: … облік 0 → 2.», the cursor back, 5 taps and the
  number; a model of numeric sizes; a held size refused, the sheet closed,
  «←», the cursor back.
- `price` — the owner on receiving: the row, «Змінити ціну», the sheet (the
  scopes, the keypad in it alone, no «Скасувати», nothing past 360), the
  refusals 422/409/500/404 inside it; saved → the toast → the row → the
  counts kept → the cursor; the store's price and its removal; then the
  receipt recorded. The seller: the row, no «Змінити ціну».
- `receive` — inside Telegram: the price's read failing as the sheet
  opens — its plate, no MainButton at all, «Записати прихід» put away
  under it; the retry; the keypad, the MainButton «Зберегти · 5,00 грн», no
  own «Зберегти»; «Назад» → «Записати прихід · 1 шт.» back.
- `goods-places` — «Прийшов товар» read slowly: a page pressed for other
  words and failed; new words keep the cursor in the field; the retry's
  first row takes it.

## Mutants

`mutate47.py`, 25 mutants, each applied alone, its journey run, the source
restored (`mutants47.sh`, the stand reseeded before the stocktake's and
the correction's): 25 of 25 caught, each at the check meant for it.
- The count's screen (10): its title; its hint; «Скасувати» back; the
  cursor in the search, from the screen and from the picker; the cell's
  size; the cells' «в обліку N»; the screen left once its count is
  recorded; «←»'s name; the cursor back.
- The entry's (6): the menu aside; the cursor back; the sheet's button in
  the sheet; the cells as the size alone; the stub's state; «Склад «…»» in
  the sheet.
- The picker (1): new words keeping the cursor's place.
- The price (8): the row's words; whose price in the row; «Змінити ціну»;
  the button for everyone; the sheet's button in the sheet; the toast's
  words; the sheet closed while saving; «Записати прихід» not put away.
- The first pass caught 24: «Записати прихід» not put away passed, the
  sheet's own MainButton standing over it. A step was added where the
  price's read fails as the sheet opens — no MainButton of the sheet's —
  and it is caught there.

## Evidence

- Full run, a fresh seed, one worker: 1087 of 1088 in 30.0 min. The one:
  `backups:93` — the stand's own (the additive seed's nights), as in every
  full run since batch 8.
- The affected specs (`stocktake`, `correct`, `price`, `receive`,
  `goods-places`) on a fresh seed: 68 of 68 before the review's fixes;
  after them the strict «L, в обліку 0» (it named «XL» too) made exact,
  and the count's and receiving's journeys again: 2 of 2.
- Seen at 360 × 640 (the journeys' screenshots): «Товар, якого
  немає в списку» at the count — «← Інвентаризація», the title on one
  line, the hint's two lines, the model and «Змінити», twelve cells in
  rows of four, each «в обліку 0», the count's last toast still standing
  for its time; receiving's price sheet — named by the model, the scopes,
  «Зараз: …», the keypad, «Зберегти» the sheet's own (outside Telegram),
  no «Скасувати».
- Types: `tsc --noEmit` clean; the journeys' (`tsconfig.eslint.json`) 44
  errors, as on main — none in a file of this batch. ESLint clean; Prettier
  clean on every file touched but `styles.css`, unformatted on main and
  left so. `npm run build` passes.

## Not covered

- A real phone.
- The entry's screen with its warehouse revoked while it stands (the
  review's medium): the code clears it; no journey revokes a warehouse
  there.
- The dark theme: no screenshot.
- An empty sizes answer: an empty «Розмір» group, no words.

## For the owner

- **Done:** goods found on the shelf that the system doesn't hold are
  found on a screen of their own — the model, then its size as a cell,
  then the count's or the correction's sheet, the same in both places;
  receiving's price is a row and changes in the model's own price sheet.
- **To read** (decided here): «← Інвентаризація» over the screen; at the
  entry a cell is its size alone (the sheet says «В обліку 0»); the
  cursor in the search as the screen opens; the model shown as receiving
  shows it; the correction's stub over «Знайшли товар…».
- **Waiting for your approval** (the goods task list): P1-2 and P1-3 as
  built here; P2-4.
- **Still open:** «Каса»'s and orders' refusals by В-П1 (batch 15); the
  «what to check» words (batch 15); «Закриття · Центр» (batch 12);
  «Продано»'s stub words (batch 13); the «Початкові залишки» hold line
  (batch 10).
