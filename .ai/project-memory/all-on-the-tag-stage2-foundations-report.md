# «Усе на бірці», stage 2's first batch: the suppliers' pages, the plates said at once, every journal's kept stub — 2026-11-05

Baseline: `3314669` (#168, on main), and two of stage 2's task lists:
money ([P0-7](redesign/2026-11-05-redesign-tz-stage2-money.md)) and
orders-paper ([P0-2, P0-1](redesign/2026-11-05-redesign-tz-stage2-orders-paper.md)),
their decisions and acceptance.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-foundations`. Task: the defect and the two shared
looks the stage-2 audit put first (chosen in chat, 2026-11-05, «Yes,
start that»). The eight task lists of the audit go with it.
Chosen: business-rules.md, "Chosen in chat — 2026-11-05 (stage 2: the
suppliers' pages, the plates said at once, every journal's kept stub;
money P0-7, orders-paper P0-2, P0-1)". The owner's questions stand by
their (а): В-ЗП2 (а).

Three things every later stage-2 screen leans on. A supplier's list broke
at its third «Показати ще»: the server takes fifty rows at most, and the
list asked for sixty. A refusal was drawn in the customer's debt colour,
so «відмовлено» and «винен» looked alike. And only the sale had a kept
operation's stub: a delivery, a correction, a count, an order's step or
«Каса»'s command waiting for the server each said so in their own way.

## What exists now

- **The suppliers' lists page by page (money P0-7):** «Показати ще» on
  «Накладні», on the returns to suppliers and on «Позичене й під
  реалізацію» reads the next twenty by offset, as «Закриття» does. Each
  row once, by its id. A page that fails says why under the rows already
  read, which stay, and «Показати ще» tries it again. A changed filter
  starts from the first page; a filter come back to shows what was read
  under it while it is read again.
- **The plates said at once (orders-paper P0-2):**
  - every refusal or typing mistake (`role="alert"`) is drawn in the
    error's colours with the crossed circle, never in the debt's colours,
    which are for customers' debts alone;
  - what could not be read is a warning's plate with the triangle: the
    till's stock, its sizes from the catalogue, «Каса»'s drawer and a
    close, a return's sale, the paper mark's sellers;
  - the glyph stands beside the first line of the words;
  - the sticker «failed» uses the error's colours and its circle;
  - kept operations the phone cannot read, from any number of journals,
    are one plate, each journal's sentence a line in it;
  - a store that does not trade is the «blocked» banner, read as a
    status, never a refusal.
- **Every journal's kept operation is the sale's stub (orders-paper P0-1):**
  a delivery, a stock correction, a stocktake's count, an order's step and
  «Каса»'s command.
  - On its own screen: the stub with «Ще не підтверджено», the title (by
    В-ЗП2 (а): «Приймання / Коригування / Підрахунок ще не підтверджено»,
    «Операцію «…» ще не підтверджено», «… ще не підтверджено» for
    «Каса»), the check «Перевірити …» and «Перевіряємо кожні 20 с».
  - Anywhere else, the kept banner over the screen, with the same check.
  - While it is checked, the title stays the same and the check shows its
    ring.
  - Confirmed: on its own screen the stub is torn off, with «Приймання /
    Коригування / Підрахунок записано один раз» and what changed («Облік
    3 → 2.», «Збігається з обліком (3).»). Elsewhere it is the recorded
    banner with «Зрозуміло».
  - An order's step that the server answered, but whose order could not
    be read, is recorded too: «Операцію «…» записано» and «Оновити
    результат».
  - Felt: a warning buzz as it is first kept; a success buzz as it is
    confirmed. A close with a difference, confirmed later, is felt as a
    warning, the same as one answered at once.
  - Telegram asks before Бірка closes while any of them is kept. It does
    not ask during a first send, which is on the phone already, nor for a
    step that was answered.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the plates are drawn by the base style and `.notice`, not by new kinds
  of `Banner` (those are a status's role; these are said at once);
- the settled words are split into a title and its line, as the sale's
  stub says them;
- a delivery's first send shows its press's own ring, so its stub stands
  only once its answer is lost. A correction's and a count's stub stands
  from the press, as built; the correction's sheet stays over it until the
  answer;
- a close confirmed later is felt as one answered at once, which replaces
  «none for one kept and confirmed later» (the close's rule of
  2026-10-21), as the TZ's «success при подтверждении» asks.

## How it was built and proven

- **Files:**
  - `frontend/src/suppliers/Invoices.tsx`, `Suppliers.tsx`, `Borrowed.tsx`:
    `useInfiniteQuery` by offset, rows deduped by id, a failed page under
    the rows;
  - `frontend/src/styles.css`: the alert's ground, words and glyph; the
    warning's `.notice`; «failed»;
  - `frontend/src/App.tsx`: one plate for every unread journal; the blocked
    banner; the delivery's, correction's, count's and order step's stubs
    and settled stubs; the buzzes; Telegram's question;
  - `frontend/src/cash/Kept.tsx`, `Cash.tsx`: «Каса»'s command as the
    stub, its buzz once confirmed;
  - `frontend/src/sales/Sale.tsx`, `FromCatalog.tsx`, `paperMark.tsx`,
    `frontend/src/returns/Returns.tsx`, `frontend/src/cash/Closed.tsx`: what
    could not be read, a warning's plate.
- **Journeys:** 897 in all (888 after #168).
  - **`suppliers-pages.spec.ts`** (3 new): «Накладні», the returns to
    suppliers and the lots, each to the sixty-first row, twenty a page,
    each row once, a failed page keeping what was read, and read again.
  - **`outage.spec.ts`** (5 new): three journals the phone cannot read on
    one plate, in both themes, at 360 px; a kept delivery, stock
    correction and stocktake's count each as its stub, the banner over
    «Ще», the title the same while checked, then torn off once, felt once,
    Telegram no longer asking, the same command sent; an order's step kept,
    then refused.
  - **`cash-close.spec.ts`** (1 new): a close kept and confirmed later is
    felt once, a success with no difference, a warning with one.
  - **`fixtures.ts`:** `expectPlate`, which checks a refusal's or a
    warning's plate: its ground, words and glyph, never the debt's
    colours, the theme's own red, the glyph beside the first line, words
    at 4.5:1 and the glyph at 3:1.
  - The journeys of the plates (`failures`, `orders-new`, `orders-list`,
    `returns-list`, the till's and «Каса»'s unread) and of the kept
    operations (`receive`, `correct`, `stocktake`, `cash-kept`, `models`)
    check the new looks and words. `stores.spec.ts` checks the blocked
    banner. `cash-kept.spec.ts` and `correct.spec.ts` now run inside
    Telegram: asked before closing while kept, not during a first send,
    and one success buzz. The correction's sheet is checked to stay over
    its first send.

## The independent review

An agent read the change cold (2026-11-05). It found the paging, the
colours and the stubs as the task lists ask. What else it found, and what
was done:
- **Fixed:**
  - five journals' unread plates (a delivery, a return, a payment, a
    correction, a count) still stood apart: they are lines of the one
    plate now;
  - a first paragraph's margin pushed the words below the glyph: the
    plate's first and last child have none;
  - the till's catalogue sizes, «Каса»'s close and the paper mark's
    sellers that could not be read still looked like refusals: warnings
    now;
  - the blocked store's banner had no role: a status;
  - a close with a difference confirmed later buzzed success: a warning,
    as when answered at once;
  - Telegram's question flickered on a correction's, a count's and
    «Каса»'s first send: not asked until kept;
  - a filter come back to: the rule's words said every page was kept. They
    now say what was read is shown while it is read again, as «Закриття»
    does;
  - the journeys: the dark theme's checks now prove the theme switched,
    and the check line is found by its words, not its first span. One
    success buzz, not «at least one». A delivery's first send is checked
    to show no stub.
- **Recorded, left as built:** a kept sale, return or payment confirmed
  later buzzes nothing, and a kept return or payment does not ask before
  closing (not in these task lists).

## Mutants

47 changes to the source, each applied alone and run against the
journeys that should catch it (`~/.cache/birka-runtime/helpers/mutate17.py`,
`mutants17.sh`):
- the paging: next offset, each row once, rows kept on a failed page, for
  each of the three lists;
- the plates: the debt's ground and words, the circle, the triangle, the
  warning's ground, the till's, the return's and the unread plates, the
  glyph beside the words, the blocked banner and its role;
- the stubs: each journal's own screen, title, settled words, buzz and
  Telegram's question; the delivery's first send; an order's step
  answered and recorded; «Каса»'s title, buzz and a close's felt
  difference, kept and at once; the first send not asked.

All 47 are caught. Two needed more:
- the glyph taken away (`content: none`) passed `expectPlate`, which read
  the `::before` styles that Chrome reports even for a glyph it does not
  draw. `expectPlate` now requires the glyph to be drawn;
- a direct close's warning buzz was first run against a journey that
  never reads buzzes. It is now run against the one that does («a close
  short or over, by any sum, is felt as a warning»).

Five would have passed the journeys as they stood before the review: the
blocked banner's role, the five plates joined, the glyph beside the
words, a close confirmed later felt as a warning, and Telegram not asked
during a first send.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-05, after the
  review's fixes): 896 of 897 pass in 18.5 minutes. `backups.spec.ts:78`
  fails only on this Mac, as on every batch before; CI runs it.
- The review's journeys on the database the full run had used: 301 of
  307. The six that failed are the correction's «counted from zero»,
  stocktake 112, 313, 362 and 455 (counted or started by the full run
  before them), and the correction kept unknown, whose order is fixed
  above. On a fresh seed `correct.spec.ts` and `stocktake.spec.ts` pass,
  13 of 13.
- Before the review's fixes, every journey on a fresh seed (2026-11-05):
  894 of 896 pass in 18.5 minutes. `backups.spec.ts:78` fails only on this
  Mac, as on every batch before; `cash-close.spec.ts:1395` still asserted
  the close's earlier «no buzz», which this batch replaces.
- `tsc -b`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).

## For the owner

Nothing new to ask: the titles and «… записано один раз» are В-ЗП2 (а).
One earlier rule changes by the TZ: a close kept and confirmed later now
buzzes, where it used to buzz nothing. What was decided here is in
business-rules.md under the heading above.

## Not covered

- A real phone: Telegram's buzz and question are checked through its
  events only.
- The till's catalogue sizes, «Каса»'s close and the paper mark's sellers
  that could not be read: no journey reaches them. They take the same
  class as the till's and the return's warning plates, which journeys
  check.
- The rest of the four stage-2 task lists waits for the next pick.
