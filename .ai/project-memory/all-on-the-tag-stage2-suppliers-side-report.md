# «Усе на бірці», stage 2's fifth batch: the suppliers' side — «Постачальникам» as rows, «Повернути постачальнику» a task screen, «Позичене й під реалізацію» a screen of tags, the ways between them — 2026-11-06

Baseline: `b2a07d14` (#173, on main), and three points of the stage-2
money task list ([P0-4, P0-5, P1-3](redesign/2026-11-05-redesign-tz-stage2-money.md)),
their decisions and acceptance.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-suppliers-side`. Task: the fifth batch proposed after
#173 (chosen in chat, 2026-11-06, «Suppliers' side»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-06 (stage 2 batch 5:
…)". The owner's questions stand by their (а): В2 («Позичене й під
реалізацію» for whoever returns to suppliers; «Продано» for whoever keeps
the invoices) and В7 (a mark of sold opens a sheet with how many and the
price for each).

Where the suppliers' side still did its own way:
- «Постачальникам» began with a three-line hint and «+ Повернути товар
  постачальнику»; a new return unfolded inside the list, with two native
  lists and a field of numbers for each size; «Пошук моделі» searched only
  the hundred rows read, «Наступні товари» for the rest.
- Each return was a card of about five lines, its cancel unfolding in the
  list; «Позичене» stood whole under twenty of them, and «Список
  постачальників» unfolded under that.
- «Позичене» had a number field and two buttons on every lot; «Продано»
  recorded a debt in one tap, the price only in the line under it. It had
  no row anywhere, and nothing led from a return or a lot to its invoice.

## What exists now

- **«Постачальникам» (money P0-4):** «+» and «Оновити» in the head, the
  supplier's field, a row each return — the supplier, «N шт.», «DD.MM ·
  склад «X» · {хто}», two of its goods and «+ ще N», «Скасовано» and
  «Зараховано {сума}» as stickers —; «Позичене й під реалізацію ›» and
  «Список постачальників ›» under them; the empty state with its blank
  mark.
- **The return's screen:** the supplier its title, when, where from and
  who; its goods and note; each set-off with «Відкрити накладну ›»; quiet
  at the bottom «Скасувати повернення», a sheet asking why — or, while a
  set-off stands, why it cannot be.
- **«Повернути постачальнику»**, a task screen after «Прийшов товар», the
  menu aside: the warehouse said in a line or as chips, none chosen; the
  supplier's field, the cursor then in the search; the till's search,
  the server's, over that warehouse; a model's sizes as steppers with
  «вільно N» the most; «Додати ще модель», «У поверненні»; the MainButton
  «Повернути постачальнику · N шт.»; the stub, «Готово».
- **«Список постачальників»**, a screen: the search, a row each with its
  phone, «Змінити постачальника» in a sheet; none deleted.
- **«Позичене й під реалізацію» (P0-5)**, a screen of its own: «На руках ·
  Усе»; a tag a lot, filled while some are in hand, knotted once none are,
  «Продано» its verb; the lot's sheet: «− 1 +», «Позначити проданим · N
  шт.» with «{ціна} за шт.» under it, quiet «Повернути постачальнику · N
  шт.»; the stub, «Відкрити накладну ›» for a sale; a kept mark or return
  of a lot its stub here.
- **The ways (P1-3):** «Ще» › «Гроші» holds «Постачальникам» and
  «Позичене й під реалізацію»; a return's set-off and the sold stub open
  the invoice's card, «← Повернення» or «← Позичене й під реалізацію» back;
  the sold invoice's card opens «Позичене», «← Накладна» back.
- **What every command sends is as before:** the same journal, body and
  command id; every sum the server's.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- **«Постачальникам»:** with a supplier chosen and nothing to show,
  «Постачальнику «{Назва}» цей магазин ще нічого не повертав.» (the task
  list names only the store's own); «Зараховано {сума}» the sum of the
  set-offs standing.
- **The return's screen:** read again as it opens by its supplier's
  returns, fifty at most, there being no read of one return; the cancel's
  question says «у «Брак» «X»» for a unit from «Брак»; refused, the sheet
  goes and the words are on the screen; no answer, they stay in the sheet.
- **«Повернути постачальнику»:**
  - another warehouse chosen is another return: what was counted goes;
  - «Тут немає складу, з якого повертають.», «На складі «X» немає
    вільного товару.», «За «…» на складі «X» вільного товару немає.»;
  - «Оберіть постачальника.», «Такий рядок уже в списку. Приберіть його,
    щоб змінити кількість.», «В одному поверненні — до 100 рядків.
    Поверніть ці, а решту — окремим поверненням.»;
  - what is counted joins «У поверненні» as it is sent, so a refusal
    keeps it.
- **«Список постачальників»:** «Постачальників ще немає.» and «Нового
  додають у полі «Постачальник» — там, де його обирають.»
- **The ways:** «← Повернення» (read «Назад до «Повернення»») back to that
  return, read again; «← Накладна» from «Позичене» back to the sold
  invoice's card; an invoice not found among its supplier's fifty newest
  opens that supplier's invoices, every one.
- **From the review:** each way held as the row of the screen it opens, as
  that row is now; a return opened again once; a chosen warehouse stays
  chosen when the warehouses are read again; a cancel shown from the
  server's answer; the lot sheet's «На руках» as read again; an opening's
  read never replacing a newer card; the list's heading taking the cursor
  on the way back.

## How it was built and proven

- **Files:**
  - `frontend/src/suppliers/Suppliers.tsx`: «Постачальникам» — the head,
    the filter, the rows, the ways, the screens' order;
  - `frontend/src/suppliers/NewReturn.tsx`: «Повернути постачальнику»;
  - `frontend/src/suppliers/ReturnDetail.tsx`: the return's screen and its
    cancel;
  - `frontend/src/suppliers/SupplierList.tsx`: «Список постачальників» and
    its sheet;
  - `frontend/src/suppliers/returnWords.ts`: a return's words, shared by
    the three and by the kept stub;
  - `frontend/src/suppliers/Borrowed.tsx`: «Позичене й під реалізацію», its
    tags, its sheet, its stubs;
  - `frontend/src/suppliers/Invoices.tsx`: an invoice opened from
    elsewhere, its «←» back there, «Позичене й під реалізацію ›» on the
    sold one's card; `InvoiceActions.tsx`: the cancel sheet and the words
    shared;
  - `frontend/src/App.tsx`: «Позичене» a section, its rows in «Ще», where
    a kept operation of a lot belongs, the ways and their way back;
  - `frontend/src/inventory/Receive.tsx`: the hint's screen name;
  - `frontend/src/styles.css`: the rows, the return's screen, the
    steppers' «вільно», the lots' tags and sheet.
  - No backend change: every read and command is the one before.
- **Journeys:** 939 in all (930 after #173).
  - **9 new:**
    - a model found by the server's search over the warehouse chosen, from
      two letters, two warehouses as chips, none chosen; one letter never
      asked of the server (from the review);
    - two sizes of a model back in nine taps from «Ще» where one warehouse
      takes returns, ten where two do; no native list, no form unfolding
      on «Постачальникам»;
    - the light and the dark theme at 360 × 640: a return's row, its screen
      and «Повернути постачальнику» at 4.5:1, nothing wider than the phone;
    - nothing borrowed: the blank tag, what is so, what these goods are;
    - a kept return of borrowed goods is «Позичене»'s: its stub there, a
      banner on «Постачальникам»;
    - one borrowed jacket marked sold in four taps from «Ще», nothing
      scrolled, the price in the sheet before the press;
    - the light and the dark theme at 360 × 640: «Позичене»'s tags and a
      lot's sheet at 4.5:1, nothing wider than the phone.
  - **Rewritten:** `suppliers` (the return made, refused, recorded, its
    row, its screen, its cancel in a sheet, «Список постачальників» and
    its sheet; goods held for an order; one supplier never written twice;
    the filter; a unit from «Брак»; a lost answer) and `borrowed` (taken,
    marked sold, sent back, a mistaken «Продано» undone, the seller's
    rows, a lost «Продано»).
  - **Edited:** `supplier-invoices` (the set-off seen on the return's row
    and screen, its invoice opened from it and back; and, from the review,
    the way back held while a payment's answer is unknown, and the return
    opened once), `suppliers-pages` (the returns' rows, the lots' tags),
    `money` and `till-sections` (the two rows in «Ще» › «Гроші»),
    `outside-text` («Список постачальників» a screen).


## The independent review

An agent read the change cold (2026-11-06). It found nothing recording
money or stock twice or wrongly: each command id made once per send, a
resend only through the journal, the forms held while one is pending; a
unit from «Брак» cancelled through «Брак»; the steppers held at what is
free or in hand, typing too; the duplicate line and the hundred lines as
the server takes them; the rights by В2 (а). What else it found, and what
was done:
- **Fixed:**
  - **The ways not held:** «Назад до «Повернення»», «← Позичене й під
    реалізацію», «← Постачальникам», «← Накладна» and the sold stub's
    «Відкрити накладну» stayed open while the screen they open was held —
    a payment's answer lost on a card opened from a return still let
    «Назад до «Повернення»» through. Each is now held as that screen's row
    is. The fix's own journey then found the way back held as it was at
    the tap, the opening being kept: it is now held as the row is now.
  - **A return opened twice:** the return opened again on the way back
    from its invoice stayed remembered, so a later return's lost answer,
    confirmed, threw the person back onto it. It is now opened once.
  - **A cancel not shown:** a return older than its supplier's fifty
    newest kept «Скасувати повернення» after it was cancelled; the
    screen now shows the server's answer.
  - **A late read over a paid card:** the invoice opened from the sold
    stub was read again as it opened; answered after a payment, it put the
    unpaid invoice back. It now replaces only the invoice it opened with.
  - **The lot's sheet as it was:** refused for more than in hand, the
    sheet still said the old «На руках» and let «+» reach it; it now
    shows the lots as read again, the count cut to them.
  - **A warehouse read again:** two warehouses read again as one moved
    the lines counted on the first to the other. A chosen warehouse now
    stays chosen.
  - **Nits:** one letter in the search now proven never asked of the
    server; back on «Постачальникам»'s list its heading takes the cursor;
    «Позичене»'s cursor rule held in React's development mode too.
- **Recorded, left as built:**
  - a refusal on «Повернути постачальнику» stays while a count changes, as
    on «Прийшов товар»;
  - a return cancelled elsewhere changes «Позичене»'s counts when that
    screen is opened again, not before;
  - the words written here and not in the task list are for the owner to
    read (below).

## Mutants

60 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate22.py`,
`mutants22.sh`):
- **«Постачальникам»:** «+» pressable while a return is kept; a row
  without «N шт.», without who, without «Скасовано» or «Зараховано»; two
  goods named and no «+ ще N»; «Показати ще» reading the same page again;
  the filtered empty state in the store's words; the menu not stepping
  aside; «Список постачальників» named otherwise; no way to «Позичене»; a
  unit from «Брак» said as a warehouse's.
- **The return's screen:** not read again as it opens; the hint gone
  while a set-off stands; a unit from «Брак» cancelled the plain way, its
  question saying the warehouse; a refusal kept in the sheet, or not
  reading the return again; «Відкрити накладну» gone; «Скасувати
  повернення» pressable while a return is kept.
- **«Повернути постачальнику»:** goods held for an order offered; «+»
  past what is free, by a tap or typed; a warehouse chosen beforehand;
  another warehouse keeping what was counted; no supplier not said; what
  was counted not joining «У поверненні» as it is sent; the warehouse not
  read again on a conflict; the stub without its warehouse, without the
  cursor; the fields not held while a return is kept; «←» not held while
  it is sent; the cursor not going on to the search; the search not
  asked of the server.
- **«Список постачальників»:** the search not narrowing; a conflict not
  reading the list again; a supplier saved and the list not read again.
- **«Позичене»:** «Усе» asking for «На руках»; a lot with none in hand
  filled; «Продано» for whoever keeps no invoices; «Продано» pressable
  while a mark is kept, or held only while it is sent; «+» past what is in
  hand; the price gone from the sheet; «Відкрити накладну» on a return's
  stub; a conflict not reading the lots again; the lots not read again
  once something is recorded; a lost answer keeping the sheet open; the
  empty state's words cut.
- **The ways:** «← Позичене й під реалізацію» always «← Накладні»; the
  sold card's «Позичене» gone; the return not opened again on the way
  back; «Позичене» gone from «Ще» › «Гроші»; a kept return of a lot
  opening «Постачальникам», or its stub not «Позичене»'s; a kept mark of
  sold not «Позичене»'s.
- **From the review:** the return opened again forever; the card's «←»
  not held, or held as at the tap; the list's heading not taking the
  cursor; the opening read as before.

57 of 60 were caught. 45 were caught on the first pass. Twelve slipped
past journeys that did not look at that very thing, and are caught now
that the journeys look:
- «+» and «Скасувати повернення» held, and «←» held while sent, in the
  lost answer's journey;
- the filtered empty state;
- the way to «Позичене» from «Постачальникам» and back;
- «+ ще N»;
- a number typed past what is free;
- another warehouse clearing what was counted;
- «Оберіть постачальника.»;
- the verbs held while a mark is kept;
- the lots read again after a return;
- a reload with a kept return of a lot opening «Позичене».

Three survive:
- **Two are equivalent in this app and fixture:**
  - «Продано» for whoever keeps no invoices: nobody in the fixture may
    return goods without also keeping invoices — the task list says the
    same of the owner and the managers;
  - the sheet held only while a mark is sent: a kept mark already holds
    the screen through the app's own hold.
- **One was not traced:** the warehouse not read again on a conflict.
  Another read of the warehouse follows the refusal anyway, and its
  journey's check counts that read.

## Evidence

- **Every journey on a fresh seed:** 938 of 939 passed in 21.2 min
  (`go-full22.log`). The one that failed is `backups.spec.ts:78`, which
  fails on the Mac alone as before and passes on CI.
- **The four specs this batch touches most** (`suppliers`, `borrowed`,
  `supplier-invoices`, `money`): 63 of 63. The rest it touches
  (`till-sections`, `outside-text`, `suppliers-pages`): 7 of 7.
- **`suppliers` and `borrowed` after the review's fixes:** 19 of 20.
  `borrowed`'s taps journey waited out «Завантажуємо позичене…» on the
  slow read (see «Not covered»). With the local index, `borrowed` was 10
  of 10 in 24 s.
- **The checks:** `tsc -b`, `eslint src e2e` and Prettier on my own hunks
  are clean. No backend change.

## For the owner

Nothing new to ask: «Позичене» is В2 (а) and its sheet В7 (а). What was
decided here is in business-rules.md under the heading above. Words and
ways written here, not in the task list, for the owner to read:
- «Постачальнику «{Назва}» цей магазин ще нічого не повертав.» with a
  supplier chosen;
- «Тут немає складу, з якого повертають.», «На складі «X» немає
  вільного товару.», «За «…» на складі «X» вільного товару немає.»;
- «Оберіть постачальника.», «Такий рядок уже в списку. Приберіть його,
  щоб змінити кількість.», «В одному поверненні — до 100 рядків …»;
- «Постачальників ще немає.» and «Нового додають у полі «Постачальник» —
  там, де його обирають.»;
- the cancel's question «Товар повернеться у «Брак» «X».» for a unit from
  «Брак»;
- «← Повернення» from an invoice opened from a return, «← Накладна» from
  «Позичене» opened from a sold invoice's card.

## Not covered

- **A real phone:** Telegram's MainButton, buzzes and the question before
  closing on «Повернути постачальнику» and «Позичене» are checked by
  their stubs in Chromium, not on a phone.
- **By the review and the code alone, no journey:** a return older than
  its supplier's fifty newest; an opening's read answering after a
  payment; the lot sheet's count cut after a re-read; the warehouses read
  again as fewer.
- **«Позичене» read slowly in a crowded database:** `GET /borrowed`
  with the on-hand filter (its default) took about 6.6 s against the
  local E2E database of many seeds, 0.04 s without the filter. The
  filter is reckoned for every borrowed or consigned lot in the database
  (about 4,000 here) before the shop's own are kept. Each lot's sum is
  read by a scan of `stock_movement` (about 61,000 rows), which has no
  index on `stock_lot_id`. So a fresh seed does not help, and the read
  grows with every run.
  - **Locally only:** an index `e2e_local_stock_movement_lot` on
    `stock_movement (stock_lot_id)` was added to the local E2E database.
    It is not a migration and not in the code. With it, `borrowed` went
    from minutes and timeouts to 24 s for its ten journeys.
  - On CI's fresh database it is quick; a shop with many movements would
    feel it.
  - Not this change's (no backend change here); proposed as its own
    task.
- **The rest:** the money task list's P1-1 waits for the next pick.