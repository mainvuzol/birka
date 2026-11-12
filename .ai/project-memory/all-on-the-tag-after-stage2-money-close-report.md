# «Усе на бірці», after stage 2's audit, batch 13: the suppliers' screens hold grey places while read; one «Спробувати ще раз» after a failed page; the report's blank tags; «Продано»'s stub with its sum large; «Менше» felt, hairline dividers — the money task list closed — 2026-11-12

Baseline: `e995a6c0` (the audit's twelfth batch, PR #195, merged). This
batch covers the rest of the money task list after stage 2, as its §8
orders it («Поставщики и отчёт»):
- [P1-3](redesign/2026-11-09-redesign-tz-after-stage2-money.md): grey
  places of the real rows' shapes instead of «Завантажуємо …»;
- [P2-1](redesign/2026-11-09-redesign-tz-after-stage2-money.md): one
  «Спробувати ще раз» after a failed page;
- [P2-2](redesign/2026-11-09-redesign-tz-after-stage2-money.md): the
  report's «Моделі» and «Продажі й повернення» with nothing — the blank
  tag;
- [P2-3](redesign/2026-11-09-redesign-tz-after-stage2-money.md):
  «Продано»'s stub with the sum large;
- [P2-4](redesign/2026-11-09-redesign-tz-after-stage2-money.md): «Менше»
  felt, one line where a store does not trade, hairline dividers, the
  meta at 14.

Nothing is left of the money task list after stage 2.

Status: built. 1072 of 1073 journeys passed on a fresh seed; the one that
failed did so for the stand's database, as in batches 7–12. 38 of 38
mutants were caught. CI is GitHub's, on the pull request.
Not yet seen on a real phone.
- Branch: `feat/after-stage2-money-close`.
- Task: the audit's thirteenth batch, chosen in chat after #195 was merged
  (2026-11-12, «merged go next»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-12 (audit after
  stage 2, batch 13: …)".

Where it stood:
- While a supplier's screen was read, it was empty with one line of text
  at its top: «Завантажуємо накладні…», «…накладну…», «…повернення…»,
  «…позичене…», «…постачальників…», «…склади…». «Позичене» in a loaded
  base reads for about 6.6 s: all that time one line, then everything
  jumped.
- After a failed page, «Накладні», «Постачальникам» and «Позичене» showed
  both «Спробувати ще раз» and «Показати ще», both reading the same page.
- The report's «Моделі» and «Продажі й повернення» with nothing said a bare
  line under the switch; every other screen of the section draws the blank
  tag.
- «Продано» said its money in a heading-sentence: «Продано 1 шт.: у
  «Накладних» борг «Ганна» 1 500,00 грн.», the stub under it only the
  model and «× 1».
- «Менше» on the two steppers was not felt; «Більше» was. The tables'
  rows were parted by the controls' `edge`.

## What exists now

- **Grey places** (P1-3; spec §5 «Скелетон», §6.27):
  - «Накладні», «Позичене й під реалізацію»: three grey row tags; the
    first tag comes where the first grey stood (±2 px, checked).
  - «Постачальникам»: three grey rows; the first row comes there too.
  - The supplier's sheet and «Список постачальників»: three grey supplier
    rows. The list's search stands from the start; nothing moves when the
    rows come (checked: the field to the pixel, the first row ±2).
  - «Зарахувати повернення»: three grey cards of a return.
  - «Повернути постачальнику»: two grey warehouse choices.
  - An invoice opened from a return's «Відкрити накладну»: the title's
    place, «Записано …», what is owed large over its bar, what is paid,
    two rows of history on the thread — as an order's card waits.
  - The words are said to a screen reader alone.
- **One retry** (P2-1): after a failed page, «Спробувати ще раз» alone;
  «Показати ще» comes back once the page is read.
- **The report's blank tag** (P2-2): 64, its one line, nothing under it.
- **«Продано»'s stub** (P2-3): «Продано 1 шт.»; the stub: «1 500,00 грн»
  large (the server's), «Ганна · Кокон графіт, M × 1», a perforation,
  «Борг «Ганна» — у «Накладних».», «Відкрити накладну ›». A 40-letter name
  with no space wraps inside it at 360 px; «123 456,78 грн» stays whole.
  The words wait for the owner's approval.
- **Small things** (P2-4): «Менше» a light tap on both steppers; the
  tables' rows parted by `hairline`; one line where a store does not trade
  (unreachable today, below); the three «13 px» lines were already 14
  since #185, and what was still smaller is 14 now (review, below).

## The independent review

A reviewer who had not built it read the diff, the task and the frozen
code. It found no bug and no break of money: the stub's sum is the
server's, the one retry works as TanStack reports a page's failure, the
read-only line is unreachable as said, and `.hint` is 14 on these screens.
- **Fixed — the invoice opened from another screen moved 14 px when it
  came** (medium). The card's ⋯ is 44 high in the title's row, the grey
  title 30: the line under it and everything below moved down. Its place
  is held now, unseen; the journey checks the line under the title stays
  (±1 px).
- **Fixed — text under 14 left on the section's screens** (low): a cell's
  meta in the report's table (13), a day's year in its thread (12),
  «вільно N» on «Повернути постачальнику» (13). The sweep that checks it
  had skipped what is hidden from a reader, so it missed «вільно N»; it
  now skips only what is not seen. All three are 14 and swept.
- **Fixed — «Продано» heard less** (low): the focused title now says its
  sum and where the debt is, by description.
- **Fixed — three cards in «Зарахувати повернення»**, as the task says,
  not two (low).
- **Fixed — the dark theme** (low): «Накладні» read slowly runs in both
  themes; «Надійшло»'s dividers are checked as the report's, in both.
- **Fixed — one helper:** the held read and the 14 sweep are
  `fixtures.ts`'s, not three copies.
- **Fixed after it, by the journeys:** with a name with no space, «Борг
  «…» — у «Накладних».» ran past the stub and widened the page by 2 px at
  360. It wraps; every line of the stub is checked.
- **Said, not changed:**
  - «Повернути постачальнику»'s warehouses are held as two grey chips, as
    the task says; a store with one is then shown one line, about 30 px
    lower. Which comes is not known before it is read.
  - No `h1` while the invoice is found: as an order's card waits; the
    screen reader hears «Завантажуємо накладну…». The journey no longer
    insists on it.
  - The report's blank tags are checked in the light theme; the shared
    `Empty` is the same in both.

## How it was built and proven

**Code:**
- `frontend/src/shared/Placeholder.tsx`: `rowShape`, rows in their own
  list's shape.
- `frontend/src/suppliers/Invoices.tsx`: the list's tags, the opened
  invoice's `InvoicePlaceholder`, one retry, the one read-only line.
- `frontend/src/suppliers/Suppliers.tsx`, `Borrowed.tsx`,
  `InvoiceActions.tsx`, `Picker.tsx`, `SupplierList.tsx`, `NewReturn.tsx`:
  their places; one retry; «Продано»'s stub; «Менше» felt.
- `frontend/src/reports/ReportModels.tsx`, `ReportEntries.tsx`: `Empty`.
- `frontend/src/styles.css`: the places' rows and eyelets; the stub's name
  wrapping; `.money-table` dividers; the report's meta and year and
  «вільно N» at 14; `.report-empty` gone.
- No backend change.

**Journeys:** 1073 in all; 1065 before.
- New:
  - `suppliers-pages`: «Накладні» (both themes), «Постачальникам»,
    «Позичене» read slowly — the places, the words to a reader alone, the
    first row on the first grey's place, at 360 px;
  - `suppliers`: the supplier's sheet, «Список постачальників» and
    «Повернути постачальнику»'s warehouses read slowly; «Менше» felt
    inside Telegram;
  - `supplier-invoices`: «Зарахувати повернення» and an invoice opened
    from its return read slowly; nothing under 14 on the card, its ⋯ and
    the return; the line under the title stays as the card comes;
  - `borrowed`: «Менше» felt inside Telegram.
- `fixtures`: `holdReads` and `under14`, shared.
- Changed:
  - `suppliers-pages`: after a failed page, one retry and no «Показати
    ще»;
  - `borrowed`: «Продано»'s stub in the main journey and the four taps,
    heard with its sum; both themes at 360 with a 40-letter name with no
    space and «123 456,78 грн», every line of the stub inside it;
  - `sales-report`: the blank tags; the table's rows parted by `hairline`
    in both themes; nothing under 14 in the table and the thread;
  - `suppliers`: nothing under 14 on «Повернути постачальнику»;
  - `money`: «Надійшло»'s rows parted by `hairline` in both themes.

## Mutants

`~/.cache/birka-runtime/helpers/mutate43.py` has 38 mutants. Each one
undoes one thing this batch made. `mutants43.sh` ran each against the
journeys that should catch it, with no fresh seed: these journeys make
their own suppliers and models, or stub what they read.
- **P1-3:** each place back to its «Завантажуємо …» line (8); two tags
  for three; a day's heading over the returns' rows; the rows' own shape
  dropped (set-off, list); the set-off cards' lines shrunk; two cards for
  three; the list's search drawn only once read; the opened invoice's
  words shown, its title «Накладні», its ⋯'s place gone, its eyelets
  square.
- **P2-1:** «Показати ще» back after a failed page, on each of the three.
- **P2-2:** the bare line back, on each screen.
- **P2-3:** the old title; the lot's price for the invoice's sum; no
  supplier, no perforation, no «Борг …»; no description; the name's
  wrapping in «Борг …» gone.
- **P2-4:** «Менше» not felt (each stepper), or felt when held; a
  control's edge for the hairline; a cell's meta 13, a year 12, «вільно
  N» 13.
- **38 caught.** The first pass had 32 and caught them all; one,
  the list's search drawn only once read, was caught only because the
  held read let go after ten seconds — the journey now checks the field
  and the places at once. The review's six came after; all caught.
- Logs: `go-mutants43.log`, `go-mutants43-second.log`.

## Evidence

- **Type check, ESLint, Prettier, build:** `tsc --noEmit`, ESLint and
  Prettier on `src` and every touched journey are clean. `npm run build`
  built. The e2e type check's 44 errors are main's own (44 before and
  after).
- **The touched journeys,** inside the whole run: `suppliers-pages`,
  `suppliers`, `supplier-invoices`, `borrowed`, `sales-report` and `money`
  whole, 77 of 77.
- **Every journey:** 1072 of 1073 on a fresh seed, one worker, in 32.9
  minutes (`b13-full.log`), after the review's fixes. The one is
  `backups.spec.ts:93`: 14 nights listed where it reads 3, because the
  stand's database keeps every seed's nights (the seed is additive), as in
  batches 7–12. Nothing of this batch touches «Резервні копії».
- **Once, in a parallel run of the touched journeys,** «a payment or an
  invoice recorded by mistake is cancelled, saying why» missed its words
  and passed when run again; in the whole run, one worker, it passed.
- **Mutants:** 38 of 38 caught (above).

## Not covered

- A real phone.
- The read-only line in «Накладні»: no one can see it today (above).

## For the owner

- **Done:** while a supplier's screen is read, grey tags and rows stand
  where the real ones will come; nothing jumps when they do. After a page
  that failed, one button. The report says «nothing» with the blank tag,
  as the other screens. «Менше» is felt.
- **Please approve:** «Продано»'s stub — «Продано 1 шт.», the sum large,
  «Ганна · Кокон графіт, M × 1», «Борг «Ганна» — у «Накладних».».
- **Still open:** «Закриття · Центр» on «Гроші» (batch 12); the
  «Початкові залишки» line that takes four lines at 360 px (batch 10).
