# «Усе на бірці», stage 2's quick wins: no rule said, one word for pieces, the shop's words, the marks — 2026-11-05

Baseline: `b11b926` (#169, on main), and the small points of the four
stage-2 task lists: goods ([P1-5, P2-1, P2-2, P2-3](redesign/2026-11-05-redesign-tz-stage2-goods.md)),
orders-paper ([P1-4, P2-3](redesign/2026-11-05-redesign-tz-stage2-orders-paper.md)
and the done key of P0-5 and P1-1), admin
([P1-1, P1-2](redesign/2026-11-05-redesign-tz-stage2-admin.md)) and money
([P1-2, P2-1, P2-2](redesign/2026-11-05-redesign-tz-stage2-money.md)),
their decisions and acceptance.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-quick-wins`. Task: the quick wins before the second
batch of P0s (chosen in chat, 2026-11-05, «Quick wins first»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-05 (stage 2 quick
wins: …)". The owner's questions stand by their (а): В-ЗП4, В6, В8.

Small things a shop notices every day. A seller without a right was told
the rule, and who has it. Pieces were «од.», «одиниць», «шт» or «шт.»,
screen by screen. A name's answer in the catalogue was said in the
system's words. The new order's verb was a bare «+». A blocked store
showed its people a banner and «Оновити». The price's two scopes hid in a
list's wheel. And «Закриття» and «Змінити спосіб оплати» drew their
results as grey badges.

## What exists now

- **No rule said (goods P1-5):** what a person may not do is simply not
  offered, with no sentence about the right.
  - «Перевірка каталогу» is in «Ще» with its right alone; a tab left
    there when the right goes opens «Ще».
  - «Початкові залишки»: the lines without «Розібрати рядок», and
    «Відхилити його можете й ви.» to whoever may not approve.
  - «Моделі»: «Така назва вже є в іншої моделі.», and no «Об’єднати з
    іншою» without the right.
  - «Інвентаризація» with no warehouse to count: «Тут немає складу для
    інвентаризації.»; «Прийшов товар» with none to receive into, «Тут
    немає складу для приймання.»; «Залишки» with none, «Тут немає
    складів.».
  - A catalogue operation kept on the phone when its right goes: its
    screen stays, checks it and settles it; then «Ще».
  - «Перевірка каталогу» with no candidates: «створіть товар» only to
    whoever may.
- **«шт.» everywhere it counts pieces (goods P2-1, money P2-2):**
  «Інвентаризація», «Виправити залишок», «Початкові залишки», «Звіт про
  продажі», «Позичене й під реалізацію» and the returns to suppliers;
  «з «Браку»» on a return from «Брак».
- **The shop's words (goods P2-2):** «Цей опис — назва товару?», «Так,
  це його назва» / «Ні, не про нього», then «Збережено: «{опис}» — назва
  {модель}.» or «— не назва {модель}.»; «Старі продажі…»; «Прийшов
  товар» wherever the section is named; «Назва моделі або колір» in the
  catalogue's search; «Спробувати ще раз» for every failed read.
- **The catalogue's mark (goods P2-3):** on «Перевірка каталогу»,
  «Початкові залишки» and «Моделі» in «Ще», and on the lists' line on
  «Сьогодні».
- **«+ Нове замовлення» in words (orders-paper P1-4):** beside
  «Замовлення» on one row at 360 px in the app's face; under it, whole,
  in the device's face or with larger text, the title's word never
  broken. No orders yet: the large tag drawn, a row, its meta and a quiet
  «Нове замовлення».
- **«Готово» on the keyboard (orders-paper P0-5, P1-1):** the new order's
  price and the delivery's waybill; Enter puts the keyboard away and
  sends nothing.
- **A blocked or closed store, to its own people (admin P1-1):** one blank
  tag: «Магазин заблоковано власником з …» or «Магазин закрито, в архіві
  з …», the line «Продажі, приймання, повернення й оплати тут зупинено.
  Зверніться до власника.» and «Спробувати ще раз».
- **The price's scope (admin P1-2):** «Для всіх магазинів» and «Лише
  «{магазин}»» as two segments on one row, the same one first as
  before, a long name cut with «…» and read whole.
- **«Закриття» (money P1-2):** stickers with their sign — the knot for
  «Збіглося», the triangle for a shortage or a surplus — and each close's
  eyelet at its row's left: tied, or a ring while its reason waits.
- **«Змінити спосіб оплати» (money P2-1):** the way as the sale stub's
  sticker, its glyph centred beside its words; the days as «Надійшло»'s
  switch.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the catalogue's tab without its right opens «Ще», never a refusal;
- «Збережено.» alone when the proposal or the model's name is no longer
  read; «Автоматичне підтвердження назв вимкнене.» is no longer said;
- the catalogue's no-candidates sentence by whether the person may
  create;
- «Спробувати ще раз» on the goods screens too, with orders-paper P2-3;
- the header's verb a text button with no padding and an 8 px gap, so the
  title and the verb share a row at 360 px on both fonts;
- the waiting ring in the warning's colour.
- Left as they are: the stores' «од.» on «Магазини», «одиниць» in
  sentences no task list names, the phone's-memory sentences, «Залишки»'s
  «Доступних складів немає…», «Наступні товари» (goods P0-4) and the
  report's day by day (money P1-1).

## How it was built and proven

- **Files:**
  - `frontend/src/App.tsx`: the blocked store's blank tag; the
    catalogue's tab and rows;
  - `frontend/src/catalog/Catalog.tsx`, `Models.tsx`,
    `frontend/src/inventory/*.tsx`, `frontend/src/openings/*`,
    `frontend/src/suppliers/*.tsx`, `frontend/src/reports/SalesReport.tsx`,
    `frontend/src/today/Today.tsx`: words, «шт.», the mark;
  - `frontend/src/orders/Orders.tsx`, `NewOrder.tsx`, `Shipping.tsx`,
    `shared/ScreenHeader.tsx`: the verb and the title's row that wraps,
    the empty state, the done key;
  - `frontend/src/prices/SuggestedPrice.tsx`, `shared/ModeSwitch.tsx`: the
    scope's switch;
  - `frontend/src/cash/History.tsx`, `Fix.tsx`, `Cash.tsx`,
    `shared/Stub.tsx`: the stickers, the eyelets, the days' switch;
  - `frontend/src/styles.css`: the verb and its row, the empty state, the
    scope's cut, the close's sticker and eyelet, the way's glyph.
- **Journeys:** 905 in all (897 after #169).
  - 8 new: «Нове замовлення» in words on the title's row at 360 px, in
    the app's face, and under the title in the device's face and at 320
    px; the price's two segments at 360 px; a blocked store's seller
    opening it with «Спробувати ще раз» once it trades again; a store with
    no warehouse to count, and none to receive into; «Прийшов товар»'s
    first read refused, with «Спробувати ще раз»; a catalogue operation
    kept when its right goes.
  - Edited to the new words, marks and switches: `stores`, `session`,
    `catalog`, `models`, `openings`, `openings-file`, `stocktake`,
    `correct`, `more-lines`, `today`, `orders-list`, `orders-new`,
    `order-shipping`, `receive`, `stock`, `price`, `cash`, `cash-history`,
    `cash-correct`, `cash-move-fix`, `person-limit`, `suppliers`,
    `borrowed`, `sales-report`. They check that no rule is said
    (`/право/`, «Зверніться»), «шт.» where «од.» stood, the name answer's
    saved words, the catalogue's mark, the verb's words and glyph, the
    done key and Enter putting the keyboard away, the blank tag's title,
    status and retry, the scope's pressed segments, the close's stickers
    and eyelets, and the way's glyph drawn beside its words.
  - **`fixtures.ts`:** `openStore` waits for the blocked store's blank tag;
    `expectGlyphBeside`; `shippedFace` skips `about:blank`.

## The independent review

An agent read the change cold (2026-11-05). It found the words, the marks
and the switches as the task lists ask, and the journeys sound. What else
it found, and what was done:
- **Fixed:**
  - «+ Нове замовлення» fitted beside «Замовлення» at 360 px with about
    4 px to spare, and only in the app's face, which is `optional`: in
    the device's face (Roboto on CI and Android, Arial Narrow on the Mac),
    or with the phone's text a little larger, the title broke inside its
    word, «Замовленн|я». The title's row now wraps — the verb goes under
    the title, whole — by a class, not `:has()`. The journey measures in
    the app's face once it is drawn, and a new one checks the device's
    face, and 320 px, where the verb goes under;
  - the way's sticker on «Змінити спосіб оплати» and on its rows had its
    glyph on the words' baseline, touching them: it is centred beside them
    now, 4 px apart, wherever the sticker stands (a return's and a
    payment's too). The journeys check where the glyph is drawn, not only
    that it is there;
  - goods P1-5's acceptance search still found two sentences of the right:
    «Немає складу, куди цей магазин може приймати товар. Зверніться до
    менеджера.» on «Прийшов товар», now «Тут немає складу для
    приймання.», and «Доступних складів немає. Зверніться до менеджера.»
    on «Залишки», now «Тут немає складів.» (both decided here), each with
    a journey;
  - a catalogue operation kept on the phone when its right goes: the tab
    went to «Ще», where every row was held by it and nothing said why —
    and since only its screen checks it, it would never be settled. Its
    screen now stays while it is kept, checks it, says the server's
    refusal and offers it again; once answered, «Ще». A new journey;
  - «свідчення» was still said twice: in a conflict («зберігати відповідь
    ще раз не потрібно») and for a description too long («назва — до 200
    символів»). The journey's check is case-insensitive now;
  - the way's sticker with no way and no words drew an empty sticker: it
    draws nothing (no caller does this yet);
  - the journeys' `openStore` waited for any «Спробувати ще раз», which the
    sign-in and «Доступу ще немає» show too: it waits for the blocked
    store's own blank tag now;
  - «Для всіх магазинів» is checked whole beside a long store's name.
- **Recorded, left as built:**
  - the phone's-memory sentences («Некоректне збережене приймання.
    Зверніться до менеджера.» and eight more) are one family across every
    journal and speak of a damaged record, not a right; the acceptance
    search finds three of them in `inventory/`. Changed with the memory
    plate's words, not here;
  - «Ні, не про нього» answers for the model chosen in «Товар, якому ця
    назва не відповідає», the field above it; the TZ's words, with the
    block under one question that goods P1-1 draws, not yet built;
  - «Показати ще» for the report's «Попередні» / «Наступні» and for
    «Наступні товари»: money P1-1 and P0-4, as the TZ ties them.

## Mutants

48 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate18.py`,
`mutants18.sh`):
- no rule said: the openings' rights alert back, the model's second
  sentence, the stocktake's, the receipt's and «Залишки»'s old sentences,
  who approves a list; a catalogue operation kept without its right, its
  screen not kept or left too soon;
- «шт.»: the stocktake, the correction, the openings (two), the report,
  a lot and a return to a supplier; «з «Брак»»;
- the name answer's saved words and its legend; the catalogue's mark on
  «Моделі» and on «Сьогодні»'s line;
- the verb: its words hidden, its padding, its gap, its row not wrapping,
  the header not asked to wrap; the empty state's tag and quiet button;
  the done key and the keyboard put away, on the price and the waybill;
  «Спробувати ще раз» on «Прийшов товар»;
- the blank tag: its title, its line, its status, its retry;
- the price's scope: not pressed, not cut, the other one first, the line
  of the shared price back;
- «Закриття»: each sign, the ring's condition, the knot; the way's
  glyph, its sticker on the row, its layout; the days not pressed.

All 48 are caught. Two needed more:
- «Спробувати ще раз» on «Прийшов товар» was first run against a journey
  that checks the plate is not shown; no journey opened a failed first
  read. A new one does, and catches it;
- the verb's gap taken to 0 is not seen: `space-between` keeps the title
  and the verb 12 px apart at 360 px whatever the gap. The gap moves only
  where the row wraps, so the mutant is now a gap of 16 px, which wraps it
  in the app's face, and is caught.

Seven would have passed the journeys as they stood before the review: the
row not wrapping, the header not asked to wrap, the way's sticker laid out
inline, «Прийшов товар»'s and «Залишки»'s sentences of the right, and the
catalogue's screen not kept, or left too soon, for an operation kept
without its right.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-05, after the
  review's fixes): 900 of 905 pass in 19.3 minutes.
  - `backups.spec.ts:78` fails only on this Mac, as on every batch before;
    CI runs it.
  - Four journeys this change had not reached still read the old screens:
    `till-redesign.spec.ts:308` and `:328` waited for «Оновити» on a store
    that does not trade; `outside-text.spec.ts:126` tapped the days as
    radios; `supplier-invoices.spec.ts:241` read «2 од.». Updated to the
    blank tag, the days' switch and «шт.»; their three files on a fresh
    seed: 21 of 21. Only those files changed after the full run; every
    journey was then searched for the old words, and none is left but those
    recorded above.
- The journey files this change touches, with «Залишки», the returns and
  the payments (the way's sticker), on a fresh seed after the review's
  fixes: 367 of 368. The one that failed, «Нове замовлення» at 360 px,
  threw as `shippedFace` loaded the face on `about:blank`, which its
  journey opens first; fixed in the fixture, it and the device's face pass
  three times each.
- Before the review, the journey files this change touches: 227 of 227.
- `tsc -b`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).

## For the owner

Nothing new to ask: «+ Нове замовлення» in words is В-ЗП4 (а), «шт.» and
«з «Браку»» are В6 (а), and a close opened from «Закриття» stays a card,
В8 (а). What was decided here is in business-rules.md under the heading
above. Words written here, not in the task lists, for the owner to read:
- «Відхилити його можете й ви.» on a list someone else approves;
- «Кандидатів немає. Перевірте опис або відхиліть пропозицію з
  поясненням.» to whoever may not create a model;
- «Тут немає складу для приймання.» and «Тут немає складів.»;
- «Збережено: «{опис}» — не назва {модель}.», and «Збережено.» alone;
- «…зберігати відповідь ще раз не потрібно.» and «Опис задовгий для
  назви: назва — до 200 символів.».

## Not covered

- A real phone: the keyboard's «Готово» is checked by its attribute and
  by Enter in Chromium; Telegram's keyboard is not seen.
- The rest of the four stage-2 task lists waits for the next pick.
