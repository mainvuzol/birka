# «Усе на бірці», after stage 2's audit, batch 9: the till's list kept when a read again or a next page fails, «Показати ще»; one line of context on S21, the return form and «Покупці», S21's «Винні» over the dock at 360 × 640; «Знайти в каталозі», «Розмір з етикетки» and «Продажу немає» in the new system — 2026-11-10

Baseline: `9f161831` (the audit's eighth batch, PR #190, merged), and three
tasks of the sale task list after stage 2:
- [P1-4](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — the
  till's list kept when it cannot be read again, its next page read alone,
  «Показати ще»;
- [P1-3](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — one line
  of context on S21, the return form and «Покупці»; «Винні» over S21's
  dock at 360 × 640;
- [P2-3](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — the
  till's rare screens in the new system, their words as before.

P2-4 («{Ім’я} · винні всього {сума}» in a sheet) waits for its words'
approval; P2-5 waits for В-П1. With this batch every other task of the
sale task list is built.

Status: built; proof below — 1056 of 1057 journeys on a fresh seed, the one
failing for the stand's database, as in batches 7 and 8. 36 of 36 mutants
caught. CI is GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-sale-rest`. Task: the audit's ninth batch, chosen
in chat after #190 was merged (2026-11-10, «Sale P1-3, P1-4, P2-3»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-10 (audit after
stage 2, batch 9: …)".

Where it stood:
- any read of the till's list that failed took the list's place — a read
  again on coming back to the app or after a sale, and a next page; the
  next page's retry read the whole list again; its button said «Ще
  товари», every other list «Показати ще»;
- S21 and the return form drew two lines under the title: the header's
  «Магазин · Ім’я» and their own; «Покупці» its words a paragraph; the
  return form's «← До списку» at the title's right;
- at 360 × 640 S21's dock covered «Винні» until the screen was scrolled;
- «Знайти в каталозі» had a heading of its own, the system's list for the
  warehouse, chips 14 round for the sizes and «Завантажуємо розміри…» on
  the screen; «Розмір з етикетки» was the system's list; «Продажу немає»
  had no stub and its «Новий продаж» stood in the flow, not in the dock.

## What exists now

- **The till's list kept** (P1-4; P7, §5):
  - never read — the warning's plate in the list's place, as before;
  - read, then refused when read again (back in the app, after a sale) —
    the plate over the tags; the tags stay as read and their cells take
    their taps, the server checking the shelf at the way, as ever;
    «Показати ще» held until they are read again; nothing found, the
    blank tag and the catalogue's way stay under the plate;
  - the next page refused — the plate under the tags read, where
    «Показати ще» stood; «Спробувати ще раз» reads that page alone
    (offset 100), never the list from the start;
  - «Ще товари» is «Показати ще», as every list says, in «Нове
    замовлення» too, which shares the list. The till and «Нове
    замовлення» pass no failure of their own in: the list draws its plates.
- **One line of context** (P1-3; P2, S19, S21): the header's line names
  what the screen is about, in the store's and the person's place —
  - S21: «Оксана Петренко · «Основний» · з 01.10», the debt's own store in
    it; no paragraph under the goods. A debt's detail keeps its line with
    the phone to call;
  - the return form: «Продаж 17.10, 14:32 · 6 000,00 грн», « · магазин
    «Другий»» when sold there; «← До списку» over the title, as on S21;
  - «Покупці»: «Ті, хто купує частинами», «Змінити магазин» at its right.
- **S21 at 360 × 640** (P1-3; §6.25): below 700 px of stable height the
  keys are 44 and the sum's field 64, as the cash count's; «Винні» and its
  sum one line in `money-l` (32/34), «Сплачено X з Y» under it. Opened
  unscrolled, «Винні» and the sum stand over the dock.
- **The till's rare screens** (P2-3; §5, §6.13, §6.27, §6.30):
  - «Знайти в каталозі» is a part of the till, no heading of its own;
    with two warehouses or more «З якого складу віддаєте?» over deciding
    chips 44, none chosen, the chosen one in the chosen colours; the
    model's sizes the till's cells 60 × 60, the letter alone; four grey
    cells while they are read, «Завантажуємо розміри…» said to a reader
    alone. Its words as before;
  - «Розмір з етикетки»: deciding chips 44 in the basket's sheet, «Не
    читали — продати як «розмір невідомий»» chosen first, then the
    model's sizes; a chip sends the size the list did; sizes not read
    say so in the row, with their retry;
  - «Продажу немає»: «Нічого з кошика не було на полиці.», the stub torn
    off headed «Нестачу записано» with a line a model, «Перевірте склад
    із менеджером.» one line, «Новий продаж» in the receipt's dock.

## The independent review

An independent reviewer read the diff against `main` with the three tasks
and the decisions above; it ran the type check and ESLint, not the
journeys. No high finding; one medium, two low, five nits. Settled:
- **An empty search lost its blank tag when read again and refused**
  (medium): the empty place asked for a list read with success, and a read
  again refused is an error with its data held — only the plate was left,
  with no way to the catalogue for the coat in hand. It asks what was read
  now; a journey: nothing found for «абв», read again and refused — the
  tag, «Очистити» and «Знайти в каталозі» under the plate.
- **«Показати ще» over a list not read again** (low): a next page read on
  top of it cleared the plate while the first hundred's free counts were
  still the old ones. It is held while the plate over the tags shows; the
  plate's retry reads the whole list first. The read-again journey now
  holds it disabled, then free once read.
- **The label's sizes not read were said only behind the sheet** (low):
  the sheet showed «Не читали» alone with «оберіть його» under it. The
  warning's plate and its retry stand in the row now; a journey refuses
  the sizes, finds the plate and no size, retries and finds them.
- Nits: «Винні» stood on its glyph's foot, a few pixels over the sum's
  baseline — `last baseline` now (the screenshot shows it on the line);
  the chosen colours of the two new rows were the pressed chip's own
  already — the two rules are gone, the journeys still read the colours;
  two rows of an unknown size were heard alike — each is read with its
  line's model; the caption's stale comment.
- Seen and kept: on a list never read, the plate's held retry unmounts at
  once and the previous search's tags flash under the new words while it
  is asked — as on `main`.

## How it was built and proven

- **Code:**
  - `frontend/src/sales/StockSearch.tsx`: the plates by what was read,
    the next page's retry, «Показати ще»; `frontend/src/sales/Sale.tsx`,
    `frontend/src/orders/NewOrder.tsx`: no failure passed in;
  - `frontend/src/credits/Debt.tsx`, `frontend/src/returns/Returns.tsx`,
    `frontend/src/credits/Credits.tsx`: the header's context, the return
    form's «← До списку» in `back`;
  - `frontend/src/sales/FromCatalog.tsx`, `frontend/src/sales/Sale.tsx`:
    the warehouse's chips, the cells and their grey places, the label's
    chips, «Продажу немає»'s stub and dock;
  - `frontend/src/styles.css`: S21's short phone, the deciding chips, the
    catalogue's cells; `.sale-context` and `.credits-context` gone.
  - No backend change. One word: «Ще товари» → «Показати ще».
- **Journeys:** 1057 in all, 1050 before.
  - New: `till-search` — a list read again and refused keeps its tags
    under the plate, the cells pressed, «Показати ще» held, the retry
    clearing it; a sale
    after it in three taps, its body as ever; the next page refused, the
    plate under the hundred, its retry asking offset 100 alone; nothing
    found, read again and refused, the blank tag and the catalogue's way
    kept (review); `till-cells` — a label's sizes not read, said in the
    sheet, the row named by its model (review);
    `credits-debt` — S21 at 360 × 640, one line, «Винні» over the dock
    unscrolled, the keys 44, the sum's field 64; `till-placeholders` —
    the catalogue's grey cells, 60 × 60, the cells where they stood.
  - Changed: `till-search` («Показати ще»; a label's chip), `fixtures`
    («Показати ще»), `till-two-warehouses` (the warehouse's chips, the
    cells, no heading), `size` (the label's chips, the colours, the same
    `size_id` sent), `till-cells`, `outage` (the label's chips),
    `shelf` (the stub, the dock, both themes at 360), `credits-debt`,
    `credits-list`, `credits` (the header's line), `returns-sale-screen`
    (the line, «← До списку» over the title; nine things still),
    `returns-elsewhere` (the store in the line).

## Mutants

`~/.cache/birka-runtime/helpers/mutate39.py`: 36 mutants, each undoing
one thing this batch made. `mutants39.sh` ran each against the journeys
that should catch it, on a fresh seed each, one failure ending the run.
- **The till's list kept:** any error taking the list's place; no plate
  over the tags read; a refused read again drawn as never read, the sale
  after it; the next page's retry reading the whole list; no plate for
  the next page; «Ще товари» back; an empty search's tag asking for a
  success; «Показати ще» free over an unread list.
- **One line of context:** S21 without its line, or its paragraph back,
  or the debt's store left out of it; the short phone's keys 60, the sum's
  field 72, «Винні» on its own line, the sum 56; the return form's «← До
  списку» at the title's right, its line gone, the other store left out;
  «Покупці»' line gone.
- **The rare screens:** the warehouse's chips never pressed, 52 high, the
  tap choosing the first; the catalogue's heading back, its sizes chips
  again, a count under the letter, «Завантажуємо розміри…» on the screen;
  «Не читали» never pressed, the label's chips 52, a size's chip sending
  «розмір невідомий», no plate for sizes not read, the row not named by
  its model; «Продажу немає» without its stub, its heading, its dock; its
  first sentence joined to the heading's words again; its hint of more
  than one line.
- **36 caught.** The first pass: 35 of 37. The two left:
  - the sum 56 on the short phone: its line height 34 kept the box where
    it was, the glyphs over it; the journey now reads money-l's 32 —
    caught;
  - a size's chip pressed without asking whether the line was read:
    equivalent — an unread line's size is «розмір невідомий», which the
    server never lists among the sizes (ADR-0005 §3); the guard was
    redundant and is gone, and so is the mutant.
- Logs: `go-mutants39-first.log`, `go-mutants39-second.log`.

## Evidence

- **Type check, ESLint, build:** `tsc --noEmit`, `eslint src e2e` clean;
  `npm run build` built. The e2e type check's errors are main's own (44).
- **The touched journeys,** on a fresh seed: 356 of 357 first; the one was
  the label's journey, its chip tapped while the basket's sheet still let
  taps go (the old list's `selectOption` never met it) — it waits for the
  sheet now: 68 of 68. After the review's fixes: 106 of 106.
- **Screenshots at 360** (`frontend/test-results/`, not kept):
  `debt-till-360x640.png` — «Винні» and the sum over the dock, on one
  baseline; `till-catalog-cells.png` — the warehouse's chips, the cell, the
  gap to «Назад до списку» (added after this look); `label-size-chips.png`,
  `nothing-sold-360.png`.
- **Every journey,** on a fresh seed, one worker: 1056 of 1057 in 28.0
  minutes (`b9-full.log`). The one: `backups.spec.ts:93` — 14 nights listed
  where it reads 3: the stand's database keeps every seed's nights (the
  seed is additive); nothing of this batch touches «Резервні копії».
- **Mutants:** 36 of 36 caught (above).

## Not covered

- A real phone; Telegram's own stable height at 640 (the journeys set the
  viewport to 360 × 640; the TZ asks for a screenshot inside Telegram,
  §10). The journey's screenshot: «Винні» and the sum over the dock, the
  keys 44.
- On S21 at 360 the header's one line wraps to two beside the disabled
  «Змінити магазин» (one element, two lines for a long name).
- «Продажу немає» is short, so its dock stands in the flow under the hint,
  as the receipt's does on a short one; not pinned to the screen's foot.
- The grey chips while a label's sizes are read have no journey (they show
  only between the coat's tap and the sizes' answer).
- P2-3's words wait for the owner: «На складі «…» його немає в обліку.»
  alone, «До списку», the visible «Не читали». P2-4 and P2-5 are later.

## For the owner

- Two things wait on you, as before: the line «{Ім’я} · винні всього
  {сума}» (sale P2-4) and the words of these rare screens — «На складі
  «…» його немає в обліку.» as the catalogue's only line, «До списку» for
  «Назад до списку», and «Не читали» as the chip's visible word.
- What changes for the eye: at the till, a list that could not be read
  again stays on the screen under a yellow line, and you can still sell
  from it; its next page that failed is retried alone; the button is
  «Показати ще» everywhere. A debt's payment, a return and «Покупці» say
  what they are about in the one line under the title; on a short phone
  the payment shows «Винні» and the sum over the keys. The catalogue's
  warehouse and a label's size are chips, the catalogue's sizes the till's
  cells, and «Продажу немає» a torn-off slip «Нестачу записано» with «Новий
  продаж» under the thumb.
