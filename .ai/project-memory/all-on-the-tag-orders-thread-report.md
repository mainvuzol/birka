# «Усе на бірці», «Замовлення»: the thread, the card, «Відправити» — 2026-11-01

Baseline: `1e41803` (#161, on main), and the sections task list
([P0-1, P0-2, P0-3](redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md),
their decisions and acceptance), with the spec's S16, S17, S18, §6.9 (the
tag row), §6.18 (the sticker), §6.24 (the order string), §6.29 (the sheet)
and §4.4 (Telegram's MainButton and popup).
Status: built, reviewed and proven on this Mac; evidence below. CI is
GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/orders-thread`. Tasks: the sections task list's P0-1, P0-2
and P0-3, one batch (chosen in chat, 2026-11-01).
Chosen: business-rules.md, "Chosen in chat — 2026-11-01 («Замовлення»
thread, card, send sheet; sections P0-1..P0-3)".

Sending a parcel was five taps — the list, the order, the field over the
panel, «Відправлено» — with «Відправлено» and «Прибув на пошту» in one
group «В дорозі», and nothing said which warehouse to take the goods from;
on a call «вона вже забрала?» the card was a long column with a pill, and
the waybill could not be copied. Now the list is the string of places
itself, those to be sent grouped by their warehouse, each row a tag whose
next step is its verb; the card shows where the parcel stands on its
string with its days, what is in it, the waybill to copy, and its next
step on Telegram's MainButton; «Відправити» is a sheet with the waybill's
field in focus. Nothing changes on the server.

## What exists now

- **The list (S16):** under the heading and «+», the waybill's search as
  before, then the string «До відправлення 3 · Відправлено 2 · Прибув на
  пошту 2 · Клієнт забрав» — four knots of 44 in one row, the chosen a
  ring, each place in its colour (`online`, `transit`, `transit`, `paid`),
  its count under its word once every open order is read, a selection buzz
  on a change and none on a scroll. A place a list, newest first; a row a
  tag (76): its eyelet filled, a ring or a knot, its goods, «Нова пошта ·
  ТТН … · з 21.10», no sum, no way, no «№»; a sticker only under «Клієнт
  забрав» and in «Скасовані й повернені на склад», their own screen from a
  link under «Клієнт забрав». Those to be sent stand under «Склад «X» · N»
  and «З кількох складів · N» for whoever reads the stock. Each open row's
  verb: «Відправити» (the card with its sheet, the field in focus in the
  same tap), «Прибув на пошту» (recorded from the row, «Прибув на пошту:
  {товари}»), «Клієнт забрав» (the card with the sheet of ways); a tap
  within 0.7 s of the list changing is let go. A waybill searched hides
  the string; found rows carry stickers. Empty: «Тут посилок немає.».
- **The card (S17):** «← До замовлень», the goods as the title, «замовлено
  13.10 · № {8}»; the string with «До відправлення»'s day and the last
  sending's under «Відправлено», the place passed filled, the one it
  stands at a ring, those to come hollow; collected, the last knot tied;
  cancelled or come back, a sticker under it. «У посилці» — the lines with
  «склад «X»» where it is read — and «Разом»; «Товар у резерві — на касі
  його не продадуть.» while it waits; «Доставка» — how it goes, the
  waybill as written, «Скопіювати ТТН» (44, «ТТН скопійовано» and a buzz);
  «Історія доставки ›» folded. The next step is Telegram's MainButton —
  «Відправити», «Прибув на пошту» (turning while it is asked), «Клієнт
  забрав» — in the app's colours; outside Telegram the dock's one button.
  «Скасувати замовлення» asks in Telegram's own popup from 6.2 («Так,
  скасувати» destructive), in the page before.
- **«Клієнт забрав — як оплачено?»:** a sheet over the card — «Разом» or
  «Зараз … · винен …» large, the line «Продаж записуємо, коли покупець
  забрав товар.», the two rows of ways, nothing chosen, each the step
  itself; «Оплата частинами» under them. The MainButton is put away while
  it is open. Collected, «Продаж записано» as before, focused.
- **«Відправити» (S18):** a sheet over the card — «У посилці: Кокон графіт
  · M · склад «Основний»», «Номер ТТН (можна дописати пізніше)» in focus
  (Enter puts the keyboard away), «Пишемо як є — з Новою поштою не
  звіряємо.» for Нова пошта; abroad, its own words and «Без імен і
  телефонів покупців.»; the MainButton «Відправлено», always pressed — an
  empty field sends it without one — turning while it is asked. Telegram
  asks before closing while the field holds anything; its «Назад» closes
  the sheet. Recorded, the sheet closes and the card says what it did; a
  waybill another order has — recorded, a warning buzz, the approved block
  under the field, «Готово». Refused, why over the field, focused, what
  was typed kept; refused as the order moved on, the sheet closes and the
  card says what it is now.

## Decided here, not by the owner

Recorded in business-rules.md, "Chosen in chat — 2026-11-01 («Замовлення»
thread, card, send sheet; sections P0-1..P0-3)":
- **The card's line without the store:** «замовлено 13.10 · № …»; the
  screen's line already says «{Магазин} · {Ім’я}».
- **«Пишемо як є…» for Нова пошта only**; other carriers get no line.
- **The row's «Прибув на пошту»** keeps the list and says «Прибув на пошту:
  {товари}».
- **A copy refused** says «Не вдалося скопіювати — виділіть ТТН і
  скопіюйте її.», as the way in's ID; no buzz.
- **A duplicate waybill buzzes `warning`**, not `success`.
- **A step's sheet closes** in the render that says what came of it —
  recorded, kept, or refused as the order moved on; any other refusal
  keeps it.
- **The day under «Відправлено»** once the order stands there or past it.
- **Taps:** an order sent or at the post office is one knot further than
  before — a waybill written later five taps, goods come back seven,
  «Клієнт забрав» four by the row's verb, as the task list's scorecard
  counts it.

## How it was built and proven

- **Files:**
  - `frontend/src/orders/Knots.tsx` (new): the places, the filter, the
    card's string, the sticker;
  - `frontend/src/orders/Orders.tsx`: the thread, the tag rows and their
    verbs, the warehouses' groups, the cancelled's screen;
  - `frontend/src/orders/Order.tsx`: the card's sections, the copy, the
    folded history, the MainButton or dock, the cancel's popup;
  - `frontend/src/orders/Send.tsx`, `Collect.tsx` (new): the two sheets;
  - `frontend/src/App.tsx`: the sheets over the card, kept apart from it
    so what was typed survives a read; `run` closes them with their
    outcome; a step from a row keeps the list;
  - `frontend/src/shared/telegram.ts`: the MainButton's turning, `shown`
    and `active`; Telegram's popup, one at a time; a sheet's «Назад» over
    the screen's;
  - `frontend/src/shared/Sheet.tsx`: its way out `over`;
  - `frontend/src/cash/errors.ts` (`movedOn`), `orders/types.ts`
    (`placesKey`), `orders/Returned.tsx`;
  - `frontend/src/styles.css`: the knots, the tag rows, the stickers, the
    card's sections, the sheets.
- **Journeys:**
  - **rewritten:** `orders-list.spec.ts` (17) — the string as the filter,
    its colours, counts and buzz; the warehouses' groups, read late too;
    the row's «Прибув на пошту» with its carried tap, refusal and kept
    answer; «Відправити» and «Клієнт забрав» from a row, Telegram's
    «Назад» over a card read after the sheet; the search; past a hundred,
    nothing counted or said empty before all are read; the empty and
    failed reads; the cancel in the page and in Telegram's popup, asked
    once; both themes at 360 px; `orders-card.spec.ts` (51) — the card's
    sections, the copy and its refusal, the folded history, the MainButton
    and the dock, the two sheets with their refusals, closing, «Назад»,
    Enter and abroad, the same waybill, the carried presses — after a
    step, as the sheet opens and after «Готово» — and two presses before
    the first is drawn;
  - **changed:** `orders.spec.ts`, `order-shipping.spec.ts`,
    `credits.spec.ts`, `orders-new.spec.ts` — the steps through their
    sheets, the place on the string for the pill, the history unfolded;
    `telegram-back.spec.ts` — a sent order's row under «Відправлено»;
    `order-shipping.spec.ts`'s waybills this run's own: the shared
    database keeps the runs before, and one of their waybills is now said
    as one parcel's, the sheet kept.
- **Mutants:** 40, each applied alone and its journey run; all 40 fail
  it. One first passed and was mended: the guard that keeps one list when
  a line's warehouse is not read, taken away — the order then vanished
  from the list, and no journey had a line from a warehouse not read; the
  warehouses' journey now has one. Nine are the review's fixes, below;
  three what the screenshots showed.

## Review

An independent review of the whole change found two serious defects and
six smaller ones; all fixed, each with its journey and its mutant.
- **Fixed:**
  - a tap carried from «Готово» onto the card's «Прибув на пошту», under
    the same finger, recorded the arrival — the card lets a press go for
    0.7 s after its sheet closes too, as after a step;
  - Telegram's «Назад» left the card — and what was typed — when the card
    was read, or mounted afresh, after its sheet came: a sheet's way now
    stands over the screen's, whenever that came;
  - past a hundred open orders, a place none of the first page was in said
    «Тут посилок немає.» over «Показати ще», and a warehouse's heading
    counted the first page — neither now until all are read;
  - the rows put under their warehouses, the warehouses read after the
    list, were not the list changing: a tap meant for one row's
    «Відправити» could open another's sheet — they are now;
  - two presses of «Відправлено» before the first was drawn closed the
    sheet while the first was asked: a second press does nothing now;
  - a double tap on «Скасувати замовлення» opened Telegram's popup twice:
    one at a time now;
  - the card's MainButton stayed pressable, doing nothing, while another
    operation was kept: held now, as the dock's button is;
  - after «Відправлено» the cursor fell to the page: it is on what the
    step did now.
- **Not a defect:** the reviewer read `Send.tsx` while a mutant
  (`progress: false`) stood in it.
- **Kept, and said:** the sheet's own MainButton held while another
  operation is kept has no journey of its own.

## Seen in the screenshots

At 360 px the string's words did not fit their quarter of the row: on the
list «Відправлено» ran into «Прибув на» and its count stood over
«відправлення»; on the card, whose text breaks anywhere, «Відправле / но».
The journeys read the contrast and the page's width, not one word over
the next. Each column is now at least its longest word — the filter's 44
no floor for it — the words never broken, what is left shared; narrower
than 360 a word breaks rather than push the page sideways. Both theme
journeys now check the four words stand apart and «Відправлено» stands on
one line. With it, a collected row's shape class `knot`, which took the
string's knot rules too, is `tied`.

Two more, smaller:
- **A tied row's loop** ran into its title: the eyelet's loop is drawn
  14 px to its right, the title 8 px after it. On a tag row it now hangs
  under the eyelet, in the row's margin — the titles of every shape kept
  in one column, as a search mixes them; the cancelled screen's journey
  checks each loop ends before its title. A choice of drawing, for the
  designer (below).
- **«Клієнт забрав»'s sheet** showed «Оплата» bare under its ways, over
  «Оплата частинами»: the card's legend, moved with the terms into a
  sheet that asks «як оплачено?» already. Read, not shown now; the terms
  stand 20 px under the ways.

## Evidence

- **Full run** on a fresh seed, on this Mac, after the review's fixes:
  827 of 830 journeys passed (16.2 min). The three failures:
  - `backups.spec.ts:78`, which fails only on this Mac, as on main;
  - `telegram-back.spec.ts:139` and `:383` still looked for the sent
    order's row on the list as it opens — it opens at «До відправлення»
    now; they step to «Відправлено» first: 6 of 6.
- **After the full run:** the knots' words, the loop and the legend
  (above) — the seven specs that draw them, 131 of 131: the five stubbed
  on the final code, the two that make real orders (`orders.spec.ts`,
  `order-shipping.spec.ts`) 18 of 18 on a fresh seed — the shared
  database's stock was held by the runs before («вільно 0»).
- **Before it:** the six order specs, 122 of 125 — the three failures the
  shared database's waybills, above; `order-shipping.spec.ts` then 7 of 7
  on a fresh seed, and 7 of 7 again on the same database.
- `tsc -b` and `eslint .` clean; the build passes — its main chunk
  561.71 kB, with main's warning over 500 kB.
- Screenshots in both themes at 360 px, after the fixes: the list, the
  card, «Відправити», «Клієнт забрав — як оплачено?», the cancelled and
  come back.

## For the owner

Each built as said until answered (business-rules.md, "Chosen in chat —
2026-11-01"):
- the card's line «замовлено 13.10 · № …» without the store;
- «Пишемо як є — з Новою поштою не звіряємо.» for Нова пошта only;
- the row's «Прибув на пошту» says «Прибув на пошту: {товари}» and keeps
  the list;
- a copy refused: «Не вдалося скопіювати — виділіть ТТН і скопіюйте її.»;
- an order sent or at the post office one knot further than before: a
  waybill written later five taps, goods come back seven;
- for the designer: a tied row's loop hanging under its eyelet, where
  «Сьогодні»'s is drawn beside it.

## Not covered here

- **A real phone:** the MainButton, the popup, the copy and its buzz, the
  keyboard rising with the sheet, inside Telegram (С1).
- **«Нове замовлення»** in the new system: as it is (stage 2).
- **The rest of the sections task list:** «Покупці» (P0-4, P0-5), the
  model's detail (P0-6), «Гроші» (P0-7), «Каса» (P1-1…P1-3), «Прийшов
  товар» (P1-4) and the rest.
