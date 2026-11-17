# «Усе на бірці», audit 2026-11-15, batch 8: the goods' tail — «Товар»'s lists as a list's rows 64 on a white block, in a sheet with no block; felt as the rest of Бірка feels — 2026-11-17

Baseline: `a19f6c55` (main after #221). The goods task list's last open
points (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-goods.md`):
- P2-2, «Товар»'s lists;
- P2-3, its haptics.

Picked by «merged, go next».

Nothing recorded, sent or counted changes. No request, order of rows, page
or choice changes. No word on a screen changes.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1190 (1181 before).
- Branch: `feat/audit-1115-goods-tail`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-17 (audit 2026-11-15, batch 8: the goods' tail …)".
- Owner: «Прибрати» alone on the row's right waits for a reading; until
  then «Прибрати {модель}» stays under the line's two lines.

## What exists now

- **On a screen, a list's rows on its white block** (P2-2): 64 high at least,
  sides of 16, a hairline from the text's edge, none under the last:
  - «Перевірка каталогу»'s queue and «Моделі»'s search: the words or the
    name 17/600 in ink, the sticker under it, the chevron of 16 on the right;
  - the catalogue's search on a screen — «Прийшов товар», «Знайшли товар…»,
    a line of an opening list and the till's «з каталогу»: radios, the one
    chosen filled in the chosen colours;
  - «Пропозиція»'s models offered, «Це вона» on their right;
  - «Пораховані», «Перерахувати» on the right;
  - «У поставці»: the model and its size 17/600, under them how many, how it
    came and its price, then «Прибрати {модель}». A long name wraps inside
    the row.
- **In a sheet** — «Нова модель»'s «Схожі», the rename's fork, «Інший колір
  нашої моделі»'s search: rows 64 with the line's hairline, no block.
- **The grey places** while a list is read: the same rows on the same block,
  their list's own class kept — «Пораховані»'s too.
- **The chosen found row, pressed again** (the till's «з каталогу», where the
  list stays open): it keeps its chosen fill.
- **A queue's row taking no tap**: never faded, its words in pencil, as
  every held row.
- **Felt** (P2-3):
  - `selection`, only when the choice changes: the warehouse chips of
    «Прийшов товар», «Інвентаризація», «Залишки», «Новий список»; «Як
    надійшов»'s ways; «Схожі моделі»'s chips; «Це вона» on «Пропозиція», in
    «Нова модель» and in the rename's fork; «Окрема модель зі схожою
    назвою»; a model found by the catalogue's search and by «Інший колір
    нашої моделі»;
  - `light`: «−» on «Прийшов товар», as «+»; nothing at 0;
  - `error` on «Прийшов товар»: the server's refusal, and an input refused at
    the press (a price that is not money, the same line twice, more than 200
    lines, «Оберіть постачальника…»); nothing as a price is typed;
  - «Зберегти список»: `success` once saved, `error` once refused or too
    large; its answer lost, nothing;
  - entering a screen, typing and scrolling: nothing.

## How it was built and proven

Sources:
- `catalog/Catalog.tsx`, `catalog/Models.tsx`: the queue and the search on
  a block, the chevron; «Пропозиція»'s models offered; the grey places;
  «Це вона», «Окрема модель…» felt on a change;
- `catalog/NewModel.tsx`, `catalog/FamilySearch.tsx`: rows 64 in the sheet;
  «Це вона», «Схожі моделі» and a model found felt;
- `inventory/CatalogPicker.tsx`: the found rows on a block, a row chosen
  felt on a change;
- `inventory/Receive.tsx`: «У поставці» as rows on a block; the haptics;
- `inventory/Stocktake.tsx`: «Пораховані» and its grey rows on a block;
- `inventory/Stocktaking.tsx`, `inventory/Stock.tsx`,
  `openings/Openings.tsx`: the haptics;
- `shared/Placeholder.tsx`: a block keeps its list's class;
- `styles.css`: the old card rules gone; `.sale-row.catalog-row` (over
  `.sale-row`'s own weight, drawn later), the chosen fill and its press,
  the queue's words and sticker, «У поставці»'s rows.

New helpers in `e2e/fixtures.ts`:
- `blockRow`: a row on its list's white block — 64, sides 16, the hairline
  from the text's edge or none under the last. `listRow` uses it now;
- `sheetRow`: a row 64 in a sheet, on no block, the line's hairline;
- `rowTitle`: 17/600 in ink;
- `haptics`: Telegram's host stubbed, what the app has it feel;
- `feels`: what one act is felt as, and nothing more.

New and changed journeys:
- P2-2:
  - `catalog.spec.ts`:
    - the queue's row a list's row (`listRow`);
    - «Пропозиція»'s models offered on the block at 360, 17/600;
    - «Інший колір нашої моделі»'s row in the sheet;
  - `models.spec.ts`:
    - the search's row a list's row, its grey ones on the block;
    - the rename fork's rows in the sheet;
  - `receive.spec.ts`:
    - «Нова модель»'s rows in the sheet;
    - a new journey at 360 in both themes: the found models on the block;
      «У поставці»'s rows on the block, a long name wrapped inside, the
      line under it, «Прибрати» under them, named as before;
  - `stocktake.spec.ts`: «Пораховані»'s rows on the block, and its grey rows
    there too, where the rows come;
  - `till-two-warehouses.spec.ts`: the till's found row on the block, chosen
    in the chosen colours, and pressed again still filled;
  - `goods-places.spec.ts`:
    - the grey rows of the queue and of the found models on the block;
    - a new journey: while a catalogue command is on its way, the queue's
      rows held, never faded, in pencil.
- P2-3, new Telegram journeys:
  - `receive.spec.ts`: entering, nothing; the warehouse; a model found; «−»
    as «+», nothing at 0; the ways; a price not money at «Готово»; the same
    line twice; the server's refusal;
  - `stocktake.spec.ts`: entering, nothing; the warehouse;
  - `stock.spec.ts`: entering, nothing; a warehouse anew, the one chosen
    again;
  - `openings.spec.ts`:
    - «Новий список» opened, nothing; the warehouse; refused, `error`; its
      answer lost, nothing; saved, `success`;
    - a line's model chosen, felt;
  - `models.spec.ts`: the rename's fork, «Це вона» and «Окрема модель…»;
  - `catalog.spec.ts`: «Це вона» in the sheet and on the screen; «Схожі
    моделі»'s chip; a model found;
  - `till-two-warehouses.spec.ts`: a model found at the till, and chosen
    again, nothing.

Touched specs on a fresh seed:
- first run: 131/135. One real fault was found: the found rows' titles drew
  at 400, since `.sale-row`'s weight is drawn later than `.catalog-row`'s.
  Two journeys asked the wrong words: a family is found by its name, not its
  colour; on a crowded base, «Лоран» is offered only for words of its own;
- fixed and rerun, with `goods-places`: all passed;
- the ring around them (`till-first-days`, `till-placeholders`, `correct`,
  `outside-text`, `design-system`, `goods-places`): 64/64 on a fresh seed;
- after the review's fixes, `stocktake`, `till-two-warehouses`, `openings`,
  `stock` and `receive` whole: 74/77. The three were the base's state from
  the runs before (a list already waiting, two lists of one name, a
  stocktake open), and all passed on a fresh seed.

## The review

An independent review covered:
- the CSS order and specificity;
- every screen and sheet the lists stand on;
- the haptics' conditions and their paths in «Новий список»;
- the tests and the task list's criteria.

It found nothing High. `tsc` and `eslint` are clean.

Checked and found right:
- every `.catalog-row` and `.catalog-proposal` is also a `.sale-row`, so a
  held one is never faded;
- the hairline's selectors fit every list's structure;
- roles, `aria-checked`, `aria-pressed` and «Прибрати …»'s `aria-label`
  are unchanged;
- no tap is felt twice, and none as a price is typed.

Medium, fixed:
- **«Пораховані»'s grey rows were on the paper**, and the block came in with
  the rows, every row moving sideways. Now its grey rows are on the block
  in the rows' shape. The journey holds the list's read and checks the grey
  rows on the block, the rows where they stood.

Low, fixed:
- **The chosen found row, pressed again, faded its words** into the fold
  (about 1.2:1) on the till's «з каталогу». Now it keeps its fill.
- **Untested:**
  - «the one chosen tapped again, nothing» for the found rows. Only the
    till keeps the list open after a choice: a Telegram journey there now;
  - «entering feels nothing»: checked in «Прийшов товар», «Інвентаризація»,
    «Залишки» and «Новий список».

Nit, fixed: the stocktake's warehouse haptics have a journey of their own,
named for them, not inside the four sizes' one.

Left with a reason:
- **The white block itself** (its colour, corners and outline) is not
  checked again for each list: the design system's journey checks
  `.list-block` once.
- **A chosen first or last row's square corners** over the block's rounded
  ones (about 1 px): an inner radius would be off the scale.
- **A 500 at «Зберегти список» is felt as `error`**, as the screen says
  «Список не збережено…» for it.

## Mutants

`~/.cache/birka-runtime/helpers/mutate68.py`, run with `mutants68.sh`. Each
mutant is applied, its journey is run once (`pw-slow`, no retries), and the
source is restored.

55 of 55 caught, each by the journey named for it: 52 on the first run, then
3 added after the review, and the two stocktake chip mutants run again
against their new journey.

- P2-2:
  - the queue: `queueblock`, `queuerow`, `queuechevron`, `queueplace`,
    `placeholderlist`, `proposalgap`, `heldraw`;
  - «Пропозиція»: `offeredblock`, `offeredrow`, `offeredtitle`;
  - «Моделі»: `msearchblock`, `msearchchevron`, `msearchplace`, `rawtitle`;
  - sheets: `renamerow`, `newmodelrow`, `famrow`;
  - the found rows: `pickerblock`, `pickerrow`, `pickerplace`,
    `pickerchosen`, `rowtitle`; after the review, `chosenpress`;
  - «Пораховані»: `countedblock`, `countedrow`; after the review,
    `countedplace`;
  - «У поставці»: `linesblock`, `linerow`, `linecolumn`, `linewhat`,
    `linewrap`.
- P2-3:
  - «Прийшов товар»: `recvplace`, `recvplacenone`, `recvdown`,
    `recvdownzero`, `recvway`, `recvcost`, `recvrefuse`, `recvrefused`,
    `pickerbuzz`; after the review, `pickerchange`;
  - `stktchip`, `stktchipnone`, `stockchip`;
  - «Новий список»: `openchip`, `opensuccess`, `openerror`, `openlost`;
  - `renameit`, `renameapart`, `renameapartnone`;
  - `catalogit`, `newmodelit`, `similarchip`, `famsearch`.

Not a mutant:
- `.receive-line > .sale-main`'s stretch: the long name wraps either way;
- `buzz("error")` before «Файл завеликий…» at «Зберегти список»: reached
  only by a file whose send tips over the bound. A journey of its own would
  need a file built to the byte.

## CI: the frontend's audit (#222)

The first run's `frontend (lint, types, build)` stopped at `npm audit
--audit-level=high`, before lint. Nothing in this batch: its lockfile is
main's, and main's fails the same. On 2026-11-17 GitHub widened picomatch's
high advisory GHSA-fc5q-39xc-vjpf to every release up to 4.0.7, the latest,
with no fix; npm's only way out is vite 6.2.7, a breaking step back.

By the user's word («Yes, in this PR»), the step is now
`node ../.github/scripts/npm-audit.mjs`: `npm audit --json`, failing on
every high or critical advisory but the named exceptions. One for now:
picomatch's, only under vite and typescript-eslint (through tinyglobby and
fdir), never in the bundle, matching our own config's patterns.

Decided here: until 2026-12-17, a month. After it, the check fails again so
that someone looks at it. Recorded in ADR-0010 §5 beside `pip-audit`'s
`--ignore-vuln`.

Checked with a stand-in `npm`:
- passes on today's tree, the exception printed as a warning;
- fails on another high advisory;
- fails on the same advisory id reported on another package;
- fails when npm gives no report;
- fails once the exception's day has passed;
- an advisory no longer reported is a notice to remove its exception.

## Not covered

- The look on a real phone, in Telegram's own haptics.
- The full suite is left to CI.
- «Прибрати» alone on the row's right waits for the owner.
