# «Усе на бірці», «Прийшов товар» — 2026-11-03

Baseline: `9d11b16` (#165, on main), and the sections task list
([P1-4](redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md), its
decision and acceptance), with the spec's S24.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/receive`. Task: the sections task list's P1-4 (chosen in
chat, 2026-11-03, «Yes, start P1-4»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-03 («Прийшов товар»;
sections P1-4)". The design's Q-6 stays «if no».

A delivery was a form of seventeen controls: the warehouse, the size and
how it came in native lists, the quantity in a field, «Додати до поставки»
for every size and «Прийняти на склад» at the end of it — a model in two
sizes took 14 taps, where the notebook says «Марсель молочний: S 2, M 1».
Now the warehouse is a chip, the model a line once found, each of the
organization's sizes a stepper, how it came and its price one row with a
sheet behind it, and Telegram's MainButton «Записати прихід · 3 шт.»
records it: 8 taps. A delivery is still one record of every line; nothing
changes on the server.

## What exists now

- **The warehouse:** chips of those that take deliveries here (active,
  received into, not «Брак»), none chosen while two or more; the only one
  said, «Склад «Основний»»; none, the old words.
- **The model:** the catalogue's search until one is chosen; then its name
  and «Змінити», which clears what was counted and its price; from a
  model's detail, chosen already. Its selling price in one row, as before.
- **The sizes:** the organization's, a stepper each, two to a row — the
  code at 24, «−» and «+» at 44, the count between them, which may be typed
  too (10000 at most); a light tap on «+».
- **How it came:** one row, «Закупівля · ціна не вказана ›», opening «Як
  надійшов»: the kinds as chips (`supplier:debt`), the purchase or agreed
  price, the supplier and the approved line for goods owed, the note,
  «Готово».
- **«Додати ще модель»:** the counted sizes into «У поставці», the next
  model from the search.
- **Recording:** «5 шт. · склад «Каса-склад»» under it; Telegram's
  MainButton «Записати прихід · N шт.» (outside Telegram the dock's
  button): what is listed and what is counted, sent as one delivery;
  refused, the list is kept and sent again is the same delivery. Telegram
  asks before closing while anything is counted.
- **Recorded:** «Прийшло 5 шт. · склад «Каса-склад» · Закупівля» with the
  check, the recorded stub with a line a lot, «Прийняти ще».

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- paused, not-received-into and «Брак» warehouses are no longer listed;
- a count may be typed as well as stepped;
- what the row says and what the sheet keeps;
- the 200 lines' words, «ціна з помилкою»;
- the words of the result, and «шт.» for «од.».

## How it was built and proven

- **Files:**
  - `frontend/src/inventory/Receive.tsx`: S24, rewritten;
  - `frontend/src/suppliers/Picker.tsx`: its list read only when wanted,
    and a new supplier as typed kept by the screen that asks;
  - `frontend/src/App.tsx`: «Прийшов товар» afresh once a kept delivery is
    proven recorded;
  - `frontend/src/styles.css`: the screen on the page, its steppers, row
    and price.
- **Journeys:** 874 in all (868 after #165).
  - **`receive.spec.ts`** (12, 6 new): the TZ's acceptance — a model in two
    sizes in 8 taps, one delivery with its lines a size each; two models in
    one delivery, «Змінити» and «Прибрати» by size; 360 × 640 with four
    sizes, the model, the steppers and the button unscrolled, in both
    themes, a seller's sheet with no kinds; Telegram's MainButton held,
    put away under the sheet, its light tap, «success» and the question
    before closing; a read that fails again; 200 lines at most. And the old
    six on the new screen: chips with none chosen and no «Брак»; counts
    typed and stepped; the price refused in the sheet; a line already
    listed; the command's identity through refusals, a size counted after
    and a line taken out; a kept delivery proven recorded opening afresh;
  - **`borrowed.spec.ts`:** the kinds in the sheet, the agreed price, the
    supplier on the row, a new supplier kept while the sheet is closed,
    another supplier as another delivery; a seller with no kinds;
  - **moved to the new screen:** `models.spec.ts`, `openings.spec.ts`,
    `price.spec.ts`, `size-spelling.spec.ts` (the steppers' codes),
    `returns.spec.ts` (no «Брак» chip), `model.spec.ts`, `outage.spec.ts`,
    `till-sections.spec.ts` (its title); `fixtures.ts` (`receiveInto`,
    `receiveModel`, `receiveSize`, `receiveUnits`, `receiveWay`,
    `recordReceipt`).

## The independent review

An agent read the change cold (2026-11-03). It found the delivery's
identity, its one body, the limits and the warehouses right. What else it
found, and what was done:
- **Fixed:**
  - a read of the sizes or the warehouses that failed again — back from
    another chat on a poor line — put «Повторити завантаження» over the
    steppers and the chips, while the button still recorded them: they stay
    as read now (`receive.spec.ts`, «a read that fails again»);
  - a price that is not money read «ціна не вказана» on the row: «Готово»
    says so in the sheet, and the row says «ціна з помилкою»;
  - «−» at 0 was disabled under the cursor: held now, the cursor stays;
  - «Прибрати {модель}» was the same for each size of a model: read with
    its size and price;
  - the row did not say what it opens: read «Як надійшов: …»;
  - a new supplier being typed was lost when the sheet closed: kept;
  - a kept delivery proven recorded by the app's check left its list on
    the screen, and edited it would have been recorded again (so on the
    old screen too): the screen starts afresh;
  - what was said stayed after a line was taken out or a warehouse chosen.
- **Left as they were (as on the old screen):** the cursor after «Прийняти
  ще» and after «Прибрати».

## Mutants

41 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate14.py`,
`mutants14.sh`): the warehouses offered and chosen; the delivery's
identity through a refusal, a size counted after, a line taken out and
another supplier; the supplier sent only when owed; the body's lines; a
line already listed; the 200 lines; the counts' limits and digits; the
cursor; «Змінити» and «Додати ще модель» clearing; the row and the sheet;
the button's readiness, the MainButton under the sheet, the buzzes and the
question before closing; the result; and the review's fixes. All 41 are
caught. One was not at first, and it was the mutant's fault: the only
warehouse's choosing re-runs only when the only one changes, so choosing
the first of many there never ran; the mutant now treats the first as the
only one.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-03): 872 of 874 pass
  in 17.7 minutes. `backups.spec.ts:78` fails only on this Mac, as on every
  batch before; CI runs it. `sale.spec.ts:122` was refused 409 late in the
  run, the shared seed's stock spent: on a fresh seed its file passes, 8 of
  8.
- `tsc -b`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).
- The 41 mutants above, all caught.

## For the owner

Asked as words of the screen, each built by its «if no»
(business-rules.md, the heading above): «Закупівельна ціна за шт., грн
(необов’язково)» (the TZ marks it for approval), «Прийшло N шт. · склад
«…» · {вид}», «Записати прихід · N шт.», «Додати ще модель», «У поставці»,
«Змінити», «Готово», «ціна з помилкою», «шт.» for «од.», «В одній
поставці — до 200 рядків. Запишіть цю, а решту прийміть окремою
поставкою.». And two changes of what is shown: a count may be typed as
well as stepped; a paused, not-received-into or «Брак» warehouse is no
longer listed with why it takes nothing.

## Not covered

- A real phone and Telegram's own web view: the screen at 360 × 640 is
  proven in Chromium's phone profile in both themes. At 360 the steppers
  end 40 px over the button on the Mac; CI's wider text face may wrap a
  long model name, a line of 22 px.
- The MainButton's turning while a delivery is sent is not checked by a
  journey.
- A kept delivery proven recorded opens the screen afresh, but says nothing
  of it there: the app's notice going is what says it, as before.
