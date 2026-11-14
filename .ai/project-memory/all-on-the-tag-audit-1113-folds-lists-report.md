# «Усе на бірці», audit 2026-11-13, batch 10: a switch says which it is, a supplier chosen a radio; one fold, one «+ ще N»; the search on a white block, a row taking no tap unfaded; the suppliers', the report's and the invoices' lists on blocks; waits shaped as what comes (frame P2-2, P2-3, P2-4, money P2-4, P2-1) — 2026-11-14

Baseline: `fc48a079` (the audit's ninth batch, PR #210, merged). This
batch is the audit's next in its own order («merged, go next»):
- the frame list's package 2 (its §8 batch 2): P2-2, P2-3, P2-4 — the
  shared components that differ between sections;
- the money list's package 2 that stands on them: P2-4, the section's
  lists on blocks, and P2-1, its waits shaped as what comes.

No request body, right or rule of what is recorded changes. One line's
words change: «Ще N» → «+ ще N».

Status: built and proven, not committed, not yet seen on a real phone.
- The touched specs, on a fresh seed: 407 of 410. The three failures
  were the journeys' own setup, fixed: 4 of 4 after.
- After the review's fixes, on a fresh seed, the 11 specs they touch:
  139 of 141. Both failures were «Каса»'s correction rows, which have no
  chevron (see Not covered); with that said in their journey, 2 of 2.
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 54 of 54 caught, once the review's first fix made the list
  block's chevron check look.
- The review's findings are fixed or explained.
- Branch: `feat/audit-1113-folds-lists`.
- Task: the audit's tenth batch, after #210's merge (2026-11-14).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-14 (audit
  2026-11-13, batch 10: …)".

Where it stood:
- `ModeSwitch` said «pressed» when told `filters`, else «page»: «Яка
  модель» of «Нова модель» changes the form in place, yet was heard as a
  page. The supplier's rows were plain buttons with a tick — a choice of
  one no reader heard as one.
- Five things that open in place each had their own button: «Ще ознаки»
  ×2 and «Ще про список» with no chevron and no `aria-controls`; the
  debt's history and the order's with their own icon rules. «+ ще N» said
  «expanded: no» on three screens; a customer's history said «Ще 4»; a
  stocktake's «Попередні» and its differences «Ще N», the cursor nowhere
  after.
- «Сьогодні»'s search groups lay on the paper, not on a list's block.
  A held row was kept unfaded and its title pencil only where the title
  was one of four named classes (`.sale-goods`, `.debt-name`,
  `.more-label`, `.cash-row-title`), by a `:has` rule; a row whose title
  had another class was faded as any disabled button, its title ink.
- «Постачальникам»'s returns and ways, «Список постачальників», the
  report's «Моделі» and ways and the invoices' «elsewhere» row lay on the
  paper with lines between; the supplier's rows were 56.
- «Продажі й повернення» waited as three day rows; «Повернути
  постачальнику»'s models as a plain status line; one warehouse's line
  was a line of text 20 high — the fields under it moved when the chips
  came; «Тут немає складу…» was a plain line. «Надійшло» and the report's
  table waited as a few grey bars of no table's shape: the screen jumped
  when the figures came.

## What exists now

- **A switch says which it is** (frame P2-2;
  `frontend/src/shared/ModeSwitch.tsx`): `kind` is required, «page» or
  «pressed», none by default. «page» — the till's «Продати · Повернути ·
  Внесок» alone (`frontend/src/App.tsx`); «pressed» — the other fifteen,
  «Яка модель» of `frontend/src/catalog/NewModel.tsx` among them.
- **A supplier chosen is a radio** (frame P2-2;
  `frontend/src/suppliers/Picker.tsx`): the list is a `radiogroup`
  «Постачальник», each row `li role="none"` holding a
  `button role="radio" aria-checked`. The look as before: the tick and
  the row.
- **One fold** (frame P2-3; `frontend/src/shared/Fold.tsx`): its words,
  the set's chevron 16 in pencil after them, turned a quarter while open
  (no turn with reduced motion), at least 44 high; `aria-expanded`, and
  `aria-controls` — the id of what it opened — only while open. Used by
  «Ще ознаки» (`NewModel.tsx`, `Models.tsx`), «Ще про список»
  (`frontend/src/openings/Openings.tsx`), the debt's «Історія · N»
  (`frontend/src/credits/Debt.tsx`), «Історія доставки»
  (`frontend/src/orders/Order.tsx`), and (review) «Цей опис — назва
  товару?» (`frontend/src/catalog/Catalog.tsx`). Each keeps its own look;
  the old icon rules are gone.
- **One «+ ще N»** (frame P2-3): no `aria-expanded` on Debt's and Paid's
  goods and on a customer's history (`Customer.tsx`: «Ще 4» → «+ ще 4»);
  `frontend/src/inventory/Stocktake.tsx`'s «Попередні» and a finished
  one's differences «+ ще N», the cursor on the first row it brought;
  (review) no «expanded» on a correction's «Додати примітку».
- **The search on a white block** (frame P2-4;
  `frontend/src/today/Search.tsx`): each group's rows and the grey rows
  while read lie on `.list-block`, the caption 8 over it.
- **A row taking no tap** (frame P2-4; `frontend/src/styles.css`):
  `button.sale-row:disabled` — opacity 1, the row's words pencil by
  inheritance, `.sale-goods` too; what has its own colour keeps it.
  «Каса»'s `.correct-row:disabled` keeps its own grey.
- **Lists on blocks** (money P2-4): `Suppliers.tsx` — the returns one
  block, the ways another; `SupplierList.tsx` — the list a block, its
  chevrons `sale-open`, pencil;
  supplier rows `min-height: var(--h-row)` (64); `.list-block
  :is(.sale-row, .supplier-row)` gets the block's padding and hairline;
  `SalesReport.tsx` — «Моделі», «Продажі й повернення» and «Як рахуємо»
  one block under the table; `ReportModels.tsx` — rows a block, the sum
  `.report-sum` 20/24 600 text, ink; `Invoices.tsx` — the elsewhere row
  in its own block, chevron 16. Their placeholders take `block`.
- **Waits shaped as what comes** (money P2-1):
  - `ReportEntries.tsx`: a thread of four, no label (`Placeholder`'s
    `thread.label` is optional now);
  - `NewReturn.tsx`: three grey rows of the models' own shape, no day;
    `p.receive-place` is 52 high, its words in the middle (the same in
    «Прийшов товар»); no warehouse — `Empty`; nothing free — a `t-meta`
    status;
  - `frontend/src/shared/TableWait.tsx`: a table's place — the corner,
    one store's column, each section's name and rows as grey lines of
    their own words in the table's own rows. «Надійшло»
    (`frontend/src/money/Money.tsx`): three ways and «Разом», 5 rows.
    The report (`ReportTable.tsx`'s `ReportTableWait`): three sections,
    «Продажі» and «Повернення» with their meta line, 14 rows; «Рахуємо…»
    said to a reader.

## The independent review

A fresh agent read the diff and the two new files against the frame's
and the money's task lists. `tsc` and ESLint were clean for it; it ran
no journey. No High.

- **M1, fixed: the list block's chevron check never looked.** It
  compared each `svg`'s `innerHTML` with the set's source string, which
  the browser writes otherwise (`<path …></path>`). So every
  `expectListBlock` passed whatever a row's chevron was — the mutant
  `elsewherechevron` (20 instead of 16) survived for that reason. Now
  the set's chevron is put in a probe `svg` and compared as written, as
  `expectLinkChevron` does; a row that is a button must have exactly one,
  16 in pencil.
- **M2, fixed: «Список постачальників»'s chevrons were ink.** The icon
  took the row's `--ink`. It is `sale-open` now, pencil, as every list's;
  the sheet's tick keeps its colour.
- **L, fixed: the report's read let go by itself after 10 s.** On a slow
  run the table could come before the wait was looked at. The hold now
  waits for the journey alone.
- **L, fixed: two buttons still in the old ways.** «Цей опис — назва
  товару?» of «Перевірка каталогу» opened in place with its own button
  and no chevron — it is the fold now; «Додати примітку» of a
  correction said «expanded: no» though it goes once pressed — no longer.
- **L, fixed: the debt history's fold was named by its own words.** The
  journey now names it `Історія · N` by a pattern.
- **L, left: «Сьогодні»'s held row is held by the journey's hand.** The
  whole tab is held while a kept operation is, so no search row is ever
  held there; the rule itself is what is checked.
- **L, left (the task's own edges): waits that may still move.** A
  warehouse's name over three lines is taller than the 52 line; a
  store's name over two lines in the report's head.
- **Checked and fine:** every switch names its kind, only the till
  «page»; the folds' ids stand in the same render; the focus effects sit
  before every early return and never fire on the first draw; the radios
  `ul[radiogroup] > li[none] > button[radio]`; the held rule's
  specificity over `button:disabled` and its colours by inheritance; the
  block rows' hairline in the report's block; the removed rules have no
  users left; the stricter `expectListBlock` still holds for «Каса»'s
  callers.

## How it was built and proven

- Fixtures (`frontend/e2e/fixtures.ts`):
  - `expectFold(fold, name, opened)`: the chevron, ≥ 44 high; shut —
    `aria-expanded="false"`, no `aria-controls`, no turn, nothing opened;
    pressed — `aria-expanded="true"`, `aria-controls` the opened one's
    id, turned 90°.
  - `expectHeldRow(row, title)`: disabled, opacity 1, the title pencil.
  - `expectListBlock(block, rows)` now checks the rows too: each ≥ 64,
    16 at the sides, the hairline from 16 (none under the last), the
    chevrons 16 pencil.
  - `expectLinkChevron` takes the fold's chevron as well.
- Journeys, new: a store with no warehouse to return from
  (`suppliers`); the report read slowly in both themes at 360
  (`sales-report`).
- Journeys, extended: the folds (`catalog`, `models`, `openings`,
  `outage-mark-debts-returns`, `orders-card`); «+ ще N» (`credits-list`,
  `credits-debt`, `stocktake`); the switches (`catalog`, `borrowed`);
  the radios and the slow suppliers (`suppliers`, `supplier-invoices`);
  the search block and a held row (`today-search`); «Ще»'s held row
  under a kept payment (`supplier-invoices`); the blocks at 360 (`suppliers`,
  `supplier-invoices`); «Надійшло»'s table wait (`money`); the returns'
  grey rows on their block (`suppliers-pages`); the catalogue's name fold
  (`catalog`); «Додати примітку» gone once pressed (`correct`).
- Journeys: 1140 by `--list` (1137 before).

## Mutants

`~/.cache/birka-runtime/helpers/mutate58.py` (list, check, apply,
restore), run by `mutants58.sh`: each mutant applied, its one journey
run with no retries, the source restored. A fresh seed before the run.

- 51 at first, 50 caught. `elsewherechevron` (the elsewhere row's
  chevron 20) survived: `expectListBlock` compared chevrons as the set's
  source string, so it never found one (the review's M1). Fixed, it is
  caught.
- 3 more for the review's fixes, each caught: `supplierlistpencil` (the
  list's chevron without `sale-open`), `namefold` (the catalogue's fold
  naming no id that is there), `noteexpanded` («Додати примітку» saying
  «expanded: no» again).
- By what they break:
  - the switches' kind (`tillpressed`, `newmodelpage`, `borrowedpage`,
    `switchsense`);
  - the supplier radios (`pickerradio`, `pickerchecked`, `pickergroup`);
  - the fold (`foldcontrols`, `foldchevron`, `foldturn`, `foldtouch`)
    and each fold's id (`newmodelid`, `modelsid`, `openingsid`,
    `orderid`, `debtcontrols`);
  - «+ ще N» (`customerwords`, `customerexpanded`, `debtexpanded`,
    `paidexpanded`, `stocktakewords`, `stocktakefocus`,
    `differenceswords`, `differencesfocus`);
  - the search block and the held rule (`searchblock`,
    `searchwaitblock`, `heldfade`, `heldink`);
  - the blocks (`returnsblock`, `waysblock`, `returnsgrey`,
    `supplierrow64`, `supplierlistblock`, `supplierlistgrey`,
    `blocksupplierrow`, `reportwaysblock`, `reportsum`, `modelsblock`,
    `modelsgrey`, `elsewhereblock`, `elsewherechevron`);
  - the waits (`entriesrows`, `threadlabel`, `reportwaitrow`,
    `reportwaitmeta`, `moneywaitrow`, `tablewaitclass`,
    `returnsearchgrey`, `onewarehouse`, `nowarehouse`, `nonestatus`).
- `mutate58.py check` is clean after the runs; no mutant is left
  applied.

## Evidence

- The touched specs on a fresh seed, one worker: 407 of 410 in 13.7 min
  (`today-search`, `suppliers`, `supplier-invoices`, `sales-report`,
  `money`, `borrowed`, `catalog`, `models`, `openings`, `orders-card`,
  `outage-mark-debts-returns`, `credits-list`, `credits-debt`,
  `stocktake`, `cash-correct`, `cash-history`, `cash-move-fix`,
  `design-system`, `receive`, `goods-places`).
  - The report's slow journey, both themes: «Сьогодні» reads today's
    report first, with no query and under the report's own key, so the
    hold by `?` never held it and the report opened read. It is held
    from the start now, by the path with or without a query.
  - The kept payment's journey: «Ще»'s «Постачальникам» is held while
    the payment is, so the suppliers' way could not be reached. The held
    rule is checked on «Ще»'s row.
  - After: those three and the returns' grey rows on their block
    (`suppliers-pages`): 4 of 4.
- After the review's fixes, on a fresh seed: `cash-correct`,
  `cash-history`, `cash-move-fix`, `sales-report`, `suppliers`,
  `suppliers-pages`, `today-search`, `supplier-invoices`, `catalog`,
  `correct`, `outage-mark-debts-returns` — 139 of 141 in 4.1 min; the two
  were «Каса»'s correction rows with no chevron, then 2 of 2.
- The whole suite: GitHub CI on the PR (#211). No local full run, by
  the user's word (2026-11-14).
  - The first run: 1138 of 1140. The two were the report's slow journey,
    both themes: with one store «Моделі» is read with no query, so the
    hold by `?` never held it; the grey rows only flashed, caught locally
    by luck. Both the report's read and «Моделі»'s are now held by their
    path, with or without a query, until the journey lets them go: 6 of
    6 (each theme three times), the journey's 8 mutants caught.
- Journeys: 1140 by `--list` (1137 before).
- Types: `tsc --noEmit` clean; the e2e config has 44 errors, all of
  them main's (main has 48).
- ESLint: `src` and the touched specs are clean.
- Prettier is clean on what this batch changed. `App.tsx`, `Debt.tsx`,
  `credits-debt.spec.ts`, `today/Search.tsx` and `styles.css` are
  unformatted on main; the first four have exactly as many lines off as
  on main.

## Not covered

- A real phone: the fold's turn, the blocks' outline in dark, a reader
  on Android hearing the radios.
- The report's ways take no hold, so the held rule has nothing to show
  there. The suppliers' ways are held only while «Ще»'s «Постачальникам»
  is too, so no journey reaches them held; the rule is shown on «Ще»'s
  row.
- «Сьогодні»'s rows are never held while the search shows (the whole
  tab is held), so the held look there is checked on a row disabled in
  the page.
- A store's name over two lines in the report's head may still add a
  line when the figures come: the wait draws one store's column.
- «Каса»'s correction rows open an operation's card with no chevron,
  though the spec's list row ends in one (§6.8). Seen when the list
  block's check began to look at chevrons; outside this batch's tasks,
  so their journey says so and they are left as they were drawn.
- Left on the frame list: P2-5 p. 2, haptics by S12, after the owner
  reads it; P2-7, after В13-Т1.
- Left on the money list: P2-5 (б) after В13-Г2; P2-7 after В13-Г1.
