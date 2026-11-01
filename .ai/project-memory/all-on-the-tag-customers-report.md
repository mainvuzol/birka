# «Усе на бірці», «Покупці»: the blocks, the customer's card, the payments' words — 2026-11-01

Baseline: `8b28123` (#162, on main), and the sections task list
([P0-4, P0-5, P2-2](redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md),
their decisions and acceptance), with the spec's S19, S20, S21, §6.7 (the
mode switch), §6.8 (the list row), §6.20 (the card's header), §6.21 (the
history), §6.26 (the initials) and §4.4 (Telegram's MainButton and popup).
Status: built, reviewed and proven on this Mac; evidence below. CI is
GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/customers`. Tasks: the sections task list's P0-4, P0-5 and
P2-2, one batch (chosen in chat, 2026-11-01, «Yes, after #162 merges»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-01 («Покупці», the
customer's card, the payments' words; sections P0-4, P0-5, P2-2)". The
owner's questions В2, В3 and В5 are built by (а).

Who owes was one store at a time: the owner of two changed store to read
the other, and the paid and the written off were mixed in under one button.
A customer had a card only with two debts, its total a sum of stores; the
history was a debt's, the phone could not be copied, and the words of a
payment led to «Борги», a screen the menu no longer has. Now «Покупці» is a
block a store, each with what its own read says it is owed, never added up,
and a switch for who owes now, the paid and the written off; a row opens
the customer's card — a block a store, every debt's history newest first,
the phone to copy, «Внесок» as Telegram's MainButton into S21, the owner's
⋯ a sheet. Nothing changes on the server.

## What exists now

- **«Покупці» (S19):** «← Ще», «Покупці», «Ті, хто купує частинами»; the
  search «Ім’я або телефон» as before, searched in every block; the switch
  «Винні зараз · Сплачені · Списані» (status OPEN, SETTLED, WRITTEN_OFF; a
  pressed way, a light buzz). A block a store where the person holds
  `sale:credit` — the open store first, then the other stores that trade,
  in `/me`'s order: «МАГАЗИНУ «ЦЕНТР» ВИННІ», its `owed` from its own
  `/credits/summary` in the debt's colour, «4 покупці · 5 боргів»; under
  «Сплачені» and «Списані», «Магазин «Центр»» alone. Each block its own
  rows, twenty at a time, and its own «Показати ще»; its sum unread keeps
  its place with «Спробувати ще раз». The keeping line under the last
  block. A whole number owing nothing here still asks the stores that do
  not trade, under the open store's block.
- **The card (S20):** «← Покупці», the name; the initials, the phone to
  call and «Скопіювати» («Телефон скопійовано», a buzz; refused, «Не
  вдалося скопіювати — виділіть номер і скопіюйте його.»). A block a store,
  read by the phone: one debt is the block — what was taken, since when,
  «Сплачено X з Y» on a bar, the owner's ⋯; more are rows to the debt's
  detail; a store owed nothing, «Магазин «Ринок»: не винні»; another store
  that trades, «Внесок приймає «Ринок»». The stores that do not trade,
  found by the whole number, a row a debt with its store, no total. «ІСТОРІЯ»:
  every debt's lines, newest first, a debt opened «Частинами» with its
  total, a knot where one closed, seven and «Ще N». «Внесок» — the
  MainButton, outside Telegram the dock's one button — on the open store's
  one debt is S21 at once; on two, «На який борг вносить?», nothing chosen.
- **The debt's detail:** no payment panel any more; its «Внесок» the same
  MainButton or dock into S21. The owner's ⋯ is a sheet named by the goods:
  «Списати борг» a sheet with «Чому списуємо» and «Так, списати …»;
  «Стерти дані покупця» Telegram's popup, «Так, стерти дані покупця» the
  destructive one, and outside Telegram a sheet with the same words.
- **S21 from «Покупці»:** the till's payment screen, the menu aside while
  it stands (a kept payment too); «←» named as the screen it goes back to —
  the card or the detail, by the customer's name.
- **The words (P2-2):** «Решту — у «Продажі» › «Внесок».», «Наступні
  внески — у «Продажі» › «Внесок».», a payment's refusal «… у «Продажі» ›
  «Внесок» і спробуйте ще раз.»; a write-off's «… у «Покупцях» …». No «у
  «Боргах»» is left in `frontend/src/`.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the blocks' order and which stores have one; among blocks a search that
  finds no one says «Нікого не знайдено.», an empty «Сплачені» or
  «Списані» its own words;
- another trading store's customer opens here, read only: paid, written off
  or erased there;
- the card reads every status; the detail lost its panel; S21's «←» is
  named as the screen it returns to; the till keeps «← До боргів»;
- a write-off's refusal points to «Покупці», not to the till;
- a row's name for a screen reader still begins «Відкрити борг: …», though
  it opens the card — a reading for the owner;
- after the review: a row of two closed debts says how they closed; the
  card re-read after a change shows nothing it read before; «Внесок» waits
  while it is read again; screens open at their top.

## How it was built and proven

- **Files:**
  - `frontend/src/credits/Credits.tsx`: the blocks, each read on its own,
    the status switch, the card and S21 wired from it; a card re-read
    after a payment or write-off made away from it;
  - `frontend/src/credits/Customer.tsx` (new): the card — its header, the
    stores' blocks, the closed stores, the history, «Внесок» and its
    sheet; `Debts.tsx` is the till's chooser, renamed from it;
  - `frontend/src/credits/Debt.tsx`: no panel; «Внесок» into S21; the ⋯
    sheet, the write-off sheet, the erase popup or sheet; opens at its top;
  - `frontend/src/credits/CustomerRow.tsx`, `format.ts` (`initialsOf`):
    the row in the new form, its initials, its words by status;
  - `frontend/src/App.tsx`: «Ще» › «Люди» › «Покупці», its other blocks'
    stores, the menu aside while S21 stands;
  - `frontend/src/shared/ModeSwitch.tsx`: a switch that filters marks its
    way as pressed;
  - `frontend/src/cash/errors.ts`, `orders/Collect.tsx`,
    `orders/Collected.tsx`, `sales/Sale.tsx`: the words of P2-2;
  - `frontend/src/styles.css`: the blocks, the card, the history's thread,
    the sheets; comments elsewhere renamed.
- **Journeys:** 840 in all (830 after #162).
  - **rewritten:** `credits-list.spec.ts` (31) — the blocks at 360 × 640,
    two stores' sums from their own reads and never their sum, per-block
    search and «Показати ще», the places while read, the statuses, the
    card with one debt and with many, a phone owing two stores, the copy,
    nothing to pay, a customer gone, the closed stores, the history, both
    themes; `credits-debt.spec.ts` (the debt and S21 from the card, the ⋯
    sheets, the erase in the page and in Telegram's popup, the menu's
    return);
  - **changed:** `credits.spec.ts` (real server: a phone owing two
    stores, the write-off and erase on the card), `outage.spec.ts`,
    `outage-mark-debts-returns.spec.ts`, `stores.spec.ts` (a blocked
    store's debt paid at another by the card's «Внесок»),
    `till-sections.spec.ts`, `more-lines.spec.ts`, `outside-text.spec.ts`,
    `orders-card.spec.ts`, `fixtures.ts` — «Покупці» for «Борги», S21's
    keypad for the old field.
- **Mutants:** 46, each applied alone and its journey run; all 46 fail
  it. One first passed: the card's owed colour taken away — a base rule
  already painted it; the redundant line was removed and the card's colour
  is now asserted. Eight are the review's fixes.

## Review

An independent review of the whole change found two defects of weight and
four smaller ones; all fixed, each with its journey and its mutant.
- **Fixed:**
  - under «Сплачені» a customer of two paid debts read «Нічого не винні»
    although they might owe here now — the server reads only that status;
    the row now says how they closed, «Сплачено» or «Списано»;
  - back on the card after a payment or write-off made on S21 or a debt's
    detail, the card showed the sums it read before, with «Внесок» on
    them, until read again: what it read is dropped, and it shows nothing
    of before; while the card is read again, «Внесок» waits;
  - the owner's ⋯ gone with its sheet open (the debt read again into rows)
    left Telegram's «Внесок» hidden on the card: it comes back;
  - S21's and the detail's «←» could name the customer as the list's row
    did, not as the card's heading: they follow the heading now;
  - among the stores that do not trade, «На який борг вносить?» did not
    say whose each debt was: each names its store;
  - three journeys said more than they checked: «owing only another
    store» is now its own journey, a customer gone checks the card asked
    and left, and the history's order is asserted as newest first.
- **Found while fixing:** the card and a debt opened from a row far down
  the list kept the list's scroll, their heading above the screen; both
  now open at their top.

## Evidence

- **Full run** on a fresh seed, on this Mac, after the review's fixes:
  839 of 840 in 16.3 minutes. The one: `backups.spec.ts:78`, which fails
  only on this Mac, as on main (the local database keeps 14 nights of
  copies where the journey writes 3); nothing here touches it.
- **Before it:** the credit specs whole (79 of 79, then 58 of 58 with the
  review's journeys); the other changed specs (175 of 175, and the
  orders-card journey); `tsc -b`, `eslint src e2e` clean; Prettier: the
  files clean on main stay clean, and in those that were not, no line of
  this change is out of form.

## For the owner

The words to approve are in business-rules.md under the heading above,
«For the owner». Two readings: a row of «Покупці» is read to a screen
reader as «Відкрити борг: …» though it opens the card; and «Нічого не
винні» now shows nowhere, since every list asks one status.

## Not covered here

- **A real phone:** the MainButton, the popup, the copy and its buzz.
- **«Гроші» › «Вам винні клієнти»** (P0-7): who owes in one tap.
- **The rest of the sections task list:** the model's detail (P0-6),
  «Гроші» (P0-7), «Каса» (P1-1…P1-3), «Прийшов товар» (P1-4),
  «Інвентаризація» (P1-5), «Брак»'s row (P2-1).
