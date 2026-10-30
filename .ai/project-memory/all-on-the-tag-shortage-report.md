# «Усе на бірці», the till, part 3: the shelf's question as a sheet, the paper switch, the taps — 2026-10-30

Baseline: `f9f7376` (#154, on main), and the frame's task list
([P0-5](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), items 5 and 7,
and its acceptance).
Status: built and reviewed; evidence below. CI is GitHub's, on the pull
request. Not yet seen on a real phone (С6).
Branch: `feat/till-shortage`. Task: the frame's P0-5, part 3 of 3; P0-5 is
closed with it.
Chosen: business-rules.md, "Chosen in chat — 2026-10-30 (the till's
shortage sheet, paper switch row and taps, «Усе на бірці» P0-5, part 3)".

Part 2 put the basket in a sheet over the till and left the shelf's
question on the page. «Залишку не вистачає» stood under the list, 357 px
of it at 360 × 640, and the till's search let go of the top while it stood
so that the answer could fit over the tray. «Вношу продаж з паперу» was a
plain checkbox over the warehouse's name. Here the question rises as a
sheet of its own, the search stays at the top, the paper's switch is a row
under the search, and a sale's taps are counted.

## What exists now

- **The shelf's question as a sheet** (spec §4.3, S09; `shared/Sheet.tsx`),
  titled «Залишку не вистачає»:
  - its words and answers as on the page before, each with its rights and
    what it sends: «… у кошику N шт., в обліку M шт.», «Розмір з етикетки —
    продати як …», «Товар на місці — продати N · {спосіб}», «На полиці
    немає жодної — …», «На місці фактично є, шт.» with «Продати стільки,
    скільки є · {спосіб}», «Покличте менеджера…», «Немає на полиці? …»,
    «Прибрати з кошика»; the paper sale's and the unknown line's words;
  - it rises from the bottom over the tray and the menu, the till dimmed
    behind and out of reach, the cursor in it; read aloud, its title and
    then its first line, what it is about;
  - for a moment after it rises it lets a tap go, as the basket's sheet
    does: the second tap of a double press on a way never lands on «Товар
    на місці»;
  - a count it cannot take is said right under «На місці фактично є», in
    view with it, not on the page under the sheet; «Прибрати з кошика»
    takes it away with the line, and, the basket emptied, puts the cursor in
    the search;
  - closed by Telegram's «Назад», Escape or a tap on the dimmed till: it
    sells nothing; the basket stays, with what was answered so far; a way
    pressed again asks the server afresh, under the same `command_id`;
  - an answer that leaves less to sell than the sum paid now opens the
    basket's sheet with what the terms need, as a way pressed does, the
    line the question is about marked; the question waits under it and is
    back once it closes, without the terms' words. One sheet at a time;
  - an answer refused for a reason of its own closes it, and the refusal,
    at the page's end under a long list, is brought into view over the
    tray, the basket kept.
- **The till's search stays at the top** whatever stands: the question no
  longer stands in the page.
- **«Вношу продаж з паперу» as a switch row** (spec S08):
  - under the search, over the list, 44 high, the switch at its right; the
    whole row is its target, read aloud as a switch;
  - the same state as before, and as «Ще»'s switch: on, «Режим: продаж з
    паперу» stands over the till and the paper's fields — the kind, «Хто
    продав», when — under the row, still over the list;
  - turned on by its row, the paper's fields are brought into view, clear
    of the held search and the tray: with a coat in the basket, at
    360 × 640, they were under the tray, and the ways wait for them;
  - where the till shows no search — a warehouse waiting for its opening
    list, the catalogue, no warehouse to sell from — it stands where the
    search would; while the warehouses are read, under the grey field, 6 px
    from where it stays once the search comes.
- **A sale's taps** ([hot-path budget](hot-path-budget-report.md), the
  update of 2026-10-30): three for a coat with a price — the search, its
  size's cell, a way — in a store with one warehouse and in one with two;
  five paid in parts, the tray's row and «Оплата частинами» besides, the
  keyboard's key moving through the customer's fields and closing the
  sheet. Typing is not counted.

No backend change. No right or rule changes.

## Decided here, not by the owner

- **Closed, the question is withdrawn,** not answered: nothing sold, the
  basket and its answers kept, the same `command_id` when a way is pressed
  again. The spec's sheet is closed by the same ways as any other.
- **The carried tap let go** in the question too: «Товар на місці» records
  a coat found, and a second tap of the way pressed must not be it.
- **One sheet at a time:** the basket's sheet, opened by an answer to mend
  the terms, stands alone; the question waits under it.
- **The count's refusal in the sheet,** at its top: on the page it would
  stand behind the sheet, unread.
- **The search held at the top again** in every state of the till.
- **The paper's fields under the switch,** not in a sheet: they are few,
  and a paper sale fills them once for many lines. Brought into view as
  the row turns on; turned on in «Ще», the till opens where it opens.
- **The row is the box itself,** read as a switch (`role="switch"`), the
  box over the whole row: a tap anywhere on it turns it.
- **Two taps when the app opens on the till:** the cursor is in the search
  already (part 2); the task list's three are counted from the till.

## How it was built and proven

- **Files:**
  - `sales/Sale.tsx`: the question in a `Sheet`, its count's refusal in
    it, closed by its ways; `shortShown`, the question waiting under the
    basket's sheet; the paper switch row (`paperRow`), under the search or
    where the search would be (`searchShown`); the search always held at
    the top; the question's own scroll and cursor taken out, the sheet's
    used;
  - `sales/StockSearch.tsx`: `under`, what stands under the search, over
    the list;
  - `sales/Sale.tsx` also: a refusal brought into view; the paper's fields
    brought into view as the row turns them on; the basket's sheet closed
    over the question taking the terms' words with it;
  - `styles.css`: `.switch-row`, the switch drawn from the box's state;
    `.short-sheet`, the answers full width;
  - `shared/Sheet.tsx`: `said`, what a sheet is about, read with its title;
    the cursor's way back skips a way pressed that waits for its answer;
  - `shared/Placeholder.tsx`: `under`, what stands between the grey field
    and the grey tags;
  - new journeys: `e2e/till-shortage.spec.ts`, `e2e/till-taps.spec.ts`;
    `e2e/fixtures.ts`: `shortage`, the question once it takes taps.
- **Journeys** (`till-shortage.spec.ts`, the goods and the sale's answer
  stubbed):
  - a way pressed with three coats and two in the books: the sheet rises,
    its words and answers, whole in view, the till `inert` behind it, the
    search still held at the top, no alert on the page;
  - closed by Escape, by the scrim, by Telegram's «Назад»: nothing sold,
    «Кошик · 3» on the tray, a way pressed again sends the same
    `command_id` again, with no answer in it;
  - «Товар на місці» tapped as the sheet rises sends nothing; a moment
    later it sells, `found_in_store` with it;
  - read aloud with its line: the dialog's description «Лоран шоколад · M:
    у кошику 3 шт., в обліку 2 шт.»;
  - «На місці фактично є» given 5: «Вкажіть від 1 до 2 шт. …» in the
    sheet, right under the field, both in view, nothing sent; «Прибрати з
    кошика»: no sheet, no tray, no alert on the page, the cursor in the
    search;
  - paid in parts with 3 000 paid now, «Продати стільки, скільки є» for
    one: the basket's sheet with «Покупець сплачує все одразу (1 850,00 грн)
    …», one dialog only, the line marked; «Готово», and the question is
    back, with no alert in it;
  - at 360 × 640 the switch row under the search and over the first tag,
    44 high; a tap on its words turns it, «Режим: продаж з паперу» and
    «Хто продав» under the row; «Ще»'s switch says on;
  - the warehouses held unread: the row under the grey field, and within
    8 px of there once the search comes;
  - eight models at 360 × 640, «Товар на місці» refused as held for an
    order: the refusal whole in view, «Кошик · 3»;
  - a coat in the basket at 360 × 640, the row turned on: «Що вносите з
    паперу?» between the held search and the tray.
- **Journeys** (`till-taps.spec.ts`, the page's own counter of
  `pointerdown`): three taps, one warehouse; three taps, two warehouses,
  the cell of the second, the line sent from it; five taps paid in parts,
  the name, the phone and the sum closed by the keyboard, `paid_now`
  «1000.00».
- **Journeys changed:** every journey that read the question as the page's
  alert reads it as the sheet, waits for it to take taps before an answer,
  and closes it before reaching the tray or the menu under it; the paper's
  box is read as a switch; `till-redesign.spec.ts` checks the sheet whole
  in view and «Прибрати з кошика» in it, where it checked the answer over
  the tray.

- **Proven to catch**, each broken once, its journeys run, then undone.
  Sixteen breaks, each failing the journey named for it:
  - both sheets shown at once: the question not waiting under the
    basket's;
  - the search held at the top only without a question standing;
  - the question's close not withdrawing it;
  - the count's refusal said nowhere; or only at the sheet's top;
  - the switch row over the search, not under it;
  - the switch read as a checkbox, not a switch;
  - the carried tap taken;
  - the switch row 24 high (and `till-receipt.spec.ts`'s rows of 44);
  - the keyboard's key not moving from the name on (`till-taps.spec.ts`,
    paid in parts);
  - the basket's sheet leaving the terms' words to the question;
  - «Прибрати з кошика» leaving the count's refusal on the page and the
    cursor nowhere;
  - the question not read with its line;
  - the refusal not brought into view;
  - the switch row under the grey tags while the warehouses are read;
  - the paper's fields not brought into view.
- **Journeys:** 764.

## Review

An independent review of the uncommitted tree found:
- the paper switch drawn once in every state of the till;
- the two sheets never open at once, and they swap cleanly;
- the question's close clearing what it should;
- the same `command_id` on a way pressed again;
- the switch row read as a switch, 44 high, at 360 px.

It also found the following, fixed before the commit:
- **A count's refusal left on the page:** a count refused, then «Прибрати
  з кошика», left «Вкажіть від 1 до 2 шт. …» on the page under the search.
  Now it goes with the line. With the basket emptied, the cursor goes to
  the search; it was on the page's body. A journey covers both.
- **The terms' words in the question:** the basket's sheet, opened over
  the question for the terms and closed, left its words at the question's
  top, whether the terms had been mended or not. Now they go with the
  sheet: by «Готово», by the keyboard's «Готово», by any way it closes. A
  journey checks there is no alert in the question.
- **The switch row jumping as the warehouses came:** while they were
  read, the row stood under the grey field and the three grey tags, some
  450 px down. Now it stands between the grey field and the grey tags,
  6 px from where it stays (the grey field keeps the label the other
  screens' fields have). A journey holds the warehouses unread.
- **A refusal under a long list:** an answer refused for its own reason
  closed the question and said so at the page's end, out of sight under
  eight models. Now it is brought into view over the tray, as «Повернення»
  brings its own. A journey covers it.
- **The count's refusal far from its field:** it stood at the sheet's top,
  scrolled away with the keyboard up. Now it stands right under the field.
- **Less read aloud:** the page's section had been an alert, read whole.
  The sheet is now read with its first line after its title.
- **The cursor's way back to a way that waits:** a way pressed is
  disabled while its answer is sent, so the cursor goes to the tray's row.
- **Journeys weaker than their titles:**
  - the carried tap is now a finger's click sent at once, not one that
    waits for the sheet to settle;
  - the basket's line is checked marked in the terms' detour.

Kept as they are:
- **The tap counter counts the journey's own presses.** What proves the
  budget is that the sale is recorded with only those presses.
  `till-taps.spec.ts` would fail on any press more, from a helper or a
  step the till came to need.
- **`outage.spec.ts` 7c checks less now:** the switch can no longer be
  ticked while the question stands, because the till is out of reach
  under the sheet. It checks the closed question is not back.
- **The question has no close button of its own.** It closes by
  Telegram's «Назад», Escape, a tap on the dimmed till and its handle. The
  variant for a line not in this basket has no button at all. A «Закрити»
  would be a word the spec does not have: a reading for the owner.
- **The paper switch turned in the catalogue's view** leaves the catalogue,
  as before, and the row moves under the search: a keyboard's cursor on it
  is lost. On a phone, nothing is.

After the review, the screenshots at 360 × 640 found the paper's fields
under the tray. With a coat in the basket, the row turned on drew «Що
вносите з паперу?» under it, and the ways waited for an answer the seller
could not see. Now the fields are brought into view as the row turns them
on. A journey covers it.

## Evidence

On the Mac, against the E2E API and PostgreSQL 17:
- **e2e, the seed run afresh:** all 764 journeys, 763 passed. The one
  failure is `backups.spec.ts`: it finds more nights than it expects,
  because the local seed only adds, as on main. That run came before the
  paper's fields were brought into view. After that change, the ten specs
  that turn the switch were run again: 254 passed.
- **Before the review's fixes**, the same: 762, 761 passed, `backups`
  alone failed. An earlier run on the database not seeded afresh also
  failed `sale.spec.ts` on its stock sold out.
- **frontend:** eslint, tsc and the build are clean. App 516.91 kB (516.09
  before), parts 2.61 kB, icons 6.56 kB, vendor 210.85 kB.
- **Screenshots** at 360 × 640, light and dark (throwaway): the question's
  sheet over the till, whole; the switch row off under the search; the
  switch on with a coat in the basket.

## Not covered here

- **On a real phone** (С6): the question's sheet under a thumb, the
  carried tap, the switch row's tap, the keyboard over «На місці фактично
  є».
- **A «Закрити» in the question's sheet** (above): a reading for the owner.
- **P1-2:** the light tap and the coat's `drop` to the tray.
- **In dark, the tags sit on the till's card**, as after part 1.
- **The app's own file past 500 kB:** still to choose.
