# «Усе на бірці», stage 2's second batch: the suppliers' kept operations, one paper banner, one paper sample — 2026-11-05

Baseline: `bfe16cc` (#170, on main), and three P0s of two stage-2 task
lists: money ([P0-6](redesign/2026-11-05-redesign-tz-stage2-money.md)) and
orders-paper ([P0-3, P0-4](redesign/2026-11-05-redesign-tz-stage2-orders-paper.md)),
their decisions and acceptance.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-kept-and-paper`. Task: the second batch proposed
after #169 (chosen in chat, 2026-11-05, «merged, go next»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-05 (stage 2 batch 2:
…)". The owner's questions stand by their (а): money В1, orders-paper
В-ЗП1, В-ЗП5.

Three things the paper mode and the suppliers' screens still did their
own way:
- A payment, a set-off or a return to a supplier whose answer was lost
  was a grey notice on its own screen, unlike every other kept operation
  since frame P0-2.
- While the server was silent, the owner's whole sentence stood at every
  place that failed to read: three times on a screen with three reads,
  and nowhere on a screen with none.
- The till, a return and a debt's payment each drew paper mode in their
  own way, with the kind and the name as radios and a list's wheel on the
  page.

## What exists now

- **The suppliers' and the invoices' kept operations (money P0-6):**
  - On its own screen, the stub still attached, with «Ще не підтверджено».
    Over any other screen, a banner with the same words.
    - The own screen is «Накладні» for an invoice, a payment, a set-off or
      a write-off.
    - It is «Постачальникам» for borrowed goods marked sold and for a
      return to a supplier.
  - Its words: «Оплату ще не підтверджено», «Невідомо, чи записано
    оплату. Перевірте результат — та сама операція не запишеться
    двічі.», «Чекає відповіді сервера з 11:42.», «Перевірити результат
    оплати».
  - Checked by its button alone (G11). Nothing says «Перевіряємо кожні
    20 с», and the button is the stub's own, not a quiet one.
  - Confirmed: «Оплату записано один раз» with the screen's own done text,
    and «Зрозуміло». The screen opens afresh and its lists are read again.
  - Refused, with nothing recorded: the screen's own words, and the till
    is free.
  - Telegram reopening the app opens the operation's own screen. That
    screen's row in «Ще» stays open while every other row is held.
- **One paper banner (orders-paper P0-3):**
  - While the server does not answer, the owner's sentence stands once,
    at the top of every screen of a store that trades. It is a status
    named «Сервер не відповідає», and it goes with the first answer.
  - Every place that could not be read says «Сервер не відповідає.» on a
    warning's plate, with «Спробувати ще раз».
    - That plate, now shared (`shared/Unread.tsx`), stands wherever a read
      failed: thirty places that had a bare line now have it.
    - A next page that failed reads that page again.
    - A server's own error keeps its words.
  - The sign-in, the crash screen and the page before the app keep the
    whole sentence.
- **One paper sample (orders-paper P0-4):** on the till, a return and a
  debt's payment, the same four rows:
  - the switch;
  - the series' row:
    - which paper it is, and «Продавець: …» or «Хто прийняв: …»;
    - until the paper is said, «Оберіть, що вносите з паперу» with the
      warning's triangle;
  - «З паперу», a sheet:
    - it opens in the same tap as the switch, and again from the series'
      row;
    - it asks which paper and who sold or took it, «Не вказано» first and
      chosen;
    - its quiet «Готово», Telegram's «Назад» and the scrim close it;
      never a MainButton;
  - the paper's time, with «Це було вчора» a switch row.

  A return or a payment from paper has «Режим: з паперу» at its top once
  the paper is said. A series' first sale is at most seven taps from the
  switch, and each next one three.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- **The kept operations' own screens:**
  - «Постачальникам» for borrowed goods marked sold, with its row open
    while it is kept;
  - «Накладні» once the right to send goods back is gone.
- **What the stub says:**
  - its words follow the sale's pattern, and a check that gets no answer
    adds nothing under the stub;
  - no success buzz and no ask to close, as for a kept sale confirmed
    later;
  - a check pressed on an operation the phone never checks by itself does
    not move «остання перевірка»;
  - the journal's own «Спершу завершіть збережену операцію з накладною.»
    is said as before.
- **The paper banner:**
  - no paper banner over a store that does not trade;
  - «Спробувати ще раз» wherever a read failed, but not under the report's
    refused days, where reading again changes nothing.
- **When «З паперу» opens:**
  - it opens on the switch turned on, and not from «Сервер знову
    відповідає»'s button, which says the outage's paper as before;
  - nor from «Ще» › «Цей телефон», whose till then shows «Оберіть, що
    вносите з паперу».
- «Продаж» stays held while a supplier's operation is kept, as built.

## How it was built and proven

- **Files:**
  - `frontend/src/App.tsx`:
    - the invoices' and the suppliers' stubs and banners, their checks;
    - the paper banner;
    - the rows' holds and the screens' remount;
  - `frontend/src/suppliers/kept.ts` (new): their words;
  - `Invoices.tsx`, `Suppliers.tsx`, `Borrowed.tsx`: their own notices
    gone;
  - `frontend/src/shared/Kept.tsx`: `byItself`, for a kept operation the
    phone never checks by itself;
  - `frontend/src/shared/api.ts`: `SILENT`, `readText`;
  - `frontend/src/shared/Unread.tsx` (new, from `orders/Orders.tsx`): the
    plate;
  - `frontend/src/shared/reach.ts`: `waitsText`;
  - every screen that reads, under `frontend/src`: `readText` and the
    plate;
  - `frontend/src/sales/paperMark.tsx`: `PaperSwitch`, `PaperSeries`,
    `PaperSheet`, `PaperBanner`, `PaperWhen`'s switch row;
  - `frontend/src/sales/Sale.tsx`, `returns/Returns.tsx`,
    `credits/Debt.tsx`: the sample;
  - `frontend/src/styles.css`: the series' row and the sheet's options.
- **Journeys:** 911 in all (905 after #170).
  - **6 new:**
    - the paper banner over the till at 360 × 640, the search and the menu
      where they were;
    - a series from paper in 7 taps, then 3;
    - a return from paper at 360 × 640: its banner, the three rows, the
      first goods in view;
    - a kept payment checked from «Гроші»;
    - a kept payment refused on its check, in the invoices' words;
    - «З паперу» with Telegram's «Назад» and no MainButton.
  - **Edited:**
    - for the stubs: `supplier-invoices`, `suppliers`, `borrowed`;
    - for the banner and «Сервер не відповідає.»: `outage`,
      `till-sections`, `stores`;
    - for the sample: `outage`, `outage-mark-debts-returns`,
      `till-first-days`, `till-receipt`, `till-shortage`,
      `returns-sale-screen`, `telegram-rules`.
  - **`fixtures.ts`:**
    - `fromPaper` says the paper in the sheet, which must already be open
      from the switch's tap;
    - new: `paperSheet`, `expectSeries`, `namedFromPaper`.

## The independent review

An agent read the change cold (2026-11-05). It found the kept operations'
outcomes (done, refused, unknown) as the sale's and the return's, nothing
lost by the remount, and the sheet's focus, inert and «Назад» sound. What
else it found, and what was done:
- **Fixed:**
  - **«Постачальникам» held against its own operation:** a kept
    «Продано» of borrowed goods had its own screen's row held by the
    invoices' journal. Once left, its stub could not be reached again.
    - The row now stays open to it.
    - The journey leaves to «Ще» and comes back.
  - **Reads that still said the whole sentence:**
    - which: the close's read, «Прийшов товар»'s warehouses and sizes, and
      eight reads on «Покупці»;
    - with the banner, the owner's sentence stood twice on the screen;
    - they now say «Сервер не відповідає.».
  - **«Сервер не відповідає.» with nothing to press, in thirty places:**
    - before, those places at least said the whole instruction;
    - each now has the shared plate with «Спробувати ще раз»;
    - the report's refused days keep a bare sentence: a full run found
      the plate there.
  - **The journeys took the series' row when the switch did not open the
    sheet:** `fromPaper` now needs the sheet open from the switch's tap,
    on the till, a return and a payment alike.
  - **The paper banner over a store that does not trade:** it said to
    sell on paper where nothing is sold. It is gone there. A step of the
    blocked store's journey checks this, its orders unread.
  - **A check pressed on an invoice moved «остання перевірка»** of a kept
    sale it never checked. It does not now.
  - **A non-server error under the stub** said «спробуйте ще раз». It now
    says the journal's own words, as the screens did.
  - **An attempt kept without its time** drew an empty line. Nothing is
    drawn now.
  - **The confirmation's journey** checked only that the stub was gone. It
    now checks that the invoice was read again («Винні 600,00 грн з
    800,00 грн») and that its form is closed.
- **Recorded, left as built:**
  - «Never a MainButton» in `telegram-rules` cannot fail today: the till
    never sets one. It stays as a guard.
  - The 360 × 640 layouts (the return's first goods under its banner, the
    till's series above the tray) are measured on the Mac's font. CI's
    DejaVu is wider; GitHub's run is their proof there.
  - Paper turned on from «Ще» › «Цей телефон» opens no sheet at the till
    (decided above).

## Mutants

29 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate19.py`,
`mutants19.sh`):
- **The kept operations:**
  - the phone said to check by itself, for an invoice and for a return;
  - the check made quiet;
  - the stub's lines: its time, its unknown, the confirmation's title;
  - an unreachable said under the stub;
  - borrowed goods' own screen;
  - the confirmation over another screen drawn as its own;
  - the refusal in the shared words, or not kept;
  - the lists not read again;
  - «Постачальникам» held against its own;
- **The paper banner:**
  - gone, unnamed, or over a store that does not trade;
  - `readText` saying the whole sentence;
  - «Каса»'s drawer in the old words;
  - the plate without its retry, or with the paper's words;
- **The sample:**
  - the sheet not opened by the till's switch, nor by a return's;
  - the series' words, its name too early or in other words;
  - «Не вказано» not chosen;
  - «Готово» not quiet;
  - the return's and the payment's banners gone.

28 of 29 are caught. Two of them needed more:
- **An unreachable said under the stub:** the journey saw nothing.
  - The words stood in an alert of their own beside the stub, not in it.
  - The lost payment's journey now finds no alert on the screen.
- **The paper banner over a store that does not trade:** the blocked
  store's step passed.
  - With only the orders read unanswered, the store's other reads still
    answered, so the phone never thought the server gone, and no banner
    could stand.
  - Every call is unanswered for that step now, and the mutant is caught.

One survives, recorded:
- **The suppliers' lists read again on a confirmation:** removing that
  read is not seen.
  - Each screen is opened afresh then (its `key`), and a list is read
    whenever its screen opens, so the lists are read either way.
  - The read also covers the till's stock, which a confirmed return to a
    supplier changes. No journey goes from that confirmation to the till.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-05, after the
  review's fixes): 908 of 911 pass in 20.0 minutes.
  - `backups.spec.ts:78` fails only on this Mac, as on every batch before;
    CI runs it.
  - Two failed on this change's own new or changed lines:
    - `borrowed.spec.ts:399` looked for a «Накладні» row that is not in
      this person's «Ще». The check is gone; the row it was about is
      «Постачальникам».
    - `sales-report.spec.ts:498` read the report's refused days, which now
      had «Спробувати ще раз». The days keep a bare sentence.
  - Their two files on the same seed: 8 of 8.
- `borrowed.spec.ts:344` failed once, in a full run stopped halfway for
  the review's fixes. Its card was not found on «Постачальникам». It
  passed in both runs since, the full one among them.
- The journey files the paper sample and the stubs touch, before the
  review: 329 of 331. The two (`telegram-rules`, `till-shortage`) still
  read the old page; fixed, 3 of 3.
- After the full run, only `SalesReport.tsx` (the refused days) and three
  journey files (`borrowed`, `stores`, `supplier-invoices`) changed:
  - `borrowed` and `sales-report` on the same seed: 8 of 8;
  - the lost payment's and the blocked store's journeys: 2 of 2, with
    their two mutants caught.
- `tsc`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).

## For the owner

Nothing new to ask: the stubs are В1 (а), the banner and «Сервер не
відповідає.» В-ЗП1 (а), the sheet's «Не вказано» first В-ЗП5 (а). What was
decided here is in business-rules.md under the heading above. Words
written here, not in the task lists, for the owner to read:
- the suppliers' stubs, kind by kind: «Накладну / Оплату / Залік /
  Списання / Продаж позиченого / Повернення постачальнику ще не
  підтверджено», «Невідомо, чи записано … Перевірте результат — та сама
  операція не запишеться двічі.», «Перевірити результат …», «… записано
  один раз»;
- «Оберіть, що вносите з паперу» on the series' row.

## Not covered

- **The backend** (a follow-up): the suppliers' endpoints never say
  `recorded: false`. A check the real server refuses is therefore never
  proven to have recorded nothing, and stays kept with its words under it.
- **A real phone:** Telegram's sheet, «Назад» and keyboard are checked by
  their stubs in Chromium.
- **The rest:** the other stage-2 task points wait for the next pick.
