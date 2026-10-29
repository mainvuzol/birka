# «Усе на бірці», the till, part 1: model tags, 60 × 60 size cells, the search, no warehouse to choose — 2026-10-29

Baseline: `471e8e2` (#152, on main), and the frame's task list
([P0-5](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), items 1, 2
and 6).
Status: built and reviewed; evidence below. CI is GitHub's, on the pull
request. Not yet seen on a real phone (С6).
Branch: `feat/till-cells`. Task: the frame's P0-5, part 1 of 3.
Chosen: business-rules.md, "Chosen in chat — 2026-10-29 (the till's cells,
«Усе на бірці» P0-5, part 1)".

P0-5 is the largest task of the frame (L), and goes in three parts: this
one, the tags, the cells, the search and the warehouse; then the pay tray
and the basket sheet; then the shortage sheet, the paper switch row and the
taps counted. At the hanger the seller looks at the size, not at a form:
«M» large with «2» under it reads faster than «M · 2» and a line of what is
held.

## What exists now

- **A model's tag** (spec §6.12): a row tag, its two left corners cut, the
  hole punched where a row tag's eyelet sits; the name at 22 in the display
  face, its price at the right (20/600); then its cells. One per model, as
  before.
- **A cell per size** (spec §6.13; `SizeCell`), 60 × 60 at least:
  - the letter at 28/800, under it what is free to sell (14/600, pencil);
  - what orders hold: a pin badge with its count on the top right, never
    counted as free; the line «Ще N шт. у резерві замовлення» is gone;
  - every unit held: dashed, the letter in pencil, «у резерві» under it in
    the online colour; a tap puts nothing in the basket (`aria-disabled`),
    but from paper, as before;
  - in the basket: filled ink with the lime letter, «×N» on the top right,
    the pin moved to the top left; «×N» counts the line a tap adds to, so a
    size read off a label is on that size's cell;
  - no room left for it (a full basket; in an order, all that is free):
    dimmed, as a button that cannot be pressed;
  - a size not known: «?», and under the tag's cells «? — розмір
    невідомий»;
  - read aloud in one go: «M, вільно 2, у резерві 1, у кошику 1».
- **Two warehouses or more:** a cell per warehouse, its name under the
  letter («Основний 2», «Свій 1»); the cell chooses where the coat leaves
  from, as the chip did. A name too long for the cell is cut short, never
  its count; no cell is wider than the screen.
- **No warehouse to choose at the till:** the «Склад» list («Усі склади»,
  one warehouse alone) and the line «Склад: X» above the search are gone.
  A store with one warehouse sells from it; with two or more, every one is
  listed; with none, «Доступних складів немає. Зверніться до менеджера.»
- **Where a coat leaves from:** under each basket line, «Склад: X»; on the
  receipt, once under the lines when the sale left from one warehouse (each
  line its own from two, as before).
- **The search** (spec §6.6; `shared/SearchField.tsx`): 52 high, the
  magnifier on the left, «Модель або колір» as its placeholder, «Знайти
  модель» read aloud and never seen, «×» once something is typed — it
  empties the field and keeps the cursor. At the till it stays at the top
  while the tags scroll under it, under the bottom menu where the two meet,
  and a field the page scrolls to keeps clear of it.
- **Being read:** the placeholder draws model tags with three 60 × 60 cells,
  in their place.
- **«Нове замовлення»** shares the search's list: its sizes are cells too,
  «×N» for what the order holds, read aloud «у замовленні N»; its search
  scrolls with its form.
- **Kept as it was:** what each tap puts in the basket and from where; the
  server never chooses a warehouse; what is held never goes in the basket
  but from paper; the coat in hand from the catalogue, asked its warehouse
  in a store with two; the warehouses still waiting for their opening list,
  said in the words they had; every price, sum and way.

No backend change. No right or rule changes.

## Decided here, not by the owner

- **Three parts** for P0-5 (above).
- **With two warehouses or more, all are listed at once; one may no longer
  be looked at alone.** The task list takes the choice away; a store's
  cells already name their warehouses.
- **No warehouse to sell from:** the words the list said when it had none.
- **A warehouse waiting for its opening list** keeps the words it has:
  with two, «Склад «X» ще чекає початкових залишків: його товар продавайте
  на папері.» for each one waiting (owner decision, 2026-10-17); alone,
  «На складі «X» зараз немає товару в обліку…». The task list asks for the
  second for each; the first already is, and is the owner's.
- **«Склад: X» under every basket line**, whatever the store; the line's
  title loses the warehouse, which «Прибрати …», the line's quantity read
  aloud, the shortage and the pay panel still name where two are listed.
- **The receipt's «Склад: X»** once, under the lines, for a sale from one
  warehouse.
- **A cell read aloud** «M, вільно 2, у резерві 1, у кошику 1»; with two
  warehouses, «M, Свій, вільно 1».
- **«×N» and the pin together:** «×N» on the top right, the pin on the top
  left — the spec puts both on the top right.
- **«×N» on the cell a tap adds to:** a size read off a label counts on its
  own cell, not on «?» it was taken from.
- **No room, dimmed:** the spec has no such state; a chip that could not
  be pressed was dimmed, and so is the cell.
- **Only the till's search stays at the top:** the task list asks it of the
  till; «Нове замовлення» is a long form.
- **«?» explained once**, under the tag's cells: «? — розмір невідомий».
- **No line «{колір} · {вид}»:** the till's list names a model in one
  string; telling the colour from the name would be a guess (constitution
  §16, §22), and the task list has no backend change. A question for the
  section of the catalogue.
- **The tag's hole is punched, not an eyelet:** it says nothing of a record.
- **The search is shared**, used by the till and «Нове замовлення» now;
  «Повернути» and «Внесок» take it with their tasks.
- **Waiting for later parts:** the light tap and the `drop` to the tray
  (part 2 and P1-2); the search in focus when the till opens — with the
  keyboard up, the tray must still fit (С1), part 2.

## How it was built and proven

- **Files:**
  - new: `shared/SearchField.tsx` (`SearchField`);
  - `sales/StockSearch.tsx`: a model's tag, `SizeCell`, the search; what
    the basket or the order holds of each cell, asked of its screen
    (`chosen`);
  - `sales/Sale.tsx`: no warehouse chosen — one sold from, two or more
    all listed, none said; «Склад: X» under a basket line and on the
    receipt; `sales/basket.ts`: a kept basket no longer keeps a warehouse
    chosen;
  - `orders/NewOrder.tsx`: «×N» of what the order holds, «у замовленні»;
  - `shared/panel.ts`: `usePanelRoom` keeps the room it is told
    (`--find-h` for the search, read by `scroll-padding-top`);
  - `shared/Placeholder.tsx`: the tags being read; `shared/Icon.tsx`: 12
    for a badge;
  - `styles.css`: the tag, the cell and its badges, the search; the bottom
    menu on its own layer of the design system (§5.7), over the search —
    it was at 3, under the search's 10; `.tag` and its head gone;
  - new journeys: `e2e/till-cells.spec.ts`; `e2e/fixtures.ts`: `sellsFrom`,
    a store selling from one warehouse of its list, the rest left as they
    are but not sold from.
- **Journeys** (`till-cells.spec.ts`, the goods and the sale's answer
  stubbed, the store selling from its till's warehouse alone):
  - a tag: its name and price, then a cell per size, 60 × 60 at least, the
    letter, what is free, the pin of what orders hold;
  - every unit held: dashed, «у резерві», a tap puts nothing in the
    basket; from paper it does;
  - a tap: «×1», then «×2», the cell's name saying so; the line's «Склад:
    Каса-склад»; the line taken away, the cell as it was;
  - «?» tapped, its label read as M: «×1» moves to M, and a tap on M makes
    the same line two;
  - a size not known: «?», and «? — розмір невідомий»;
  - the search: its placeholder, its name read aloud, 52 high, the
    keyboard's key a search's; «×» empties it, the cursor kept;
  - the search at the top while twelve tags scroll under it, the page
    keeping its height clear;
  - where the menu covers the search, the menu's tab is what a finger
    meets, and opens «Замовлення»;
  - no warehouse to sell from: said so, no search;
  - the receipt's «Склад: Каса-склад» under its lines;
  - in the light and the dark theme, every word of a cell at 4.5:1.
- **Journeys changed:** every journey that chose a warehouse at the till
  sells from one through `sellsFrom`; the chips' names are the cells'
  («M, вільно 2»); `till-two-warehouses.spec.ts` reads a cell per
  warehouse and the lines' «Склад: X», and loses its two journeys of one
  warehouse looked at alone; at 360 a 58-letter warehouse name is cut, its
  count drawn whole in the cell, the page no wider than the screen;
  `till-search.spec.ts`'s warehouse stopped from selling: its cells gone,
  never shown while the one left is read, the next tap from the one left;
  `orders-new.spec.ts`: a cell with all that is free in the order dimmed
  and read aloud «у замовленні 3»; its search not held at the top.
- **Proven to catch**, each broken once, its journeys run, then undone:
  - a cell all held, tappable: its journey fails;
  - the menu back at its old layer: the menu's journey fails;
  - a tap's coat from the first row's warehouse: four of
    `till-two-warehouses.spec.ts` fail;
  - the receipt without its «Склад»: its journey fails;
  - no «×N»: four fail, the two contrast journeys among them;
  - «×N» counted by the balance taken from: the label's journey fails;
  - a cell with no room not dimmed, or read «у кошику» in an order: the
    order's journey fails;
  - the tags' track as wide as a cell asks: the long name's fails;
  - no room kept at the top: the search's fails.
- **Journeys:** 740.

## Review

An independent review of the uncommitted tree found no wrong warehouse, no
state lost and nothing persisted broken: a basket lives in memory, so no
kept basket held the warehouse chosen; every class removed was used
nowhere else; the badges inside the tag's padding; each tap from the
cell's own warehouse; the receipt's place right for a sale from two. It
found, fixed before the commit:
- **«×N» on the wrong cell:** it counted by the balance a coat was taken
  from, while a tap adds to the line by its size; a «?» read as M showed
  «×2» on «?» after a tap on M. Counted as a tap adds now, with a journey.
- **The «×» 8 px above the field's middle:** the till's band and the field
  were one box. The band wraps the field now.
- **A cell with no room looked live:** dimmed now, as the chip was, with a
  check in the order's journey.
- **The search stuck over the order's form**, and over the basket's fields
  at the till with no room kept for a field in focus: only the till's
  sticks, and the page keeps its height clear at the top.
- **A long warehouse name hid the count** — and, run, the tag grew past the
  screen: the name is cut, the count kept, the tags no wider than the
  screen; a journey at 360.
- **«у кошику» read aloud in an order:** «у замовленні».
- **Journeys weaker than their titles:** the warehouse stopped from selling
  now sees its cells go, and nothing of the old list while the new one is
  read; the two warehouses checked at 360; the menu's journey measured at
  the width it is looked at.

Before the review, the run of the journeys changed found the search drawn
over the bottom menu (two journeys could not press «Продаж» and «Ще»):
the menu stood at layer 3, the search at the design system's 10. The menu
is at its own 30 now, with a journey.

## Evidence

- Locally on `feat/till-cells`, against the E2E API and PostgreSQL 17, on a
  fresh seed:
  - all 738 journeys before the review: 737 passed; `backups.spec.ts`
    finds more nights than it expects, the local seed only adding, as
    before;
  - after the review's changes, all 740 journeys again: 739 passed,
    `backups.spec.ts` as before;
  - each mutation above, run and undone: the journeys named fail;
  - the throwaway screenshots at 360 × 640, light and dark: the tags, the
    pin, the dashed held cell, «×1», a cell per warehouse, the search with
    its «×» centred, «Склад: …» under the line;
  - eslint, tsc and the build are clean: app 513.23 kB, parts 2.61 kB,
    icons 6.56 kB, vendor 210.85 kB; past the 500 kB warning, as before.
- **CI:** GitHub Actions on the pull request.

## Not covered here

- **On a real phone** (С6): the cells under a thumb, the search's «×».
- **Part 2:** the pay tray (§6.15), the basket sheet (§6.16, S10,
  `shared/Sheet.tsx`, Telegram's «Назад» through `addBackWay`), the search
  in focus on opening, 360 × 640 with the tray (С1), «Готово» on the
  keyboard for a price and a quantity (`enterkeyhint`).
- **Part 3:** the shortage as a sheet, «Вношу продаж з паперу» as a switch
  row, the taps counted (3 for a priced coat, 5 in parts).
- **In dark, the tags sit on the till's card:** with no hairline in dark,
  only the gap tells one tag from the next until the till's page is the
  paper (S08, part 2).
- **The line «{колір} · {вид}»** waits for the catalogue's own fields.
- **The app's own file past 500 kB:** still to choose.
