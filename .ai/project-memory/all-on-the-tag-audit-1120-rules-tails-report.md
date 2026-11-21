# «Усе на бірці», audit 2026-11-20, batch 3: the rules' tails — «Показати ще» one strip under every list, «Ще товари» gone; a field said wrong a line under it in its last six places, and where it stands; a kept operation's stub names its day — 2026-11-21

Baseline: `bf86d5d4` (main after #236).

Points:
- frame P2-1, P2-2, P2-3 — the frame task list's own second batch,
  «Хвосты правил» (its §8);
- orders-cash P2-1 and money P2-1, which point to frame P2-1;
- goods P2-1, which completes frame P2-2.

Taken as the next after «merged go next».

No request, check, journal or right changes; no backend change. What is
recorded, and the server's checks of it, are as before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1231 (1226 before).
- Branch: `feat/audit-1120-batch3`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-21 (audit
  2026-11-20, batch 3: …)".

## What exists now

- **«Показати ще» one strip under every list** (frame P2-1; orders-cash
  P2-1, money P2-1):
  - Before: under seventeen lists a quiet button at its words' width, by
    the left edge — the till's, «Покупці», «Замовлення», the suppliers',
    the catalogue's and the goods' — and «Ще товари» in the catalogue's
    search and «Повернути постачальнику».
  - Now: the list's whole width (in a sheet, the sheet's), 44 high, the
    edge, ink on nothing, as under «Сьогодні»; «Показати ще» everywhere.
- **A field said wrong is a line under it** (frame P2-2; goods P2-1):
  - Before: a length the server would not take, a line longer than 500
    and too many lines were a refusal's red plate, as if the server had
    said no; in «Перейменувати модель» the length's was under «Тип
    виробу»; folded under «Ще ознаки», the way on held with no word why.
  - Now: a red line under the field, the field's edge red and read with
    it; folded, the length's line under «Ще ознаки». «Той самий товар і
    розмір двічі» under the parts it is about, no longer under the note.
- **A kept operation's stub names its day** (frame P2-3):
  - Before: «Чекає відповіді сервера з 14:20.» the morning after, as if
    today.
  - Now: «з учора о 14:20.», «з 18.11 о 14:20.»; of today, as before.

## How it was built and proven

Sources:
- The seventeen places: their class `list-more`, two words «Показати ще»;
  `styles.css`: `.stocktake-more` gone, a count's «Знайти товар» 12 under
  the strip.
- `catalog/modelTypes.ts`: `lengthWrong`, the length's words, once.
- `catalog/NewModel.tsx`, `catalog/Models.tsx`: the length's line
  `.field-wrong` under «Довжина, см», the field `aria-invalid` and
  `aria-describedby`; folded, the line under «Ще ознаки».
- `shared/Fold.tsx`: `describedBy`, what a fold is read with while folded.
- `openings/types.ts`: `tooLongText`; `saidWrong(...ids)`, a field's
  `aria-invalid` and `aria-describedby` from the lines that stand.
- `openings/Openings.tsx`, `openings/Parts.tsx`: the two fields' lines.
- `openings/Line.tsx`: the duplicate's line under the parts.
- `shared/when.ts` (new): `whenText` from «Сьогодні», and `isToday`.
- `shared/reach.ts`: `waitsSince` — of today the time, else `whenText`.

Decided here:
- the duplicate's line under the parts (goods P2-1 (б)) over the frame's
  §12 that kept it a plate;
- the length's line under the fold has no alert of its own, and the fold
  is read with it (the goods pass's Д2).

Journeys (+5):
- New:
  - `catalog` ×2 — «Пропозиції» past their first page: «Показати ще»'s
    look, pressed, the next page asked; «Довжина, см» said wrong in «Нова
    модель»: its line, folded and unfolded, the way on held.
  - `suppliers` — «Повернути постачальнику»'s models past their first
    page: «Показати ще»'s look, never «Ще товари».
  - `models` — «Довжина, см» said wrong in «Перейменувати модель»: under
    its field and above «Категорія», folded under «Ще ознаки», «Зберегти
    назву» held.
  - `outage` — a sale kept since yesterday, a week back, earlier today:
    «з учора о 14:20», its date, its time alone (the phone's clock at
    09:05).
- Extended:
  - «Показати ще»'s look (the list's width, from its side, 44, the edge,
    ink on nothing) where each journey already pressed it: `till-search`,
    `goods-places` (its word too), `cash-history`, `credits-list`,
    `returns-list`, `orders-list`, `suppliers-pages` ×3,
    `supplier-invoices`, `models`, `catalog`, `stock`, `stocktake`,
    `today`;
  - `openings` ×3 — the new list's and «Додати рядки вручну»'s lines under
    their field, both at once; the duplicate under the parts;
  - `cash-kept` — its kept drawer seeded five or forty minutes back says
    «учора о» after the phone's midnight.

Runs on a fresh seed:
- The 36 specs the change reaches (`design-system`, `stocktake`,
  `borrowed`, `supplier-invoices` and `suppliers` first): 853 passed, 1
  failed — `backups:93`, the stand's own: the additive seed's fourteen
  nights where the journey counts three, as known.
- After the review's fixes, the 24 specs they reach (the look checks'
  and the field lines' every caller, the stub's journeys): 655/655.
- CI runs all 1231.

- mutate80, 32 mutants, each against its journey: 32 caught.
  - frame P2-1: each of the seventeen places a quiet button again; «Ще
    товари» back in the catalogue's search and «Повернути постачальнику»;
  - frame P2-2, goods P2-1: each of the six lines the plate again; the
    length's field not marked wrong; no line under the folded «Ще ознаки»
    (both forms); the fold not read with it; the lists' fields not marked
    wrong; the duplicate the plate again;
  - frame P2-3: the stub's time alone on any day; its day said of today
    too.

## The review

An independent review read the diff against the six tasks. `tsc` and
ESLint are clean; the journeys have no type error main has not.

Checked and found right:
- every next page in `src` is the strip; no «Ще товари» left, no
  `stocktake-more`; no rule reached these buttons as `.quiet`;
- a count's «Знайшли товар…» 12 under the strip; the held look dashed, as
  before; no form round the four buttons given `type="button"`;
- the six lines' ids match what draws them; no `aria-describedby` to an id
  not drawn; hooks before every early return;
- every stub goes through one `waitsSince`; «Сьогодні»'s `whenText` as
  before;
- each journey fails on the code before, but «Моделі»'s look (below); the
  new outage journey's clock fixed, node's and the browser's time zone
  one; no locator matches two.

Found and fixed:
- **Medium:** the length's line under a folded «Ще ознаки» had neither
  its crossed circle nor its indent (they came with `role="alert"`); the
  same look now, checked.
- **Medium:** «Моделі»'s look check passed on the quiet button its column
  stretched; the check asks for the strip itself everywhere.
- **Low:** older journeys that keep an operation and read «з 14:20» could
  meet midnight; they take «з учора о …» too.
- **Low:** «Сьогодні»'s moment not read says «—» again.
- **Low:** the rules' and the stylesheet's lists of places named the
  till's «Внесок», «Об’єднати моделі» and «Початкові залишки»' own lists,
  and the count's finder by its words.

Known, kept:
- **Low:** the strip's 8 is its own margin, added to a list's or a
  column's: 16 to 26 in four places, as the strips built before.
- **Low:** «Перейменувати модель» reads its length's line out again as
  «Ще ознаки» unfolds, as «Нова модель» always did.
- **Low:** a stub drawn before midnight says «з 23:50» until it is drawn
  again.
- **Low:** under the length's line 20 in «Нова модель», 12 in
  «Перейменувати модель».

## Left

- Audit 2026-11-20's other P2s: sale P2-1, orders-cash P2-2 and P2-3,
  money P2-2 to P2-4, goods P2-2 to P2-4; goods P2-5 waits for В20-Т1.
- Н3 (б): the server's filter of the collected and the cancelled (Backend).
- The owner pack's answers.
- Dependabot pull request #223 is redundant after #233. It is closed only on
  the user's word.
