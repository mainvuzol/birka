# «Усе на бірці», audit 2026-11-15, batch 6: the answer before the press — «Інші дні» says days the server would refuse before «Показати»; «Нова накладна» says more paid at once than its sum as it is typed; the set-off's returns as radios; «Зберегти» and «Додати постачальника» with the ring; the «nothing yet» lines in pencil — 2026-11-17

Baseline: `1d10fdbc` (main after #219). The money task list's last open
points but P1-3 (б), which waits for В15-Г1:
- money P2-3, P2-6
  (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-money.md`).

Picked by «merged, go next».

Nothing recorded, sent or counted changes, and the server checks everything
as before: the phone only says earlier what the server would answer. No
word on a screen changes.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1179 (1175 before).
- Branch: `feat/audit-1115-money-tail`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-17 (audit 2026-11-15, batch 6: the answer before the press …)".

## What exists now

- **«Інші дні»** (money P2-3 (а)):
  - Days the server would refuse are said under the two days as they are
    chosen, in the server's words, and «Показати» holds. That is the last
    before the first, or `(last − first).days ≥ 366`. Nothing is asked,
    and the table behind the sheet stands.
  - 366 days may be shown, 367 may not.
  - Both days are said wrong and described by the line.
  - The dates' pickers keep the first day not after the last; a year is
    said by the line, never bounded. A day the server cannot read (a year
    of five figures or more) is said the same.
  - The server's refusal, should it come, is said as before.
- **«Нова накладна»** (money P2-3 (б)):
  - «Сплачено одразу» more than the sum is said under its field as it is
    typed. The field is wrong and described by the line, and «Записати
    накладну» holds.
  - «1500,» in either field is read as 1500, on sending too, as the
    payment's.
- **A field said wrong:** its edge in the error's colour, wherever a field
  is said wrong. That includes the set-off's sum and «Прийшов товар»'s
  price, which said so before without the edge.
- **The set-off's returns** (money P2-6 (а)):
  - They are a radio group, «Повернення», drawn as before.
  - The arrows choose as they go, round the ends, and Tab stops once (new
    helper `frontend/src/shared/radioKeys.ts`).
- **«Зберегти» and «Додати постачальника»** (money P2-6 (б)):
  - Pressed, the eyelet's ring is on the button and «Ще надсилаємо…»
    stands over it after 3 s, as a sheet that asks why.
  - The button stays where it stood, never faded, and is never pressed
    twice.
  - In place («Як надійшов», «Брак»), «Додати постачальника» takes its
    row's width, «Скасувати» under it.
  - In every sheet's foot, «Ще надсилаємо…» now stands 8 over the first
    button, not over the sheet's top.
- **Nothing yet** (money P2-6 (в)): «Оплат і заліків ще не було.» and «Цей
  магазин нічого не повертав постачальнику «…».» are `meta` 14 in pencil.

## How it was built and proven

Sources:
- `reports/SalesReport.tsx`;
- `suppliers/Invoices.tsx`, `InvoiceActions.tsx`, `SupplierList.tsx`,
  `Picker.tsx`;
- `shared/radioKeys.ts` (new);
- `styles.css`: `.field-wrong` with `.pay-over`, a wrong field's edge,
  `.set-off-return[aria-checked]`, `.nothing-yet`, the line's place in a
  sheet's foot, the in-place «Додати постачальника».

New and changed journeys:
- `sales-report.spec.ts`, the periods' journey:
  - the pickers' bounds, by the order alone;
  - a six-figure year in either field: no crash, said once both are
    chosen;
  - the last day before the first said in the sheet, both fields wrong and
    described, «Показати» held, nothing asked, the table standing;
  - 366 days shown, 367 held;
  - the server's refusal (stubbed) said in its words, as before.
- `supplier-invoices.spec.ts`:
  - the set-off journeys find the returns as radios;
  - a new journey in both themes at 360:
    - an invoice with no history and a set-off with no return, each `meta`
      14 in pencil at 4.5:1;
    - two returns as radios: Tab's stop, the arrows four ways and round the
      ends, the chosen in the chosen colours, a tap too;
    - «Нова накладна»: 1200 paid of 1000 said under the field as typed, the
      field wrong, described and red-edged, the button held, nothing sent;
    - 1000 free, «1000,» and «1500,» read as typed;
    - «1500,» and «1000,» recorded as 1500.00 and 1000.00.
- `borrowed.spec.ts`, a new journey: «Додати постачальника» in place in
  «Як надійшов», its write held: the ring, the line right over it, nothing
  moving, one write.
- `suppliers.spec.ts`, a new journey: each supplier's write held until let
  go. «Додати постачальника» in the field's sheet, then «Зберегти» in
  «Змінити постачальника», are each checked for:
  - the ring, never faded;
  - «Ще надсилаємо…» only past 3 s, over the button, which does not move;
  - one write;
  - answered, as before.

Touched specs on a fresh seed: 54/54 on the first run; after the review's fixes, with the specs whose sheets or in-place field the fixes reach (`borrowed`, `receive`, `damaged`, `stores`, `credits-debt`), 159/159 on a fresh seed.

## The review

An independent review (the period rule against the server's, the invoice's
money, the radio group, the sending line's places, the wrong field's edge,
the tests) found nothing High. `tsc` and `eslint` are clean.

Checked and found right:
- **The period rule.** `dayCount(to) − dayCount(from) ≥ 366` is the
  server's `(last − first).days ≥ MAX_DAYS`. Midnight in UTC drifts with no
  zone or clock change, and the server's refusal is said as before.
- **The invoice's money.**
  - `paidOver` is the server's own check, on exactly the kopecks sent.
  - «1500,» is sent as 1500.00, as shown.
  - The second check in `submit` is sound.
- **The radio group.**
  - One Tab stop: the chosen, or the first once the chosen is gone.
  - The arrows wrap, pass over a radio taking no tap, and don't scroll the
    sheet.
  - A tap works as before.
- **The global wrong-field edge.** It reaches only the set-off's sum,
  «Прийшов товар»'s price, the keypad (already red) and the new fields.
  `--danger` is over 3:1 on the card and the fold in both themes.

Medium, fixed:
- **A six-figure year crashed «Інші дні».** A desktop's date field takes a
  year up to 275760. Bounding the other day by a year ran a date past
  JavaScript's range, and the sheet fell to «Щось пішло не так». Now:
  - the year bound is gone (next point), so no date is computed for the
    pickers;
  - a day the server cannot read is said, as a refused period, once both
    days are chosen;
  - the journey types such a year in each field.
- **The year bound made periods long past hard to reach.** The sheet opens
  on today, and «Від» could go back only 365 days. The pickers now keep only
  the order, as the task list asks; a year is said by the line.
- **The in-place «Додати постачальника»** («Як надійшов», «Брак»):
  - «Ще надсилаємо…» stood over the host sheet's top, about 330 px away;
  - the ring widened the button, and «Скасувати» wrapped.

  Now the button and its line stand in their own room: the button takes
  its row's width and «Скасувати» is under it. A new journey in
  `borrowed.spec.ts` checks:
  - the ring, never faded;
  - the line right over the button (≤ 12 px);
  - the button's and «Скасувати»'s places and sizes, kept;
  - one write.

Low, fixed:
- **The line in every sheet's foot.** «Ще надсилаємо…» stood over the
  sheet's top edge in every sheet whose foot has it: a sheet that asks
  why, the set-off, a debt's write-off, a store's sheet, a borrowed lot's
  sheet. `.sheet-foot` is now its place, the line 8 over the foot's first
  button, as over the till's dock. The supplier journey checks ≤ 12 px.
- **The writes counted only after answers.** A stray second write could
  have come after the check. They are now counted once each answer has
  come; the report's «nothing asked» is checked again later.
- **A comment named a leap day** where the year tested has none. Reworded.
- **An arrow with a modifier** (Alt, Ctrl, Meta, Shift) is left to the
  browser or the reader.

Low, left with a reason:
- **The wrong-days line on a desktop.** It is said again as each digit of
  a typed year changes the day. A phone picks days from its own picker,
  and the set-off's line does the same while a sum is typed.
- **«1500, » with a trailing space** is not read as 1500, as on the
  payment and the set-off. A decimal keypad has no space.
- **The sheets' new line place is not measured** in their own journeys,
  but for the suppliers' (one rule for every foot).

## Mutants

`~/.cache/birka-runtime/helpers/mutate66.py`, run with `mutants66.sh` on
the seed above. Each mutant is applied, its journey is run once (`pw-slow`,
no retries), and the source is restored.

34 of 34 caught: 30 on the first run, all caught. After the review's fixes,
the 18 whose code or journey changed ran again, with 4 new ones; the 16 others
(the invoice journey and its code, unchanged) stand.

- P2-3 (а): `periodline`, `periodhold`, `periodyear`, `periodorder`,
  `frommax`, `frominvalid`, `todescribed`; after the review, `isday` (a day
  the server cannot read). `tomax` went with the year bound.
- P2-3 (б): `paidline`, `paidhold`, `paidcomma`, `sumcomma`, `paidinvalid`,
  `fieldedge`, `fieldwrong`.
- P2-6 (а): `radiogroup`, `radiorole`, `arrows`, `roving`, `wrapround`,
  `chosencolour`.
- P2-6 (б): `savering`, `saveline`, `savepressed`, `addring`, `addline`,
  `addpressed`; after the review, `footrelative`, `footline` (the line in a
  sheet's foot), `addroom`, `addwidth` (in place).
- P2-6 (в): `historynone`, `setoffnone`, `nothingyet`.

Not a mutant: the modifier keys' guard in `radioKeys.ts`, untested.

## Not covered

- The look on a real phone, and the system date pickers' bounds on iOS.
- The full suite is left to CI.
