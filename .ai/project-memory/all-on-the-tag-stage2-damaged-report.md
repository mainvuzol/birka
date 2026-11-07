# «Усе на бірці», stage 2's ninth batch: «Брак» — its life cycle and where «Оглянути» leads; the correction's and the price's sheets in the model's detail — 2026-11-07

Baseline: `0fbde82d` (#177, on main), and three points of the stage-2
goods task list ([P0-4, P1-3, P1-4](redesign/2026-11-05-redesign-tz-stage2-goods.md)),
their decisions and acceptance.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-damaged`. Task: the ninth batch, chosen in chat after
#177 (2026-11-07, «Goods: «Брак» + S23 sheets»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-07 (stage 2 batch 9:
«Брак» — …; goods P0-4, P1-3, P1-4)". The owner's questions stand by their
(а): В-Г4 (returning to sale stays two steps, the warehouse named), В-Г8
(no history: what became of a unit is said only by the stub after it is
recorded).

Where these screens still did their own way:
- «Брак» was one long page: three groups under headings, one to three
  buttons under each unit's text, the confirmations unfolding in place, a
  native list for another store's warehouse; a unit decided simply
  vanished, nothing said of what became of it. «Оглянути» on «Сьогодні»
  opened the whole page, nothing saying where to start.
- The model's correction sheet held the old form: the reasons as radio
  buttons, «Додати до обліку / Списати з обліку», a field «… од.» on the
  phone's keyboard, «Записати коригування» and «Скасувати».
- The model's price sheet held the old form: the price's field on the
  phone's keyboard, «Зберегти ціну», «Прибрати ціну магазину» and
  «Скасувати» as three kinds of button over one sum.

## What exists now

- **«Брак», the screen (P0-4):** «Брак», its line and «Оновити»; one
  switch, «Чекають 2 · На перевірці 1 · Підтверджений 3», opening on the
  first segment with something in it — so from «Сьогодні»'s «Оглянути»
  and «Ще»'s line on «Чекають» — the oldest first. The rows on the paper,
  each a row tag: its eyelet dashed while it waits, a ring while someone
  looks at it, filled in «Брак»'s colour with the edge torn once
  confirmed; «Марсель молочний · M», «Оглядає Тетяна з 11:40», «Повернули
  03.11 · продано зі складу «Основний»», the note; one verb — «Взяти на
  перевірку» (recorded at once, felt lightly, the sheet open at once) or
  «Вирішити». An empty segment: the empty tag and its own words; an empty
  «Брак»: «У «Брак» зараз нічого немає.», no switch. A store that does
  not trade: no verbs.
- **The unit's sheet (P0-4):** under inspection «Повернути в продаж» and
  «Брак підтверджений»; confirmed «Списати», «Повернути постачальнику»
  (with `supplier:return` only) and «Перевірити ще раз» (recorded at once,
  the sheet staying). Each decision a second step: «Повернути в продаж на
  склад «Основний», звідки його продали?» and «Так, повернути на
  «Основний»» (В-Г4 (а)); another store's own warehouse — this store's as
  chips, the yes held until one is chosen; a note for confirming and
  writing off; the supplier's field and its note. The yes is Telegram's
  MainButton in the second step only (the sheet's own outside Telegram, a
  tap carried onto it let go). «Назад» closes the sheet.
- **What became of it (P0-4; В-Г8 (а)):** a success buzz, the sheet gone,
  a `recorded` stub over the list naming it — «Повернули в продаж: … →
  «Основний»», «Брак підтверджений: …», «Списали: …», «Повернули
  постачальнику «…»: …», «Ви оглядаєте: …» — the cursor on it; the row's
  place held among the rest while it stands; the last one gone, the
  segment — or «Брак» — says it is empty under it.
- **The correction's sheet (P1-3):** «Лоран шоколад · M», «Склад «…»»; the
  reasons as chips; «Додати · Списати» only where the way is asked and
  both are possible; «В обліку 3 → 1 · −2» over the keypad of pieces
  («Фактично, шт.», «Списати, шт.», «Скільки, шт.»); the note folded;
  «Записати · −2 шт.» — Telegram's MainButton, the sheet's own at its foot
  outside Telegram; no «Скасувати». Four taps and the number.
- **The price's sheet (P1-4):** «Для всіх магазинів · Лише «Основний»» —
  «Для всіх магазинів» always whole —, «Зараз: …», the sum on the keypad
  with its comma, empty as it opens; «Зберегти · 3 600,00 грн» —
  Telegram's MainButton, the sheet's own outside Telegram; «Прибрати ціну
  «Основний»» quiet; no «Скасувати». Two taps and the sum; «Ціну продажу
  збережено: …» as before.
- **On a screen, not a sheet** — «Приймання»'s price, «Залишки»'s price
  and correction, a stocktake's «Знайшли товар…» — the same forms keep
  their own button and «Скасувати», never Telegram's MainButton: those
  screens may hold their own («Записати прихід»).
- **No right, no server rule, no command and no field changed.** Every
  step sends the body it sent.

## Decided here, not by the owner

All in business-rules.md under the heading above: the segment fixed after
a fresh read; oldest first on the phone; the rows on the paper and the
switch's segments as wide as their words; the unit's name whole and «зі
складу «…»» not declined; no switch over an empty «Брак»; the trading hint
gone with its buttons; «Перевірити ще раз» keeping the sheet; «Назад»
closing the whole sheet; the carried tap let go on the yes; «Тут немає
складу, куди повернути в продаж.»; the held place and when it goes; the
answer drawn before the list is read again; the till's stock read again;
the correction's title with the size and its warehouse; no «Додати ·
Списати» where only one way is possible; the note folded; MainButton only
in a sheet; the inline forms' names; the price's keypad empty; a sum of
nought said as it is typed; «1850,» read as 1 850,00; the price's switch
at 15 px with «Для всіх магазинів» whole.

## How it was built and proven

- **Files:**
  - `frontend/src/damaged/Damaged.tsx` (rewritten): the switch, the row
    tags, the unit's sheet and its second steps, the stub and the held
    place, the server's answers drawn at once; the refusal words kept;
  - `frontend/src/damaged/types.ts`: the status `SUPPLIER` the server
    already sends;
  - `frontend/src/inventory/Correction.tsx` (rewritten): chips, the way's
    switch, the keypad of pieces and its line, the folded note, the button
    in a sheet's foot or under the form; `refusalText` kept;
  - `frontend/src/prices/SuggestedPrice.tsx`: the price form on the keypad,
    its button in a sheet's foot or under the form, «Прибрати ціну «…»»;
  - `frontend/src/inventory/Model.tsx`: the two sheets' feet, the
    correction's title with its size;
  - `frontend/src/styles.css`: «Брак»'s screen, tags and sheet; the
    correction's and the price's forms; the price's switch.
  - No backend change.
- **Journeys:** 968 in all (961 after #177).
  - **7 new:**
    - «Перевірити ще раз» records at once and the sheet stays on the
      inspected unit's ways; «Назад» closes it, the cursor on the stub;
    - «Брак» stubbed: opening on the first segment with something, oldest
      first, the counts, 360 px — each segment's words whole, no bullets —,
      «Брак»'s colour in light and dark; a unit taken, its place held
      among the rest; the last one taken, «Нічого не чекає перевірки.»
      under the stub; each empty segment's words; the last unit written
      off, its stub over «У «Брак» зараз нічого немає.», the cursor on
      it, no switch;
    - without `supplier:return` no «Повернути постачальнику»;
    - inside Telegram 8.0: no MainButton while the ways are offered,
      «Назад» back to «Вирішити», another store's unit — the chips, «Оберіть
      склад» inactive, then «Так, повернути на «Склад повернень»», the body
      sent, the stub, a success buzz;
    - the correction in the model's sheet: four taps and the number, the
      chips, the line, «Записати · +1 шт.» in the sheet's foot, light and
      dark at 360 px, «Додати · Списати» where asked, «Назад» leaving,
      nothing recorded;
    - the price in the model's sheet: two taps and the sum, «Зберегти · 3
      600,00 грн» in its foot, light and dark at 360 px, «Для всіх
      магазинів» whole; the store's own with its kopecks after the comma;
      «Прибрати ціну «Основний»» quiet; «Назад» leaving, nothing saved;
    - the price inside Telegram 8.0: the MainButton «Зберегти», inactive,
      then «Зберегти · 3 600,00 грн», pressed, the body, a success buzz,
      gone with the sheet.
  - **Rewritten:** «Брак»'s take and return on the real server (a refused
    take, the sheet at once, the second step, a tap carried onto the yes
    let go, the stub and the cursor, the stock moved), confirm and write
    off with notes, someone else first; the correction's journeys (the
    labels in «шт.», the line, the Telegram 9.1 MainButton «Записати · −1
    шт.», a number refused read with the keypad, the note's cursor); the
    price's (the button's words, a sum of nought held and said, «Прибрати
    ціну «Основний»»); «Сьогодні»'s «Оглянути» landing on «Чекають»; the
    supplier's return from «Брак», another store's unit, a blocked store's
    «Брак» in their new ways; a correction refused for too many requests
    (`person-limit`, found by the full run); `today`'s wait for its reads,
    counted by read, and two more journeys that end on it.

## The independent review

An agent read the change cold (2026-11-07). The request bodies, the
rights, the server's answers against a fresh read, the effects under
StrictMode, double presses and the MainButton's stack held; it found:
- **Fixed:**
  - The price's keypad opened with the price that stands, «3600,00»: full
    to its kopecks, it took no figure, and the usual change of a price
    needed seven ⌫ first. It opens empty, «Зараз» naming the price.
  - «Підтверджений 1» did not fit its third of the switch at 360 px — 129
    px of words in 93 — and spilled past the card. The rows stand on the
    paper, the switch the screen's width, each segment as wide as its
    words at 15 px.
  - The last row gone from a segment left the held place blank and its
    empty words unsaid; the last unit gone from «Брак» took the stub away.
    The place is held only among rows still there; the stub stands over
    an empty segment and over an empty «Брак».
  - A number refused was not read with the keypad; the note unfolded left
    the cursor nowhere; the forms on a screen lost their fieldset's name
    and their «Скасувати» stayed live while saving. All mended.
  - The correction's journey wrote a unit off the count warehouse each run,
    so local reruns ran it down; it records one more instead.
  - Seen in the screenshots meanwhile: «Брак»'s rows carried a list's
    bullets; gone.
- **Found after it, by the journeys written for the mutants that lived:**
  on a screen inside Telegram — «Інвентаризація»'s «Знайшли товар…»,
  «Приймання»'s price — the correction's and the price's forms drew no
  button at all: `useMainButton` says whether Telegram's MainButton is
  there, not whether this form put it up, and the form, told «there»,
  left its own out. A form takes Telegram's only in a sheet now; on a
  screen its own stands, «Записати прихід» staying Telegram's. Both
  journeys now run inside Telegram.
- **Recorded, left as built:** «Сьогодні»'s journey checks one row only;
  the order is «Брак»'s own journey's.

## Mutants

62 mutants (`mutate26.py`, `mutants26.sh`, logs `go-mutants26.log` and
`go-mutants26-part2.log`). Each was applied alone and run against the
journeys meant to catch it, on a fresh seed each time: the real server's
«Брак» journeys take, return and write off the seed's units, and could not
run twice on one seed. 61 were caught; one lives on this Mac's font.
- **«Брак»'s screen (P0-4):** opening always on «Чекають»; the server's
  order kept, not the oldest first; the segments without their counts; an
  empty segment, or an empty «Брак», without its words; the dashed eyelet,
  or the filled and torn one, gone; «Оглядає … з» always with the date;
  «продано зі складу «…»» dropped; a store that does not trade offered the
  verbs; the segment's switch fitting by thirds; the list's bullets back.
- **The unit's sheet (P0-4):** «Взяти на перевірку» not opening the
  sheet; «Перевірити ще раз» closing it; no success buzz; the cursor on
  the title, not on the stub; the sheet not focused after the way chosen;
  back on sale to the chosen place, not to where it was sold from; the yes
  ready before a warehouse or a supplier is chosen; «Повернути
  постачальнику» without `supplier:return`; the note not sent on
  confirming; the MainButton shown in the first step; the carried tap not
  let go; the chips not pressed.
- **What became of it (P0-4):** the server's answer not drawn until the
  list is read again; the stub kept over another segment; the held place
  gone, or held with no row left; the stub gone over an empty «Брак»; the
  stubs without the warehouse or the supplier.
- **The correction (P1-3):** «Записати» without its number, or without its
  sign; the line without «· −2»; «Додати · Списати» where only one way is
  possible; «Додати» first; «Фактично на складі, шт.»; the note unfolded,
  or unfolded with the cursor nowhere; the MainButton never shown, or
  shown on a screen; the button under the form, not in the sheet's foot;
  the warehouse's line gone; the title without the size; a refused number
  not read with the keypad.
- **The price (P1-4):** «Зберегти» without its sum; a sum of nought ready,
  or not said; «1850,» refused; the MainButton never shown, or shown on a
  screen; «Прибрати ціну магазину»; no success buzz; the button under the
  form, not in the sheet's foot, or with no foot at all; «Скасувати» in
  the sheet; the sum sent in kopecks; the keypad opening with the price.
- **The bug the mutants found:** `cmainhere` and `pmainhere` take the
  form's `&& inSheet` away — the button that went missing inside
  Telegram on a screen. Both were caught, by «Інвентаризація»'s «Знайшли
  товар…» and «Приймання»'s price, now run inside Telegram.
- **Six lived on the first run and were caught once their journeys were
  tightened:**
  - the stub kept over another segment, and the held place gone — the
    fresh seed empties «Чекають», so «Брак»'s own stubbed journey now
    checks both;
  - the sheet not focused — the carried tap now focuses before it clicks;
  - the warehouse's line gone — the correction's journey now reads it;
  - the inline correction's MainButton — its journey now runs inside
    Telegram;
  - the price's columns, `pscope` — this one still lives. With the 15 px
    kept, «Для всіх магазинів» fits half the switch in this Mac's font,
    so no journey here can tell it apart. The rule is kept for wider
    fonts, such as CI's DejaVu: equivalent here, not proven there.
- **Not mutated:** colours in CSS; the till's stock read again after a
  decision (`sale-stock`); Telegram's «Назад» on the unit's sheet, which is the shared
  sheet's, as Escape and the scrim are.

## Evidence

- **Every journey on a fresh seed:** 964 of 968 passed in 24.1 min
  (`go-full26.log`), after the mutants' tightening:
  - `backups.spec.ts:93` fails on the Mac alone, as in the last two full
    runs, and passes on CI: the seed is additive, so this database holds
    more nights than CI's fresh one.
  - `person-limit.spec.ts:210` (a correction refused for too many
    requests) still drove the old form: the radio «Втрачено», «Скільки
    списати, шт.», «Записати коригування». It now takes the reason's chip,
    «Списати, шт.» and «Записати · −1 шт.», and asserts what it asserted.
    On a fresh seed `person-limit` passed whole, twice (`go-b9-fix1.log`,
    `go-b9-fix2.log`).
  - `today.spec.ts:1435` and `:1463` failed only at teardown: «Tearing
    down "context"»; the trace shows two `stock-locations` handlers still
    fulfilling after the journey's last check. They open
    «Продаж» with a fake clock running on, and the till takes only
    `asInput` from `SuggestedPrice.tsx`, which is unchanged. This is the
    hold #176 and #177 met: a route still fetching as the page lets go of
    its routes. They now end as those journeys do, once every read asked is
    answered.
  - Doing that showed `today.spec.ts:1037` (from #177) failing every time,
    alone, on a fresh seed, and on main with this change stashed: «20
    answered of 19 asked», a count that never meets. The wait now counts
    by read — each read asked answered as often as it was asked — and
    names whichever is left.
  - After both: `person-limit`, `backups` and the whole of `today` 45 of
    46, `backups:93` the Mac's (`go-b9-today4.log`). The four journeys that
    wait on their reads passed 12 of 12 (`--repeat-each=3`,
    `go-b9-today5.log`).
- **The batch's own specs** (`damaged`, `correct`, `price`): 26 of 26 on
  that seed after the fix (`go-b9-shots.log`). Before it: 40 of 40 for
  `correct`, `receive`, `price` and `stocktake` after the `inSheet` fix,
  and 18 of 18 for `damaged` with `correct`.
- **The checks:**
  - clean: `tsc --noEmit -p .`; `eslint src e2e`; Prettier on whole files
    (my own hunks in `styles.css` and `today.spec.ts`);
  - `tsc -p tsconfig.eslint.json` reports four errors in `stores.spec.ts`
    and `suppliers.spec.ts` (`expect.any(String) as string`). They are on
    main as they are and not in this change's lines.
  - No backend change.
- **Screenshots** (Chromium, 360 px; `test-results/`):
  - «Брак» on «Чекають» with the switch whole and no bullets
    (`damaged-360-light.png`);
  - the correction's sheet in light and dark
    (`correction-sheet-light.png`, `correction-sheet-dark.png`);
  - the price's sheet in light and dark (`price-sheet-light.png`,
    `price-sheet-dark.png`).
- **CI:** GitHub's, on the pull request.

## For the owner

Nothing new to ask. Returning to sale stays two steps, with the warehouse
named on the yes (В-Г4 (а)). «Брак» keeps no history: what became of a
unit is said only by the stub after it is recorded (В-Г8 (а)). What was
decided here is in business-rules.md under the heading above. The words of
refusals, the reasons, the limits and every request's body are unchanged.

## Not covered

- **A real phone:** Telegram's MainButton, «Назад», the buzzes and a
  reader's speech are checked by their stubs and the accessibility tree in
  Chromium, not on a phone or with VoiceOver / TalkBack.
- **CI's font:** the switch on «Брак» and the price's segments are measured
  at 360 px on this Mac's font; CI's DejaVu runs the same checks on the
  pull request.
- **History of «Брак»:** none, by В-Г8 (а); once the stub goes, nothing
  says what became of a unit.
- **Seen in passing, not touched:** «Позичене й під реалізацію»
  (`src/suppliers/Borrowed.tsx`) and «Накладні»
  (`src/suppliers/Invoices.tsx`) put plain `<li>` rows in `<ul
  className="order-tags">`, and nothing gives that list `list-style:
  none` — «Брак»'s rows carried bullets the same way. Worth a look at 360
  px; outside this batch.
- **The rest of the goods task list:** P0-1, P0-5, P0-6, P1-1, P1-2, P2-4
  and P2-5 wait for the next pick.
