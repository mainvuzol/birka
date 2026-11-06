# «Усе на бірці», stage 2's third batch: «Нове замовлення» in the new system, «Доставка» a sheet, the steps' results, the first days on «Сьогодні» — 2026-11-05

Baseline: `ff3c6cd3` (#171, on main), and five points of two stage-2 task
lists: orders-paper ([P0-5, P1-1, P1-3](redesign/2026-11-05-redesign-tz-stage2-orders-paper.md))
and admin ([P0-1, P0-2](redesign/2026-11-05-redesign-tz-stage2-admin.md)),
their decisions and acceptance; and the backend follow-up batch 2 found.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-orders-first-days`. Task: the third batch proposed
after #171 (chosen in chat, 2026-11-05, «Orders + first days»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-05 (stage 2 batch 3:
…)". The owner's questions stand by their (а): orders-paper В-ЗП3,
В-ЗП6; admin В-А1, В-А2.

Where the orders and the first days still did their own way:
- «Нове замовлення» was the old form: the menu under it, each line a block
  of five controls on the page, «По Україні | За кордон» over the
  carriers, a page button where the card has Telegram's MainButton, and
  no question before a swipe closed it.
- «Доставка» was a screen of its own: the order out of sight while its
  waybill was typed.
- Every step said what it did in the same grey line; a reserve looked
  like «Доставку збережено».
- «Сьогодні» called the owner to approve a list the screen would not let
  them approve, never told a manager of a list to finish, and said «Вас
  нічого не чекає.» on the first day, when a warehouse had no stock yet.
- The suppliers' endpoints never said `recorded: false`.

## What exists now

- **«Нове замовлення» (orders-paper P0-5):** a task screen; the menu
  steps aside.
  - The line under its title names the warehouse, «Склад: Свій · Оля»,
    when the store has one; otherwise the store, as everywhere.
  - The cursor is in the search at once. A cell tapped puts the coat in
    the order from that cell's warehouse, puts the keyboard away, a light
    buzz.
  - The tray «У замовленні · N», what is first in it, «Разом» (a dash
    while a line has no price). Its sheet holds the lines: what and from
    which warehouse, «−»/«+» to what is free, the price with its hint,
    «Прибрати …», «Готово». A model with no price opens the sheet by
    itself, the cursor in the price.
  - «Куди»: one row of four chips, «Нова пошта · Укрпошта · Міст · За
    кордон», nothing chosen; one line under it on when the waybill is
    written.
  - Telegram's MainButton «Замовити та зарезервувати», set on entry and
    held until a line has its price; «Оберіть перевізника» without a
    carrier. Outside Telegram, the dock's one button in the tray.
  - Short of stock: the sheet opens on the line the server names. Another
    refusal: the error's plate over «Куди». The lines and the carrier
    stay.
  - Telegram asks before closing while the order holds a line.
  - Five taps with the search typed, the fifth the MainButton.
- **«Доставка» (orders-paper P1-1):** a sheet over the card, the order in
  its line, the same row of chips with where it goes now chosen, the
  waybill (or abroad, where and how) and Telegram's MainButton «Зберегти
  доставку» (outside Telegram, the sheet's own button). It asks before
  closing while changed; «Назад», Escape and the scrim close it. «ТТН ще
  немає — вписати» opens it with the cursor in the field.
- **The steps' results (orders-paper P1-3):** a reserve is torn off over
  the thread as a stub, «До відправлення», «Лоран шоколад · M · склад
  «Свій»», «Зарезервовано: 1 шт. Чекає відправлення.». Every other step
  is one line with its eyelet filled in the colour of where the order now
  stands.
- **The opening-stock lists by readiness (admin P0-1):** read wherever the
  person makes or approves them.
  - Ready: «Затвердьте початкові залишки», for whoever approves.
  - Not ready: «Доробіть початкові залишки», «5 рядків чекають рішення»,
    «Доробити», for whoever makes them.
  - «Ще»: «1 на затвердження · 1 доробити».
  - A manager is told of a list to finish, never of one to approve.
- **A warehouse awaiting its stock (admin P0-2):** «Склад «Новий» ще чекає
  початкових залишків» (or «2 склади …» with their names), «Поки їх
  немає, продажі тут — на папері», «Внести залишки» in the open store —
  for whoever makes the lists there. A shared warehouse is told once;
  «Брак», a paused warehouse and one with a list begun never.
- **A list typed is said on «Сьогодні» at once:** the lists and the
  warehouses are read again when a list is saved, approved or rejected.
- **The suppliers' refusals (backend):** an invoice, a payment, a set-off,
  a write-off, a return to a supplier and borrowed goods marked sold, once
  refused by a rule after their lookup, say `recorded: false`. A kept one
  the server refuses is settled at once.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- **«Нове замовлення»:**
  - the keyboard's «Готово» in a price closes the sheet, as the till's
    basket does;
  - the last line taken out closes the sheet and the tray, the cursor back
    in the search;
  - the MainButton pressed while the sheet is open closes it and
    reserves, so what it comes to is said on the page;
  - outside Telegram the dock's button is there, held, from the screen's
    first moment;
  - «Куди» has no visible caption, only its name for a reader; the chips
    may wrap to two rows on a narrow phone.
- **«Доставка»:** «Оберіть перевізника» stands only for an order with no
  carrier, since a chip chooses one; a card read again that failed after
  a refusal is said on the card, under the sheet, and read again once the
  sheet is closed.
- **The reserve's stub** names the warehouse as «У посилці» does, «склад
  «Свій»», not «з «Свій»» as the task list wrote: a name is never
  declined.
- **The first days' tags:**
  - the catalogue's mark, not «paper», which is the paper mode's alone
    since goods P2-3;
  - a list not ready with no undecided line says its lines;
  - the undecided lines of a store's lists are summed;
  - a shared warehouse is told once, through the first store of the day
    that sees it, the open one first, and only once every store's reads
    have answered.
- **The backend:** what is refused before a command's lookup (the body
  itself) and a command id reused with another body keep their answer, as
  in every other journal.

## How it was built and proven

- **Files:**
  - `frontend/src/orders/NewOrder.tsx`: the task screen's lines, the
    tray and its sheet, the MainButton and the dock, the shortfall in the
    sheet, the question before closing;
  - `frontend/src/orders/WhereTo.tsx`: «Куди», one row of four chips;
  - `frontend/src/orders/Shipping.tsx`: «Доставка» as a sheet, its
    MainButton, its question before closing;
  - `frontend/src/orders/Order.tsx`, `Knots.tsx`: the reserve's stub, the
    other steps' line and its eyelet's tone, the sheet's place on the card;
  - `frontend/src/App.tsx`: the task screen without the menu, the stub's
    rule, «Доробити» and «Внести залишки» from «Сьогодні», what holds the
    new order;
  - `frontend/src/today/reads.ts`, `waiting.ts`, `Today.tsx`: the lists
    read by either right, the two kinds of list, the warehouse awaiting its
    stock;
  - `frontend/src/shared/MoreLines.tsx`: «Ще»'s two counts;
  - `frontend/src/openings/Openings.tsx`: «Сьогодні»'s lists and
    warehouses read again;
  - `frontend/src/shared/ScreenHeader.tsx`: the lead under a title;
  - `frontend/src/styles.css`: the tray, the chips, the stub, the tones;
  - `backend/app/modules/suppliers/invoices.py`, `service.py`,
    `borrowed.py` and their tests: `recorded: false` (its own commit).
- **Journeys:** 920 in all (911 after #171).
  - **9 new:**
    - a press over the sheet «У замовленні» (from the review);
    - outside Telegram, the dock's one button;
    - a tap carried onto «Зберегти доставку» outside Telegram (the old
      journey split in two);
    - the lists by readiness;
    - a manager told of a list to finish;
    - a warehouse nothing was ever recorded in;
    - where no one may make the lists;
    - «Ще»'s two counts;
    - a list typed said on «Сьогодні» at once.
  - **Edited:**
    - for the task screen, the tray, the sheet and the MainButton:
      `orders-new`;
    - for «Доставка» as a sheet: `order-shipping`, `orders-card`,
      `telegram-back`;
    - for the reserve's stub: `orders`, `orders-card`, `orders-new`;
    - for the lists: `today`, `more-lines`, `openings`, and «Ще»'s line
      in `till-sections`, `models`, `catalog`;
    - for the menu stepping aside: `till-sections`.
  - **`fixtures.ts`:** the reserve's result read from its stub.

## The independent review

An agent read the change cold (2026-11-05). It found the backend's
refusals sound (every wrapped block after the lookup, nothing committed
inside one, a replay of «Продано» never refused wrongly), the two
MainButtons stacked as they should be, the questions before closing let
go when they should be, the shortfall, the stub and the rights behind the
lists and the warehouse tag as decided, the layout at 360 × 640 and the
words and plurals as the task lists and decisions say. What else it found,
and what was done:
- **Fixed:**
  - **A refusal or a lost answer hidden under the sheet:** the MainButton
    pressed with «У замовленні» open (a model with no price opens it by
    itself) said a refusal under the sheet, where the page is inert:
    nothing read out, the cursor nowhere, the buzz alone.
    - The press closes the sheet; a shortfall opens it again on its line.
    - A new journey presses over the sheet: a refusal said on the page
      and focused, then a lost answer's check in reach.
  - **A shared warehouse's tag moving between stores:** told before every
    store had answered, it could stand under the second store for a
    moment, then move. It is now told only once every store's warehouses
    and lists have answered, as the stocktakes are.
  - **The list journey's sum:** it read the lists with a filter «Сьогодні»
    does not use, and its pattern took a wrong plural. It now reads the
    same address and expects the one right form.
- **Recorded, left as built:**
  - **«Доставка» closed on iOS leaves the cursor on the page's body**, as
    «Відправити» already does: a tapped button there takes no cursor, so
    the sheet has nothing to give it back to. A fallback would take the
    cursor from the step's result after a save. Chromium focuses a clicked
    button, so the journey cannot see it.

## Mutants

33 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate20.py`,
`mutants20.sh`):
- **«Нове замовлення»:**
  - the menu not stepping aside; the warehouse's line under the title gone;
  - the tap's light buzz, the chips' choice buzz gone;
  - the sheet not opening for a model with no price, nor on a shortfall;
  - «Готово» in a price not closing it; the last line out not giving the
    search back its cursor;
  - the MainButton never held; «Оберіть перевізника» gone;
  - no question before closing;
  - the dock's room not kept before a line;
  - the press not closing the sheet (from the review);
- **«Доставка»:** the carried tap not let go, the cursor not in the
  waybill, the phone offering to finish it, no question before closing,
  the refusal not said;
- **The steps' results:** no stub, the stub's warehouse in the task list's
  words, every step's line in one grey;
- **The lists:** read only by whoever approves, every list in review
  called ready, the undecided lines miscounted, «Доробити» gone, «Ще»'s
  second count gone, «Сьогодні» not read again after a list is typed;
- **The warehouse tag:** told without the right, a shared one twice, one
  with a list begun, a paused one, told before every store answered (from
  the review), «Внести залишки» gone.

28 were caught at once. The five others needed more:
- **The chips' choice buzz:** the menu's tab is felt as a choice too, so
  the journey found one either way. It now looks only at what the chip's
  tap adds.
- **The dock's room before a line:** the journey measured it only once a
  line was in. It now measures it on entry.
- **No question before closing «Доставка»:** the mutant took away only one
  of its four terms, so the waybill still asked. It now takes the whole
  question away, and is caught.
- **«Сьогодні» not read again after a list is typed:** the mutant was set
  against a «Сьогодні» journey that never types one. Run against
  `openings`' journey, which does, it is caught.
- **Told before every store answered:** the journey checked only the end.
  It now holds «Центр»'s lists while «Ринок» answers and keeps every
  heading the page ever showed: «3 склади …» under «Ринок» must never be
  among them.

All 33 are caught now, each on the check it was written for.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-05, after the
  review's fixes and the mutants' journeys): 917 of 920 pass in 20.5
  minutes.
  - `backups.spec.ts:78` fails only on this Mac, as on every batch before;
    CI runs it.
  - Two failed on this change's own effects:
    - `till-sections.spec.ts:341` looked for «Замовлення» marked in the
      menu on «Нове замовлення», a task screen now with the menu put
      aside. It now finds the menu hidden there and «Замовлення» marked
      once back by «← До замовлень».
    - `till-sections.spec.ts:735` read «Ще»'s «Товар і каталог» line
      without «N доробити». The count is allowed for there, and in
      `models.spec.ts` and `catalog.spec.ts`, which passed only because
      no list waited to be finished in that run.
  - Those three files on a fresh seed: 60 of 68. The eight others are
    Ліда's at «Центр»'s till, which need the stock an earlier spec puts
    there; run after `cash`, `credits` and `outage`, as every full run
    does: 210 of 210.
- Run after the review's fixes, `today.spec.ts:1413` failed once: the
  journey's clock, run on a minute, let a warehouse read go before its
  stub answered it. The stub now lets that answer go, as
  `openings-file`'s do.
- The journeys the mutants' survivors were caught by, on the real code:
  6 of 6.
- The journey files this change touches, before the review: 123 of 130,
  then 138 of 138 once the journeys waited for a sheet's taps and read
  the step's result where it is.
- The backend: 3479 pass, 2 skipped. Six fail: the catalogue evaluation,
  which needs a database named `birka_test` (CI's) or
  `birka_catalog_eval`. ruff and mypy: clean.
- `tsc`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).

## For the owner

Nothing new to ask: «Нове замовлення» and «Доставка» are В-ЗП3 and
В-ЗП6 (а); the lists by readiness and the warehouse tag are В-А1 and
В-А2 (а). What was decided here is in business-rules.md under the heading
above. Words written here, not in the task lists, for the owner to read:
- «Склад: Свій · Оля» under «Нове замовлення»'s title;
- «ТТН впишете, коли відправите.» and, abroad, «Куди і як відправили —
  впишете, коли відправите.» under «Куди»;
- «склад «Свій»» in the reserve's stub (the task list wrote «з «Свій»»);
- «1 на затвердження · 1 доробити» in «Ще».

## Not covered

- **A real phone:** Telegram's MainButton, sheet, «Назад», keyboard and
  question before closing are checked by their stubs in Chromium; the
  cursor after «Доставка» closes on iOS (above) is not checked at all.
- **«Початкові залишки» reading the warehouses again:** what the
  stocktake screen's warehouses read again after a list is approved is
  checked by the review alone: a warehouse's history in the shared E2E
  database is not the same from run to run.
- **The backend's catalogue evaluation tests** need a database named
  `birka_test` or `birka_catalog_eval`; this Mac's test cluster has
  another name, so they fail here (6) and run on CI.
- **The rest:** the other stage-2 task points wait for the next pick.
