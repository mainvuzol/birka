# «Усе на бірці», stage 2's fourth batch: «Накладні» as tags, the invoice's card and its payment, the supplier's field and its sheet — 2026-11-06

Baseline: `63c9d181` (#172, on main), and three points of the stage-2
money task list ([P0-1, P0-2, P0-3](redesign/2026-11-05-redesign-tz-stage2-money.md)),
their decisions and acceptance.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-invoices`. Task: the fourth batch proposed after #172
(chosen in chat, 2026-11-06, ««Накладні» batch»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-06 (stage 2 batch 4:
…)". The owner's questions stand by their (а): В3 (the invoices one after
another, the newest first, with the supplier's field and the total) and
В9 (no line about «Видати з каси» on the payment).

Where the invoices and the supplier still did their own way:
- The supplier was a native list, «Оберіть постачальника», at four places
  under three captions; «+ Новий постачальник» unfolded four controls under
  it.
- «Накладні» began with three native lists and a paragraph; the summary
  and its list by supplier stood over the button; each invoice was a card
  with «Відкрити накладну {постачальник} від {дата}»; a new invoice
  unfolded inside the list.
- The card was a table of five rows and, under it, every form at once:
  the payment, the set-off, the write-off, the history with a «Скасувати»
  on each line, «Скасувати накладну». A payment was said in a grey line.

## What exists now

- **The supplier's field and its sheet (money P0-3):** at «Нова накладна»,
  «Постачальникам» (its filter and the return's form), «Прийшов товар»'s
  «Як надійшов» and «Брак».
  - A field «Постачальник» — «Оберіть ›» or «{Назва} · {телефон} ›»; a
    tap opens the sheet «Постачальник»: «Пошук постачальника» with the
    cursor in it, every word matched in a name or a phone; a row each, the
    phone under it, the chosen one marked; a pick closes the sheet with a
    choice's buzz.
  - «+ Новий постачальник», or «+ Новий постачальник «{набране}»» when
    nothing matches: the name already typed, the phone, «Додати
    постачальника» the sheet's foot. A name on the list already is picked,
    never added.
  - Inside «Як надійшов» the list opens in place: no sheet over a sheet.
  - As a filter: «Усі постачальники» first, nothing to add; on «Накладні»
    «винні {сума} · N накладні» under each.
- **«Накладні» as tags (money P0-1):**
  - «+» (read «Записати накладну») and «Оновити» in the head; «Винні
    зараз · Усі»; the supplier's field; the total in ink, «Винні {сума} ·
    N накладні» or «Винні постачальнику «{Назва}» …», «дані на HH:MM» by
    it once old.
  - Each invoice a row tag, the newest first: the eyelet filled while
    owed, a knot once closed, none once cancelled; the supplier and what
    is owed in ink; «DD.MM · {хто}», «сплачено X з Y» once paid; the
    closed one's sticker with its glyph; «Сплатити», the tag's one verb.
  - «Накладні магазинів, що не працюють ›» under the list; the empty
    state with its blank mark, the old words, the line on debts and a
    quiet «Записати накладну».
  - «Нова накладна» a screen of its own: the field, «Сума за накладною,
    грн», «Сплачено одразу, грн», «Примітка (необов’язково)», the dock's
    «Записати накладну»; recorded, its stub, «Готово» to its card.
- **The invoice's card and its payment (money P0-2):**
  - The card: the supplier its title; «Винні» and what is owed large in
    ink; the bar in the paid colour, «Сплачено X з Y · остання оплата
    DD.MM»; «Історія» as a thread, a node filled, hollow once cancelled.
  - «Сплатити»: Telegram's MainButton, hidden under a sheet; outside
    Telegram the dock's one button.
  - The payment: a task screen without the menu; the app's keypad «Сума,
    грн», «Увесь залишок {сума}», «Це більше, ніж винні …» holding the
    button, «Сплатити {сума}» the dock's own; Telegram asks before closing
    while a sum is typed; recorded, a success buzz and the stub «Оплату
    записано», «Готово» to the card; refused, an error buzz and the words
    over the keypad.
  - Behind ⋯, «Накладна «{Назва}» від DD.MM»: «Зарахувати повернення»,
    «Списати залишок» (the owner), «Скасувати накладну» (dark while a
    payment or a set-off stands); each a sheet asking why; a line of the
    history pressed for its own cancel.
- **What every command sends is as before:** the same journal, body and
  command id; every sum the server's.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- **The supplier's field:** the sheet's title stays «Постачальник» while a
  new one is typed; «Як надійшов» opens the list in place, never a sheet
  over a sheet; the filter's name «Постачальник» is a reader's alone, so
  the total and three tags fit over the menu at 390 × 844; «Нічого не
  знайшли за «…»» when nothing matches (from the review); closed, a new
  supplier begun is forgotten, except in «Як надійшов» (from the review).
- **«Накладні»:**
  - «Винні постачальнику «Ганна» …», not the task list's «Винні «Ганні»»:
    a name is never declined;
  - a tag's line says «сплачено X з Y» only once something is paid;
  - «Залишок списано» a neutral sticker with a minus;
  - the list and the returns read again at once after any command, the
    list not shown too, so a card opened on the way back is as it is now
    (found by the set-off's journey);
  - the empty state's words are the same with a supplier chosen, as on
    main.
- **The payment:** «← Накладна» from the card, «← Накладні» from the
  list; «Це більше, ніж винні: залишок X. Сплатіть не більше.»; paid,
  «←» goes to the card as the server answered (from the review).
- **The ⋯'s ways:** the sheets' sentences; a set-off or a write-off said
  over the sum by a filled eyelet, not a stub; a refused set-off kept in
  its sheet with its choice and sum, a refused write-off or cancellation
  said on the card (from the review); an answer read again after a
  refusal never brings back a screen already left (from the review).
- **A store that does not trade** has no «Накладні», as before: its rights
  are the reading ones; its invoices are paid from a trading store's
  «Накладні магазинів, що не працюють ›».

## How it was built and proven

- **Files:**
  - `frontend/src/suppliers/Picker.tsx`: the field, the sheet with its
    search, «+ Новий постачальник», the list in place, the filter;
  - `frontend/src/suppliers/Invoices.tsx`: «Накладні» (the head, the
    switch, the field, the total, the tags, the others' row, the empty
    state), «Нова накладна» as a screen, the card and its history, the
    screens' order;
  - `frontend/src/suppliers/InvoiceTag.tsx`, `InvoiceSticker.tsx`: the
    tag and its sticker;
  - `frontend/src/suppliers/InvoicePay.tsx`: the payment;
  - `frontend/src/suppliers/InvoiceOwed.tsx`: what is owed, large, and
    the bar;
  - `frontend/src/suppliers/InvoiceRecorded.tsx`: the stubs;
  - `frontend/src/suppliers/InvoiceActions.tsx`: the ⋯ and its sheets;
  - `frontend/src/suppliers/invoiceWords.ts`: the words of the results
    and refusals, moved out of `Invoices.tsx`;
  - `frontend/src/suppliers/Suppliers.tsx`, `frontend/src/inventory/Receive.tsx`:
    the new field at «Постачальникам» and «Як надійшов»; «Брак» takes it
    unchanged;
  - `frontend/src/shared/SearchField.tsx`: the cursor in the search as
    the sheet opens;
  - `frontend/src/App.tsx`: the payment a task screen, the menu aside;
  - `frontend/src/styles.css`: the field, the rows, the tags, the total,
    the card, the payment, the sheets.
  - No backend change: every read and command is the one before.
- **Journeys:** 930 in all (920 after #172).
  - **10 new:**
    - «Накладні» as tags: the eyelets, the switch, the field and its
      sheet with each supplier's debt, the total, the others' row;
    - the light and the dark theme: every sum in ink, a tag, the card and
      the payment at 4.5:1;
    - at 390 × 844 the total and three tags, at 360 × 640 the total and
      one; a forty-letter name wrapped, its sum whole; «дані на HH:MM»
      once five minutes old;
    - four taps from «Гроші» to a part paid, seven at most to a new
      invoice;
    - inside Telegram: «Сплатити» the card's MainButton, never the
      payment's; «Назад» closes a sheet, not the card; the buzzes; the
      question before closing; «Готово» the MainButton;
    - a store that does not trade has no «Накладні»;
    - nothing owed: the blank mark, the words, «Записати накладну»;
    - an answer read again after a refusal never brings back the screen
      left before it came (from the review);
    - the returns narrowed to a supplier from its sheet: «Усі
      постачальники» first, every word matched, «Нічого не знайшли»,
      nothing to add.
  - **Rewritten:** the eight journeys of `supplier-invoices` for the new
    screen, the card, the payment and the ⋯'s sheets; and, from the
    review, the payment's «← Накладна» after it is paid, a refused set-off
    kept in its sheet, a new supplier begun and forgotten, what a reader
    hears of a history line and of a tag's «Сплатити».
  - **Edited for the field:** `suppliers` (the return's form, «Брак», a
    supplier never written twice), `borrowed` («Як надійшов» in place,
    the cancel behind ⋯), `suppliers-pages`.
  - **`fixtures.ts`:** `supplierList`, `pickSupplier`, `addSupplier` — the
    field, its sheet or its list in place.

## The independent review

An agent read the change cold (2026-11-06). It found the journal and the
command id as before (made once per send, a lost answer resent only by
the stub's check, a second quick tap stopped), every write held while
another command is pending or kept, more than is owed never paid, the
stores' and the rights' rules as on main, Telegram's MainButton never
paying and stepping aside under every sheet, «Назад» closing only the
sheet, and the effects and the sheets' cursor sound. What else it found,
and what was done:
- **Fixed:**
  - **The card as it was before a payment:** paid, «← Накладна» (or
    Telegram's «Назад») instead of «Готово» opened the card with the
    invoice from before the payment — what was owed, its ⋯'s write-off
    and no payment in its history — inviting the same sum paid twice. The
    payment now hands the server's invoice to the card. The first journey
    goes back by «← Накладна» and finds the payment there.
  - **A late answer bringing a screen back:** the invoice read again
    after a refusal was put on the screen that was shown when the read
    began; gone back meanwhile, the person was thrown onto the payment
    (its sum and words lost) or the card again. It is now shown only on a
    screen that still shows that invoice. A new journey holds the read
    while the person goes back, from the payment and from the card.
  - **A refused set-off losing its choice:** the sheet closed and the
    return chosen and the sum typed were gone, where main kept them. It
    now says the refusal in the sheet, keeps both, reads the card and the
    returns again; a return cancelled meanwhile is chosen no more.
  - **A history line read as an unknown dialog:** it is now read
    «Скасувати: …»; a tag's «Сплатити» is described by the supplier, the
    sum and the day, so two of one supplier's are told apart.
  - **A new supplier begun, remembered:** the sheet closed and opened
    again showed the name and phone, not the search; it now forgets them
    (only «Як надійшов» keeps them), and is never closed while «Додати
    постачальника» waits.
  - **Nothing found, nothing said:** «Нічого не знайшли за «…»» under the
    rows.
  - **The tag's sum** in tabular figures.
- **Recorded, left as built:**
  - «Винні постачальнику «Ганна»», not «Винні «Ганні»»: for the owner to
    read (below).
  - The history's and the bar's sums are plain words in the line's own
    face, as the customers' debts' are; the large sums are the `Sum`.
  - With a supplier chosen, an empty list still says «Зараз магазин
    нічого не винен постачальникам.», as on main.

## Mutants

52 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate21.py`,
`mutants21.sh`):
- **The supplier's field:** the typed name not put in the new one's field;
  the cursor not going on to the sum, nor into the search; the duplicate
  not said; the sheet's foot gone; any word matching instead of every
  word; «Усі постачальники» shown while typing, never marked; the filter's
  pick not changing the list; the filter's name shown; the list in
  «Як надійшов» a sheet over the sheet.
- **«Накладні»:** a cancelled tag knotted; the tag's sum always what is on
  it; «сплачено 0,00» said; «Сплатити» on a closed invoice; «+» on the
  others' list; the total without its supplier; the filter's debts gone;
  the list not read again while hidden; the age stamp gone; the others'
  row gone; the empty state's line gone; the total, the card's sum and
  the bar in the debts' red.
- **The card and the payment:** the menu not stepping aside; «← Накладна»
  always «← Накладні»; «Готово» back to the list; «Увесь залишок» the sum
  on the invoice; more than is owed pressable, not said; no question
  before closing; no buzz of the error or of success; the MainButton not
  stepping aside under a sheet; the dock's button beside the MainButton;
  «Готово» not the MainButton; the paid stub never knotted.
- **The ⋯'s ways:** «Скасувати накладну» pressable while a payment stands;
  the write-off for a manager; a cancelled return offered; a cancelled
  line pressable; its node never hollow.
- **From the review:** the payment's «←» to the card as it was; a late
  answer bringing the payment or the card back; a refused set-off closing
  its sheet; the history line's «Скасувати:» gone; the tag's «Сплатити»
  described by the supplier alone; a new supplier remembered; «Нічого не
  знайшли» gone.

All 52 were caught at once, each where its journey checks that very
thing but one: the list not read again while hidden left the card opened
on the way back without its set-off, so the history line the journey then
asks a reader's name of was not there — the stale card itself, caught a
line earlier than the check written for it.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-06, after the
  review's fixes and the mutants): 929 of 930 pass in 21.0 minutes.
  `backups.spec.ts:78` fails only on this Mac, as on every batch before;
  CI runs it.
- Before the review's fixes, the same: 927 of 929. `backups.spec.ts:78`,
  and `cash-kept.spec.ts:619` once, timed out at the store's door before
  anything this change touches; it passed in the rerun.
- The journey files the review's fixes touch, with `receive`, `damaged`
  and `cash-kept`, on a fresh seed: 71 of 71.
- The mutants: 52 of 52 caught, on the real code restored after them.
- The journeys this change first wrote, before the review: 30 of 30
  (`supplier-invoices`, `suppliers`, `borrowed`, `suppliers-pages`) once
  the money's spaces were matched as the screen writes them, two fields
  named «Постачальник» told apart, and a sheet's taps awaited.
- `tsc`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change and in every new file (main's own
  unformatted lines are left as they were).
- No backend change, so no backend run.

## For the owner

Nothing new to ask: «Накладні» is В3 (а) and the payment В9 (а). What was
decided here is in business-rules.md under the heading above. Words and
ways written here, not in the task list, for the owner to read:
- «Винні постачальнику «Ганна» 20 000,00 грн · 2 накладні» (the task list
  wrote «Винні «Ганні» …»: a name is never declined);
- «Залишок списано» a neutral sticker with a minus;
- «Нічого не знайшли за «…»» in the supplier's sheet;
- the payment's «← Накладна» from the card and «← Накладні» from the
  list;
- a refused set-off kept in its sheet, a refused write-off or
  cancellation said on the card.

## Not covered

- **A real phone:** Telegram's MainButton, «Назад», buzzes and question
  before closing are checked by their stubs in Chromium; the cursor put in
  the supplier's search inside the tap, which iOS needs for its keyboard,
  is not checked on iOS.
- **The supplier's sheet held while «Додати постачальника» waits:** by
  the review and the code alone; no journey holds the answer.
- **The rest:** the money task list's P0-4, P0-5, P1-1 and P1-3 wait for
  the next pick.
