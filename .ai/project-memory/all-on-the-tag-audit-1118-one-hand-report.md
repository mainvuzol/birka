# «Усе на бірці», audit 2026-11-18, batch 3: one hand — a text button one look, underlined in the link's colour, a sign's never; the reference's links; a field said wrong a line under it, never a refusal's plate; «+ ще N» under a list one look; the in-place picker's chevron the fold's — 2026-11-18

Baseline: `0e0907d9` (main after #226).

Points, all P2: frame P2-1 (with (б)), P2-2 and P2-4. They close the frame
task list of the audit 2026-11-18. Picked by «merged, go next».

Nothing recorded, sent or counted changes. No request, check, journal,
right or word changes. What each button does and where it stands are as
before; only its look, two class names and one icon change.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1198 (1196 before).
- Branch: `feat/audit-1118-one-hand`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-18 (audit
  2026-11-18, batch 3: …)".

## What exists now

- **A text button is one look** (frame P2-1): the link's colour, underlined
  1 px at 3 in its own colour, 15/600 on nothing, in both themes.
  - One rule for `.text-button`, `.sheet-cancel`, «Змінити магазин» on the
    store's line, «Інші дні», `.more-goods` and a phone's `a`.
  - In the dark theme «Змінити магазин», «Інші дні» and the sheets'
    «Скасувати» are now the link's colour, where they were the ink.
  - «+ ще N» in a line of goods keeps the line's face.
  - Decided here: a customer's phone takes the same line, 1 at 3.
  - One with a sign («+ …», «←», «×», «ⓘ Спершу запишіть видане з каси ›»)
    is never underlined.
  - Taking no tap: words and line in pencil, as before.
- **The reference's links** (frame P2-1 (б)):
  - «Оформити повернення» under the till's receipt and «Шукати там» on
    «Повернення» are `text-button`s, no edge.
  - Decided here: «Клієнт забрав»'s «Оформити повернення» too — the same
    sentence as the till's.
  - «Сервер знову відповідає»: «Вношу продаж з паперу» a link and
    «Пізніше» a text button in pencil, side by side at their words' width,
    at 360 too.
  - Decided here: «Пізніше» underlined too, in pencil.
- **A field said wrong is a line under it** (frame P2-2):
  - `.field-wrong` and `.pay-over` win over `[role="alert"]`'s plate: no
    fill, padding or corner; the crossed circle 16 by the first line;
    14/600/19 in the error's colour.
  - Given the class now: «Вкажіть суму з точністю до копійок.» in cash out
    or in, the purchase price in «Як надійшов», a price of nothing, a
    stocktake's count, a correction's number.
  - Role, id, `aria-describedby`, `aria-invalid` and the red edge as before.
  - The plate stays the server's answers and the presses not let go.
  - At 360×640 S21 keeps its three ways in view under the line.
- **«+ ще N» under a list one look** (frame P2-4 (а)): `.list-more` (was
  `.today-more`), the list's width, 44 high, its edge, 15/600 in ink, on
  nothing.
  - Places: «Сьогодні», a stocktake's «Попередні» and «Розбіжності»,
    «Початкові залишки»' «Показати ще», a customer's history and, decided
    here, «Продажі й повернення»'s «Показати ще» and, by the review,
    «Розбіжності»' next page «Показати ще».
  - Decided here: 8 over the list; a customer's history and the report's
    entries had 4.
  - `.history-more` is gone.
- **The in-place supplier picker's chevron** (frame P2-4 (б)): in «Як
  надійшов» and «Брак», the set's chevron 16 in pencil, turned a quarter
  while open, as a fold's. In a sheet, the way's chevron 20, as before.

## How it was built and proven

Sources:
- `styles.css`:
  - the shared underline rule; `a` and `.cash-first` take `--link`;
    `.more-goods` and `.report-days` take `--link` and lose their own
    underline;
  - `.text-button.later` in pencil; `.banner-body .actions .text-button`
    at its words' width;
  - `.pay-over` / `.field-wrong` and their `[role="alert"]` line;
  - `.today-more` renamed `.list-more`; `.history-more` removed;
  - `.pick-value[aria-expanded="true"] .fold-chevron` turned 90°;
- `sales/Sale.tsx`: the banner's two and the return offer as
  `text-button`s;
- `returns/Returns.tsx`, `orders/Collected.tsx`: `text-button`;
- `cash/Move.tsx`, `prices/SuggestedPrice.tsx`, `inventory/Correction.tsx`,
  `inventory/Stocktake.tsx`, `inventory/Receive.tsx`: `field-wrong`;
- `today/Today.tsx`, `inventory/Stocktake.tsx`, `openings/Openings.tsx`,
  `credits/Customer.tsx`, `reports/ReportEntries.tsx`: `list-more`;
- `suppliers/Picker.tsx`: the fold's chevron in place.

Journeys:
- `fixtures.ts`:
  - `expectTextLink(button, {size, pencil})`: colour in both themes, the
    line 1 at 3 in its own colour, no edge seen, no fill, 15/600;
  - `expectSheetCancel` calls it;
  - `expectSignedLink`: no underline;
  - `expectFieldLine`: role, no fill, padding, no corner, 14/600/19,
    danger, the circle 16 at 1.5;
  - `expectListMore(button, list)`: the list's x and width ±1, ≥44, the
    edge, ink, no fill, 15/600;
  - `supplierList` checks the chevron: in place 16, pencil, turned 0 then
    90; in a sheet 20.
- `design-system`: a probe of every text button, sign, field line, the
  plate and «+ ще N», once per theme, with contrast ≥ 4.5 and a
  screenshot (2 new journeys).
- Text links: `stores`, `till-redesign`, `returns-list`, `till-receipt`,
  `orders-card`, `sales-report`, `credits-debt` (goods), `till-sections`
  (the banner, side by side, a screenshot).
- Signs: `cash-close`, `suppliers`.
- Field lines: `credits-debt` (S21 at 360×640, the three ways in view, a
  screenshot), `supplier-invoices` (three), `sales-report`, `receive`,
  `stocktake`, `correct`, `price`.
- «+ ще N»: `today`, `stocktake` (two), `credits-list`, `sales-report`.

Runs on a fresh seed:
- Touched specs (25): 558 passed, 1 failed — my own check: a finished
  stocktake's «Розбіжності» list shrinks in its column, 5.9 px narrower
  than «+ ще N». The check now compares with the list's block.
- Rerun: 2/2.
- After the review's fixes, `design-system`, `stocktake`, `till-sections`,
  `borrowed`, `suppliers`, `supplier-invoices`: 131/131.

## The review

An independent review read the diff against the three points. It found
nothing High. `tsc` and ESLint are clean on the changed files.

Checked and found right:
- every place the three points name is covered; the signed buttons
  (`.head-add`, «←», «×», `.link-chevron`) are untouched;
- the cascade:
  - no `text-decoration` shorthand resets the line's thickness or offset;
  - `.banner-body .actions .text-button` beats the ≤ 480 `.actions button`;
  - `.field-wrong[role="alert"]` and its `::before` beat the plate's;
  - no other `[role="alert"]` rule meets a field line;
- no `today-more` or `history-more` is left in src or e2e;
- roles, ids, `aria-describedby`, `aria-invalid`, `aria-expanded` as before;
- contrast: pencil on the banner's ground 6.4 light, 6.0 dark; danger on
  card 6.6 / 7.7, on paper 5.6 / 8.5;
- the new checks fail if the look regresses; the theme toggle is restored.

Medium, fixed:
- **M1, a finished stocktake's «Розбіжності» two looks.** Its next page's
  «Показати ще» stood a quiet button of its words' width right under the
  new full-width «+ ще N». It is `.list-more` now, decided here; the
  journey of that next page checks it, and the mutant `diffpagequiet`
  proves it. The `.list-more` comment names only the places covered.

Low:
- **L2, fixed: a race in `till-sections`.** The banner's two were measured
  by two calls while the till's mode above can still settle. Now in one
  frame.
- **L5, fixed: comments.** `.text-button`'s names its new users; the shared
  rule says «+ ще N» is underlined though it starts with «+».
- **L6, fixed: the in-place chevron in the dark theme.** The design
  system's probe checks it in both (mutant `pickturnds`). The supplier
  check now uses the shared `chevronTurn`; my own copy is gone.
- **L1, found, not changed:** «Вкажіть додатну довжину…» in «Нова модель»
  and «Моделі» is still a plate. P2-2 did not name it.
- **M1's rest, found, not changed:** thirteen other «Показати ще» under a
  list are quiet buttons. P2-4 named none.
- **L3, owner reading:** «Пізніше» in pencil reads as held while «Вношу
  продаж з паперу» is held. It is the spec's pencil.
- **L4, kept:** `chevron-up` has no user now; it stays in the set of P0-1.
- **L6, recorded:** `.list-more`'s 8 over the list where `.history-more` had
  4; the banner's `type="button"`.

## Mutants

`~/.cache/birka-runtime/helpers/mutate72.py`, run with `mutants72.sh`. Each
mutant is applied, its journey is run once with no retries, and the source
is restored.

33 of 33 caught, each at its own check:
- frame P2-1: `underline`, `thickness`, `offset`, `heldline`, `phone`,
  `daysline`, `daysink`, `goodsline`, `signadd`, `signfirst`;
- frame P2-1 (б): `offerquiet`, `therequiet`, `collectedquiet`,
  `bannerpaper`, `laterpencil`, `bannerwidth`;
- frame P2-2: `fieldfill`, `fieldpad`, `fieldmark`, `invoiceline`,
  `receiveclass`, `priceclass`, `countclass`, `correctclass`;
- frame P2-4: `listwidth`, `diffquiet`, `historyquiet`, `todayold`,
  `entriesquiet`, `pickup`, `pickturn`, and after the review
  `diffpagequiet` and `pickturnds` (the chevron on the probe, both
  themes).

Three (`listwidth`, `diffquiet`, `todayold`) first found no journey: the
`+` of «+ ще N» in their grep was read as a regex. Escaped, and rerun on a
fresh seed: caught.

After the review's measuring fix, the banner's three (`bannerpaper`,
`laterpencil`, `bannerwidth`) were run again. On a fresh seed alone,
Ліда's till has no stock: its warehouse waits for openings that other
specs approve. So the five other specs ran first, unmutated (102/102), then
the banner's journey unmutated (1/1), then each mutant: caught at
`till-sections.spec.ts:1212`, `:1213` and `:1222`.

## Not covered

- The look on a real phone, in Telegram.
- The full suite is left to CI.
- «Вкажіть суму з точністю до копійок.» in «Видати з каси» / «Внести в
  касу» is reached by no journey; its rule is the probe's.
- What is left of the audit 2026-11-18:
  - sale P2-1, and P2-4 (waits for «Прибрати» to be read);
  - orders-cash P2-3, P2-4;
  - money P2-1..P2-4;
  - goods P2-1..P2-6.

  В18-К1 and the set-off limit wait for the user's pick too.
