# «Усе на бірці», audit 2026-11-13, batch 2: every result's main in a dock at the menu's top; «Внесок записано» and «Борг списано» their own result's screens, no «←»; what is still owed in the debt's colour with its arrow (sale P1-1, P1-2, P2-3, frame P2-9) — 2026-11-13

Baseline: `d3acfbd5` (the audit's first batch, PR #202, merged). This batch
is the audit's next in its own order («merged, go next»): the sale task
list's first batch («Итог под пальцем»: P1-2, then P1-1, with P2-3), and
the frame's P2-9, which asks to be built with sale P1-2.

Status: built and proven in the journeys (the full run after the review's
fixes 1099 of 1100 — the stand's own `backups:93`); 43 of 43 mutants
caught; the review's findings fixed; not committed.
Not yet seen on a real phone.
- Branch: `feat/audit-1113-results`.
- Task: the audit's second batch, after #202's merge (2026-11-13).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-13 (audit
  2026-11-13, batch 2: …)".

Where it stood:
- A result held its main two ways: the till's receipt and «Продажу немає»
  in a dock that stood under the text mid-screen on a short result; the
  cash close, receiving, «Клієнт забрав» and an invoice outside Telegram a
  `primary` in the flow right under the stub (`.result-next`). The cash
  close's button is at the bottom; its result's «Готово» was in the middle.
- «Внесок записано» was drawn inside S21: S21's header stayed — the coat's
  name the page's heading, «← До боргів» over it, Telegram's «Назад» on —
  and «Внесок записано» a small heading under it. Four ways out on one
  result; no perforation and no goods on the stub. «Борг списано» the same
  under the debt's header.
- What is still owed after a payment was black, like any sum; only
  «За номером уже винні» had the debt's colour, without its arrow.

## What exists now

- **A result's screen** (frame P2-9, sale P1-2; `frontend/src/shared/ResultScreen.tsx`,
  new; `frontend/src/styles.css` `.result-screen`):
  - at least as tall as what shows over the menu — Telegram's stable
    height, never `100vh` — from main's top; what it says one block, the
    main last, in the dock: on the menu's top on a short result, sticking
    there while a long one scrolls, and ending there;
  - the dock's height kept clear wherever the page scrolls to
    (`--result-dock-h`, read by `html`'s `scroll-padding-bottom`);
  - the results: the till's receipt and «Продажу немає»
    (`frontend/src/sales/Sale.tsx`), a sale's return
    (`frontend/src/returns/Result.tsx`), S22 and «Борг списано»
    (`frontend/src/credits/Paid.tsx`), the cash close
    (`frontend/src/cash/Closed.tsx`), receiving
    (`frontend/src/inventory/Receive.tsx`), «Клієнт забрав» — the order's
    card while it says the sale (`frontend/src/orders/Order.tsx`,
    `Collected.tsx`) — and an invoice and its payment
    (`frontend/src/suppliers/Invoices.tsx`, `InvoicePay.tsx`,
    `InvoiceRecorded.tsx`);
  - the mains as they were: «Новий продаж», «Готово», «Прийняти ще», «До
    замовлень»; an invoice's «Готово» Telegram's MainButton, outside it in
    its place in the dock, 50 high, 10 round;
  - a result's quiet ways under its stub, in its flow: the return's «Ще
    повернення» under the hint of a mistake's mending; «Клієнт забрав»'s
    «Змінити спосіб оплати» and «Оформити повернення»;
  - a return without the till: «До списку» the dock's one button;
  - an order's card and an invoice's screens keep one tree: the result is
    turned on in it, the header and «←» the ones they were — Telegram's
    «Назад» never hidden and shown again.
- **«Внесок записано» and «Борг списано»** (sale P1-1;
  `frontend/src/credits/Paid.tsx`, `Debt.tsx`):
  - their own result's screen in the debt's place: «✓ Внесок записано» /
    «✓ Борг списано» the page's heading, focused, the sentence heard with
    it; no «←», no Telegram «Назад», no ⋯; under the title the store's and
    the person's line, as the receipt's;
  - the payment's stub in S22's order: the way, what to do with the money,
    the sum, a perforation, the debt's first good and «+ ще N» (every good
    on a tap, the list focused), what is left, «Усього винні магазину
    «…»»; knotted when nothing is left;
  - in Telegram a payment's «Відкрити борг» is its MainButton and the way
    back quiet under the stub; outside it the way back («До боргів», or
    her name) the dock's main, «Відкрити борг» quiet; a write-off the same
    as outside Telegram, in Telegram too;
  - the menu back before the result is painted (a layout effect), so its
    dock stands on the menu from the first frame;
  - a payment confirmed later: the compact block in its notice, as before.
- **What is still owed** (sale P2-3; `frontend/src/shared/OwedSum.tsx`,
  new; `.owed-left`): the sum in `--owed`, 700, the debt's minus arrow 16
  before it — on the receipt in parts, the return's «Покупець ще винен»,
  S22's «Залишок боргу», the basket's «Лишиться винен» and «За номером уже
  винні» (`frontend/src/credits/Terms.tsx`); the words as they were
  (В13-П2 open). 6.8:1 on the card in the light theme, 8.61:1 in the dark.

## The independent review

An independent review (a fresh agent, the diff and the four points of the
task lists; no conclusions handed to it) found:
- **Medium, fixed:** the dock was not counted in `scroll-padding-bottom`:
  anything focused or scrolled to near a long result's end could stand
  under it. Now `ResultScreen` keeps the dock's height in
  `--result-dock-h`, as the pay panel's.
- **Low, fixed:**
  - an invoice's result was a second tree: its header remounted, and
    Telegram's «Назад» was hidden and shown again. Now the hosts keep their
    one tree, the result turned on in it (`useRecordedDone`), as the
    order's card;
  - the comments said a result's margins fall as they did, and that a
    banner never makes the page scroll; reworded — a banner over a result
    moves it down by its height;
  - S22's dock could jump a frame: the menu was told back in an effect,
    after the paint. Now a layout effect;
  - the last line's margin added to the dock's own gap inside the block;
    now 0;
  - a dead condition on the debt's ⋯ (the result returns before it);
    removed;
  - Prettier reflows of lines this batch did not touch in `Sale.tsx` and
    `Debt.tsx`; reverted.
- **Low, left as a reading or a follow-up:**
  - «Продано N шт.» (Borrowed) and a supplier's return keep their «Готово»
    in the pay panel's dock — not named by the task lists;
  - a write-off opened from «Борги» no longer names the customer on its
    screen (her name was the debt's title) — a reading for the owner.
- Found by the journeys, fixed: a result screen that is a `section` took
  the sections' 18 px top margin, so a short write-off at 360 × 640
  scrolled by 18 px. Now `.result-screen` has no top margin.
- Measured by the journeys, a reading: at 360 × 640 the one-line receipt
  (the day's line, the stub, «Змінити спосіб оплати», the return's hint)
  and its dock take 606 px where 551 show over the menu. Its dock stands on
  the menu's top, as the task list asks, sticking there; the return's hint
  starts under it and scrolls out from under it — as on main, where the
  dock stuck the same way. S22 with every good opened (+ 11 px) the same.

## How it was built and proven

**Code:**
- New: `frontend/src/shared/ResultScreen.tsx`, `OwedSum.tsx`.
- `frontend/src/shared/ScreenHeader.tsx`: `describedBy`, for S22's
  sentence heard with its title.
- `frontend/src/sales/Sale.tsx`, `frontend/src/returns/Result.tsx`,
  `frontend/src/credits/{Paid,Debt,Terms}.tsx`,
  `frontend/src/cash/Closed.tsx`, `frontend/src/inventory/Receive.tsx`,
  `frontend/src/orders/{Order,Collected}.tsx`,
  `frontend/src/suppliers/{Invoices,InvoicePay,InvoiceRecorded}.tsx`.
- `frontend/src/styles.css`: `.result-screen`, `.owed-left`, the
  result-dock's main-mimic 50/10, `html`'s `scroll-padding-bottom`;
  `.result-next` gone.
- No backend change.

**Journeys:** 1100 in all; 1097 before.
- New (3):
  - `till-receipt`: a long receipt's dock sticks on the menu's top while
    it scrolls, and ends there;
  - `returns-sale-screen`: a return's result at 360 × 640 — «Новий
    продаж» the dock's one main on the menu, «Ще повернення» quiet under
    the hint;
  - `credits-debt`: inside Telegram a write-off's result keeps its own way
    back — the dock's main, «Відкрити борг» quiet, Telegram's MainButton
    put away with the debt's «Внесок», never «Відкрити борг».
- Changed:
  - `fixtures`: `dockOnMenu` (the dock's bottom on the menu's top ±1 px,
    nothing to scroll on a short result) and `expectOwed` (the sum, its
    arrow, the debt's colour);
  - `credits-debt`: S22 — the title, no «←», the stub in S22's order, the
    goods and «+ ще 1», the dock's main, «Відкрити борг» quiet; the
    write-off at 360 × 640 — its title, no «←» and no ⋯, the dock on the
    menu, the way back;
  - `telegram-rules`, `telegram-back`: S22 in Telegram — the way back
    quiet, no dock, no Telegram «Назад»; where Telegram names no version,
    the dock's main;
  - `till-receipt`, `shelf`, `cash-close`, `receive`, `orders-card`,
    `supplier-invoices`: the dock on the menu (or sticking on a long
    result), its main; an invoice's main-mimic 50/10 outside Telegram,
    no dock inside it;
  - `returns-sale-screen`, `credits`: what is still owed in its colour,
    with its arrow; «До списку» the dock's main.

## Mutants

`mutate50.py`, 43 mutants, each applied alone, its journey run, the source
restored (`mutants50.sh`): 43 of 43 caught, each at the check meant for it.
- The result's screen (8): no `result-screen` class; the dock inside the
  block; the sections' top margin back; no height; the height not less the
  menu; main's foot not taken; the block not growing; the dock's
  main-mimic not 50/10.
- The till's (2): the receipt, «Продажу немає» not a result's screen.
- The return's (4): not a result's screen; «Ще повернення» the primary;
  «До списку» quiet; «Ще повернення» offered without the till.
- S22 and the write-off (15): the result inside S21's tree; no focus; the
  sentence not heard with the title (`Paid`, `ScreenHeader`); no
  perforation; no goods line; «+ ще 1» not opening, or its list not
  focused; S22 in Telegram taken as outside it; a write-off in Telegram
  taken as a payment; Telegram's «Відкрити борг» on a write-off; what is
  left back to black; the way back the primary in Telegram; quiet in the
  dock outside it; «Відкрити борг» going back instead.
- The cash close, receiving, «Клієнт забрав», an invoice (8): the close,
  receiving, the collected card not a result's screen; the close's dock
  shown with the reason's form; the card a result before it is collected;
  its dock gone; its quiet ways gone; an invoice's dock inside Telegram;
  its button the primary.
- What is still owed (6): no arrow; not in the debt's colour; the
  basket's two, the receipt's, the return's back to plain.
- The first pass had 43, 41 caught. Two lived, and each found a journey
  missing: `paidtgany` (a write-off in Telegram taken as a payment: no
  dock, the way back quiet) and `paidshown` (Telegram's MainButton
  «Відкрити борг» on a write-off) — no journey wrote a debt off inside
  Telegram. Now one does (`credits-debt`, the third new journey), and both
  are caught.

## Evidence

- Full run, a fresh seed, one worker, after the review's fixes and the
  journeys' own: 1099 of 1100 in 30.4 min. The one: `backups:93` — the
  stand's own, as in every full run since batch 8.
- Before it, the eleven specs touched, after the review's fixes: 246 of
  248; the two were this batch's own checks — S22 with every good opened
  and the one-line receipt at 360 × 640 are longer than the screen over
  the menu (measured: 606 px where 551 show), so their docks stick on the
  menu rather than the page standing still; the journeys now say so, both
  pass. The write-off at 360 × 640 had scrolled by 18 px (the sections'
  margin) before the fix.
- Types: `tsc --noEmit` clean; ESLint clean on every file touched; Prettier
  clean on what this batch changed — `Sale.tsx`, `Debt.tsx` and
  `credits-debt.spec.ts` are unformatted on main and left so outside it;
  `styles.css` left as on main.

## Not covered

- A real phone; Telegram's MainButton over a result.
- The dock's scroll room: no journey focuses something under a long
  result's dock.
- S22's dock on its first frame (the layout effect): no journey looks
  at a single frame.
- An invoice's one tree: no journey counts Telegram's «Назад» hidden and
  shown again.

## For the owner

- **Done:** every result's main is at the bottom, on the menu, where the
  close's and the till's were; «Внесок записано» and «Борг списано» are
  their own result's screens, like the receipt; what is still owed reads
  in the debt's colour with its arrow.
- **To read** (decided here): S21's line («Оксана · «Центр» · з 01.10»)
  is not on the result — the store's and the person's line is, as on the
  receipt; a write-off opened from «Борги» no longer names her; a banner
  over a result lets the page scroll by its height; «Перевірка каталогу»'s
  outside-Telegram button 50/10 too; at 360 × 640 the one-line receipt is
  55 px taller than the screen over the menu — its dock on the menu, the
  return's hint scrolling out from under it, as before.
- **Still open:** В13-П2 (the owed words), the audit's other new
  questions (В13-П1, В13-З1, В13-Г1/Г2, В13-Т1/Т2); «Каса»'s and orders'
  refusals by В-П1; «Закриття · Центр»; «Продано»'s stub words; the
  «Початкові залишки» hold line; at 360 px the store's column's two-line
  «не вдалося прочитати» (batch 1).
