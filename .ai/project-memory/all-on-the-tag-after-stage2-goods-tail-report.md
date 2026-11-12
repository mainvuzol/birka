# «Усе на бірці», after stage 2's audit, batch 14: «Перевірка каталогу»'s queue and the catalogue's search add their next page under the first; «Товар»'s screens hold grey places while read; one blank tag for nothing; «← Перевірка каталогу»; a receipt's result keeps its «←» — 2026-11-12

Baseline: `caaa987e` (the audit's thirteenth batch, PR #196, merged). This
batch covers the three points of the goods task list after stage 2 that
wait for no approval:
- [P2-1](redesign/2026-11-09-redesign-tz-after-stage2-goods.md): pages
  added under the first, as everywhere else;
- [P2-2](redesign/2026-11-09-redesign-tz-after-stage2-goods.md): grey
  places instead of «Завантажуємо …», and one blank tag for nothing;
- [P2-3](redesign/2026-11-09-redesign-tz-after-stage2-goods.md): one
  «←».

Left of the goods task list: P1-2, P1-3, P1-4, P1-5 and P2-4, each marked
«нужно утверждение» (the design or the words).

Status: built and proven in the journeys; not committed. The goods task
list's three points without approval are done; P1-2, P1-3, P1-4, P1-5 and
P2-4 wait for the owner.
Not yet seen on a real phone.
- Branch: `feat/after-stage2-goods-tail`.
- Task: the audit's fourteenth batch, chosen in chat after #196 was merged
  (2026-11-12, «merged, go next»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-12 (audit after
  stage 2, batch 14: …)".

Where it stood:
- «Перевірка каталогу» paged its queue by «Попередні пропозиції» and
  «Наступні пропозиції», each replacing the twenty in sight; the
  catalogue's search did the same with «Попередні» and «Ще товари».
- Fourteen places of the section said «Завантажуємо …» (or «Шукаємо…») as
  one line at the top of an empty screen; everything jumped when the
  answer came.
- Nothing in the queue, on a warehouse of «Залишки» or in a count was a
  grey line; «Початкові залишки» with no list drew the screens' blank tag
  of before a store.
- A proposal's way back was a quiet button «← До черги перевірки», its
  arrow read aloud. «Прийшов товар»'s result had no «←» and no Telegram
  «Назад»: from a model's page, there was no way back to it but the menu.

## What exists now

- **Pages added under the first** (P2-1):
  - the queue: «Показати ще», twenty more under the rows;
  - the catalogue's search — on «Прийшов товар», a stocktake's found
    goods, a line of «Початкові залишки» and the till's «Знайти в
    каталозі»: «Ще товари» adds under what was found; «Попередні» gone;
  - a page that failed: its one «Спробувати ще раз», held while the list
    is read, the rows read stay — also while «Оновити» reads; a re-read
    refused: the plate over the rows, which stay;
  - the search typed again: what was found stays until the new answer;
  - the cursor on the first row a page brings.
- **Grey places** (P2-2; spec §5 «Скелетон», §6.27):
  - the queue: three proposals' rows, a sticker's place under the words;
    the first row comes where the first grey stood, as high (±2 px each,
    checked);
  - a proposal: its words large, its sticker, two models offered with «Це
    вона»'s place; its words come where their grey stood;
  - the catalogue's search: three rows of one line;
  - «Моделі»'s model: its hero tag, the name's line 42, ⋯'s place; the
    name comes where its grey stood;
  - the warehouses of «Прийшов товар», «Залишки» and «Інвентаризація»: two
    grey choices; «Прийшов товар»'s sizes: four sizes' steps, 44 high;
  - a warehouse's stocktakes: «Попередні» and three rows of its thread; a
    stocktake's differences: as many grey lines as will be shown, five at
    most;
  - «Початкові залишки»: three lists' tags in a list's shape — eyelet,
    name, meta, sticker 28, «Відкрити» 44; a list's lines: three tags in a
    line's shape, its verb 44, the first where the first line comes and
    as high (±2, checked); a list awaited from «Сьогодні»: its big tag over
    three lines; a line's sizes: four cells 60 × 60;
  - the words are said to a screen reader alone.
- **Nothing here** (P2-2; spec §6.28): the blank tag 64 and its one line —
  the queue (each switch), «Залишки», counting (each switch), «Початкові
  залишки». Two sentences: the first the line, the second its meta.
- **One «←»** (P2-3): «← Перевірка каталогу» over a proposal, read «Назад
  до «Перевірка каталогу»»; «Прийшов товар»'s result keeps the form's «←»
  — «← Ще», «← {модель}» — and Telegram's «Назад». A receipt confirmed —
  by the form, or on reopening the app — resets the stock read before:
  the model's grid, opened again, waits in grey and shows what came, never
  the count before; the till's search reads it again too (before this
  batch a receipt refreshed neither).

## The independent review

An independent review (a fresh agent, the diff and the task list; no
conclusions handed to it) found no high finding. Medium, all fixed:
1. A next page failed, then the whole list read again (`Оновити`, the app
   back): the rows went, the plate in their place. Now as the till's list
   (sale P1-4, `useNextPageFailed`): the page's failure stays at the foot
   while the list is read; a re-read refused, the plate over the rows,
   which stay. The queue's journey checks both.
2. «Початкові залишки»'s grey tags were the orders' line tags (no margin,
   76 high), not a list's or a line's (~120, with sticker and verb), and
   a list awaited from «Сьогодні» showed three lists' tags. Now their own
   shapes (`OpeningPlaceholder`), the awaited list its big tag over three
   lines; checked in `goods-places`, `openings` (place and height ±2) and
   `today`.
3. The search collapsed to grey on each retyped word. Now it keeps what
   was found until the new answer, as the till's list; never «Нічого не
   знайшли» under the new words.

Low, fixed: the grey proposal's row was shorter than the row (now a
sticker's place 28; its height checked); the differences always two grey
lines (now as many as shown, five at most); the queue's foot retry not
held while read; the search's pages not capped at the server's 10 000;
the cursor lost after «Показати ще» / «Ще товари» (now on the first new
row, checked); a receipt confirmed on reopening the app did not drop the
stock read before (App's check now resets it too, and the till's search
reads it again — neither did before this batch); the rules' words on what
«Оновити» reads; an unrelated `.sheet` reformat reverted.

Test gaps closed: Telegram's «Назад» on a receipt's result (pressed, it
leads back to the model); a failed page, then «Оновити» held, then
refused (rows stay); the openings lines' grey place. Not run: the dark
theme (the places use the shared skeleton tokens).

## How it was built and proven

**Code:**
- `frontend/src/shared/Placeholder.tsx`: `steps` (a size's steps),
  `thread` (a history's thread under its label), `rowShape.meta`.
- `frontend/src/catalog/Catalog.tsx`: the queue by `useInfiniteQuery`,
  «Показати ще», one retry, its places, `ProposalPlaceholder`, `Empty`,
  «← Перевірка каталогу».
- `frontend/src/inventory/CatalogPicker.tsx`: the search by
  `useInfiniteQuery`, «Ще товари» adding, one retry, its places.
- `frontend/src/catalog/Models.tsx`: `ModelPlaceholder`.
- `frontend/src/inventory/Receive.tsx`: the warehouses' and sizes'
  places; the result's «←»; the stock read before reset, the till's search
  read again.
- `frontend/src/App.tsx`: the same on a receipt confirmed on reopening.
- `frontend/src/inventory/Stock.tsx`, `Stocktaking.tsx`, `Stocktake.tsx`:
  their places, `Empty`.
- `frontend/src/openings/Openings.tsx`: `OpeningPlaceholder` (lists,
  lines, a list awaited), `Empty`; `Line.tsx`: its cells.
- `frontend/src/styles.css`: the places' shapes (`.skeleton-verb`, the
  grey eyelet, `.skeleton-step`, `.skeleton-choose`); `.opening-empty` and
  `.stocktake-empty`'s margin gone.
- `frontend/e2e/fixtures.ts`: `sellsFrom` lets go a read a reload cut
  (a CI flake met in the full run).
- No backend change.

**Journeys:** 1082 in all; 1073 before.
- New: `goods-places` (9) — the queue read slowly, its pages, one retry
  held while «Оновити» reads, a re-read refused over the rows, the cursor
  on the first new row; the queue's blank tags; a proposal read slowly and
  its «←»; «Прийшов товар» read slowly — warehouses, the search's rows,
  pages and cursor, a retyped search keeping its rows, sizes' steps; a
  receipt's result «← {модель}», Telegram's «Назад» pressed, and the grid
  read anew;
  «Моделі»'s model read slowly; «Залишки» read slowly and its blank tag;
  «Інвентаризація» read slowly — warehouses, the thread, differences —
  and counting's blank tags; «Початкові залишки» read slowly and its
  blank tag. At 360 px where a place is checked.
- Changed: `openings` (a list's lines read slowly — their tags' shape,
  place and height — and a line's sizes); `today` (a list awaited from
  «Сьогодні» read slowly: its big tag over three lines);
  `openings-file` (the lists' words to a reader alone); `catalog`,
  `models`, `telegram-back` («Назад до «Перевірка каталогу»»).

## Mutants

`mutate44.py`, 45 mutants, each applied alone, its journey run, the
source restored (`mutants44b.sh`; the openings list's after a fresh seed):
45 of 45 caught, each at the check meant for it.
- P2-1 (4): the queue's and the search's pages replacing, not added;
  their «Спробувати ще раз» gone for «Показати ще» / «Ще товари».
- P2-2 (26): each place back to its «Завантажуємо …» line, or its shape
  gone (the queue's row and its stretch; a proposal's «Це вона» place;
  the search row's meta; «Прийшов товар»'s chips' class, the steps 40
  high; the model's name 42; the thread's round eyelets; the differences
  unhidden), and each blank tag back to a line, or its meta gone.
- P2-3 (4): «← До черги перевірки» back, the «←» quiet, the result
  without «←», the stock read before kept after a receipt.
- The review's fixes (11): the rows gone under a refused re-read; the
  foot's retry not held; the cursor not set; «Показати ще» not held under
  a refused re-read; a retyped search collapsing to grey; the proposal
  row's sticker place gone; the openings' list foot gone, their verb 40,
  the lines' place moved 8 px, the awaited list drawn as the lists; the
  differences always two.
- Dropped as equivalent: the cursor set again by a page's retry — the
  press that failed set it already, and it stays until the page is read;
  the line is gone from the code.
- Not covered by a mutant: the search's cap at offset 10 000 (500 pages);
  a receipt confirmed on reopening (App's check) and the till's search
  read again after a receipt — no journey reopens with a receipt kept.
- The first pass, before the review (34 mutants), caught all; `pickmeta`
  one line late, since the held answer let itself go after ten seconds —
  its check is now counted once.

## Evidence

- Full run, a fresh seed, one worker: 1079 of 1082 in 30.2 min. The
  three:
  - `backups:93` — the stand's own (the additive seed's nights), as in
    every full run since batch 8;
  - `cash-kept:630` (the night the clocks go back) — the door's timing,
    as in batch 7's full run; alone, 3 of 3 pass;
  - `telegram-rules:874` — a flake of the till's stub: `sellsFrom`'s
    warehouses read was cut by the journey's own reload, and its answer
    came to a request already gone («Route is already handled»). Alone, 19
    of 20 passed. The stub now lets such a read go (`fixtures.ts`); 6 of 6
    since. Nothing of this batch is on that screen.
- The batch's journeys after the review's fixes: `goods-places` 9 of 9;
  `openings`' list and `today`'s verbs in the full run.
- Types: `tsc -p tsconfig.json` clean; the journeys' (`tsconfig.eslint.json`)
  44 errors, as on main — none on a line of this batch. ESLint clean on
  every file touched; Prettier on the files touched, their unrelated
  hunks left as they were.

## Not covered

- A real phone.
- «Шукаємо моделі…» in «Інший колір нашої моделі»: P1-5's search, which
  waits for approval.
- «Тут рядків немає.» under a list's switch: not a section's nothing; not
  in the task's list.

## For the owner

- **Done:** while «Товар» reads, grey rows, tags and cells stand where the
  real ones will come; nothing jumps. The queue and the catalogue's
  search add their next page under the first. Nothing is said with the
  same blank tag everywhere. A proposal and a receipt's result have their
  «←».
- **Waiting for your approval** (the goods task list): P1-2 «Знайшли
  товар, якого немає в списку» as one screen; P1-3 the price on
  receiving as on the model's page (words); P1-4 the catalogue's kept
  operation in the shared form (words); P1-5 «Інший колір нашої моделі»
  searched as typed; P2-4 «Новий список» with a switch and one field.
- **Still open:** «Закриття · Центр» (batch 12); «Продано»'s stub words
  (batch 13); the «Початкові залишки» hold line (batch 10).
