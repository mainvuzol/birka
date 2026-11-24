# «Усе на бірці», audit 2026-11-23, batch 2: the small points — a result's title a heading; one form for the phone's unread memory; the other stores' switch keeps the field still; «Кошик порожній» under tags only; a take-out's refusal by its sum; the order's day kept with its word; a closed store's invoice says who pays; a similar name said once; a cell's tap felt — 2026-11-24

Baseline: `c583ce11` (main after #246).

Points: frame P2-2, frame P2-3, sale P2-1, sale P2-2, orders-cash P2-1
(`financial-integrity`: its place only), orders-cash Д1, Д2, money P2-2,
goods P2-1 (catalogue identity: where it is said only), goods P2-2.

The user's pick after audit 2026-11-23: «Both batches, money first» —
batch 1 merged as #246; this is the second and last of the pick.

No right, check, journal or step changes; nothing recorded or sent
changes; no server change, no migration.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1271 (four new, fifteen extended).
- Branch: `feat/audit-1123-small`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-24 (audit
  2026-11-23, batch 2: the small points …)".

## What exists now

- **A result's title is a heading** (frame P2-2): «Продано N шт.» and
  «Повернено постачальнику «…»: N шт.» on «Позичене» are `h3`, as
  «Оплату записано»; focus, what it is heard with and look as before.
- **One form for the phone's unread memory** (frame P2-3): the order's
  line «…збережену операцію із замовленням. Не очищайте дані застосунку;
  зверніться до менеджера.»; «Створення операцій зупинено.» once, the
  plate's last line — where it is so (below, review).
- **The other stores' switch** (sale P2-1): in «Повернути» the eye goes
  to «В інших магазинах мережі» and back to «Продаж», after a tap only;
  in «Внесок» and «Покупці» the closed stores' head stands under the
  field, which never moves.
- **«Кошик порожній — знайдіть модель угорі.» under the models alone**
  (sale P2-2): never under a blank tag, an unread list's plate (the next
  page's too) or the rows' places.
- **A take-out's refusal by its sum** (orders-cash P2-1): over the keypad
  in «Видати з каси» and «Внести в касу», its top brought into view, the
  cursor in the sum; it stays while the sum is mended, the keys still.
- **The order's day kept with its word** (Д1): «замовлено 13.10» by a
  no-break space on the card; the drawer's comment says what its answer
  carries (Д2).
- **A closed store's invoice says who pays** (money P2-2): «Накладна
  магазину «Старий» (закрито). Сплачуєте ви, борг — за «Старий».» on the
  card and the payment, one component; the tag's line «за продане
  позичене: …» lower-case.
- **A similar name said once in «Нова модель»** (goods P2-1): its block
  alone, brought into view; a kept operation's refusal keeps its plate.
- **A cell's tap in «Виправити залишок» felt** (goods P2-2): `selection`;
  a held cell, nothing.

## How it was built and proven

Sources:
- `frontend/src/suppliers/Borrowed.tsx` (`h3`), `frontend/src/styles.css`
  (its top margin, where the paragraph's was).
- `frontend/src/App.tsx` (`unreadKept`: the order's line, the last line,
  `everyScreenHeld`).
- `frontend/src/returns/Returns.tsx` (`switched`, the two headings'
  refs), `frontend/src/credits/Credits.tsx` (the head after the form).
- `frontend/src/sales/StockSearch.tsx` (`hint`, drawn with the tags),
  `frontend/src/sales/Sale.tsx` (passes it; its own copy gone); not under
  the next page's plate (`nextFailed`).
- `frontend/src/cash/Move.tsx` (the refusal before the keypad; `told`:
  scroll, then focus without scrolling, once it is drawn; the keypad's
  `change` leaves it).
- `frontend/src/orders/Order.tsx` (no-break space ×2),
  `frontend/src/cash/Cash.tsx` (comment).
- `frontend/src/suppliers/OtherStoreInvoice.tsx` (new),
  `frontend/src/suppliers/Invoices.tsx`, `InvoicePay.tsx` (use it),
  `frontend/src/suppliers/InvoiceTag.tsx` (lower-case).
- `frontend/src/catalog/NewModel.tsx` (`similarAlone`),
  `frontend/src/catalog/Similar.tsx` (`inView`).
- `frontend/src/inventory/Model.tsx` (`buzz("selection")`).

Journeys:
- New:
  - `outage`: one kept sale unread — its line, then «Створення операцій
    зупинено.»;
  - `cash-move-fix`: a manager's take-out (three chips, «Коли?») and
    pay-in refused at 360 × 640 — the refusal over the keys, by the sum,
    both in view, the cursor in the sum;
  - `model`: inside Telegram, «Виправити залишок»'s held cell felt as
    nothing and opening nothing, the free cell `selection_change` and its
    form;
  - `outage`: a seller with `catalog:confirm` and a kept sale unread — its
    line alone; the order's journal unread too — the last line.
- Extended:
  - `borrowed`: «Продано 2 шт.», «Продано 1 шт.», «Повернено
    постачальнику «…»: 2 шт.» as level-3 headings, focused as before;
  - `outage`: the three journals' plate in one form, the last line;
    the till's unread list without «Кошик порожній»;
  - `stores`: the store state journal's line alone — the owner opens
    «Перевірка каталогу», which that journal does not hold;
  - `returns-list`: focus to the caption and back to «Продаж»; the field
    emptied to one letter keeps the cursor;
  - `credits-list` («Покупці») and `credits-debt` (the till's
    «Внесок»): at 360 × 640 the field still (±1 px), the caption under it
    and focused; back, «Продаж» focused;
  - `till-first-days` (nothing on the warehouse; «ябко»),
    `till-two-warehouses` (×2): no «Кошик порожній» under the blank tag;
  - `cash-move-fix`: the seller's refusal at 360 × 640 over the keys, and
    kept through «Стерти» and «0», the keys where the finger left them;
  - `till-search`: the next page refused — «Кошик порожній» gone while its
    plate stands, back once the page is read;
  - `orders-card`: «замовлено 13.10» with a no-break space;
  - `supplier-invoices`: the closed store's plate's new words on the card
    and the payment; its lines at 360 in both themes no more than the old
    words' and three at most; the tag's lower-case line;
  - `models`: «Нова модель»'s similar name — no plate, one alert, the
    block in view at 360 × 640; words changed after it — no plate either;
    a kept operation's refusal — its plate and its block (goods Д3).

Runs on the stand (seed of 2026-11-24, the Mac held awake):
- The 16 specs that read the touched screens (`supplier-invoices`,
  `borrowed`, `outage`, `stores`, `returns-list`, `returns-elsewhere`,
  `credits-list`, `credits-debt`, `till-first-days`,
  `till-two-warehouses`, `till-search`, `till-money-words`,
  `cash-move-fix`, `orders-card`, `models`, `model`): 506/508 — both in
  new checks: the correction's form is its own sheet with «Причина», not
  radios; the closed store's plate takes three lines (below). Both
  passed once fixed.
- CI runs all 1270.

Mutants (mutate90, each against its journey): 22/22 caught, after two
journeys were made to prove what they first did not; after the review
30, the 15 it touched run again — 15/15 caught.
- Heading: «Продано» and «Повернено постачальнику» a paragraph again.
- The plate: the order's old words; no last line; the last line first.
- The switch: «Повернути»'s focus gone; its focus moved on the field
  emptied too (first survived: the check ran before the field settled —
  now after this store's list is read again); the closed stores' head
  over the field in «Покупці» and in «Внесок».
- «Кошик порожній»: under the blank tag; gone from under the tags.
- The refusal: under the keypad, the seller's and the manager's; not
  brought into view (first survived: the sheet stood at its top — the
  manager's journey now presses with the sheet at its end, «Коли?»
  looked at, and asks the refusal whole in view).
- Д1: a plain space. Money P2-2: the plate's old words; the tag's
  capital.
- The similar name: the plate again; the block not brought into view; a
  kept operation's refusal without its plate.
- The cell: felt as nothing; a held cell felt.
- After the review: the last line always — for a seller who opens
  «Перевірка каталогу», for the owner; never with the order's journal
  unread; never where the check is not open; «Кошик порожній» under the
  next page's plate; the refusal gone at the first key; the cursor not
  put back; a kept refusal without its block; and the first round's
  last-line, hint and refusal mutants on the new code.

## Review

An independent review of the batch found:
1. **The keys moved under the finger after a refusal** (Medium): the
   keypad's first press took the refusal away from over it. Fixed: the
   refusal stays while the sum is mended, as the count's; the next
   «Видати»/«Внести» or another chip takes it away.
2. **Scroll and focus could run before the refusal was drawn** (Medium /
   Low): one animation frame after `setProblem`. Fixed: an effect on a
   `told` counter, as «Внесок»'s.
3. **«Створення операцій зупинено.» not always so** (Low): «Перевірка
   каталогу» is held by its own journal and the order's alone, and it is
   open to everyone with `catalog:confirm`, sellers too. By the frame TZ's
   Д3, decided there: the last line stands for a person who cannot open
   that check, or with the catalogue's or the order's journal unread. A
   seller's one unread sale is its line alone where the check is open.
   What is held unchanged — whether every journal should hold the check
   is the owner's reading.
4. **Docs**: the TZs' «Построено» lines; «Скасовані й повернені на склад ›»
   without «· N» recorded (orders-cash §12).
5. **Goods Д3**: a kept operation's refusal keeps its plate and its
   block, as before — what was not recorded, and what to take.
6. **The hint under the next page's plate** (Nit): not any more.
7. Not taken (Nit): no positive two-warehouse hint check (the blank tag's
   ×2 hold its absence; the TZ's Д5 rules are the same condition);
   «заблоковано» on the closed store's invoice plate is drawn by the same
   branch as «закрито»; the dark theme for «Покупці»'s caption and the
   similar block — no colour changed.

Runs after it (the Mac held awake): `cash-move-fix`, `till-search`,
`outage` 193/195 — both in the new checks' own making: Playwright scrolls
a key half under the screen's edge into view before it taps, so its box
is now taken where the finger finds it; the open app writes its order
journal back as it leaves, so the order's unread entry is now written
with the app closed. Then those two and `stores` 16/16; `models`,
`till-first-days`, `till-two-warehouses` 57/57. `tsc`, `eslint`, the
build clean.

## Recorded, not met

- **The closed store's plate in two lines** (money P2-2): the TZ asked two
  lines at most at 360 × 640. Measured with 274 px of text: the new words
  three lines, the old ones three, the debt's twin («Продано в «Старий»
  (закрито). Внесок приймаєте ви, борг — за «Старий».») two. The TZ's
  words kept — who pays is now plain — and no shorter words made up; the
  journey holds it to no longer than before and three at most. To reach
  two lines the words must change: a reading for the owner.

## Left

- Owner-held: В23-К1; money P2-5 (Д4, В22-Г1); goods P2-3 (б) (В22-Т1 /
  Н2); goods P2-5 of 2026-11-20 (В20-Т1).
- A reading for the owner: should every journal unread hold «Перевірка
  каталогу», so «Створення операцій зупинено.» stands always?
- Screenshots at 360 × 640 in both themes — a separate stand, on the
  user's yes.
