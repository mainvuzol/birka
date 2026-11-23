# «Усе на бірці», audit 2026-11-22, batch 3: «Звідки, що й коли» and «Сервер відповідає — видно» — the set-off's return from «Брак» said as «Постачальникам» says it; an invoice's history newest first; «Зарахувати повернення» only with the right to read the returns; the sign-in with the server silent on the paper's banner; a read asked by a press keeps the press's look — 2026-11-22

Baseline: `8872de1f` (main after #242).

Points: money P2-1, P2-3, P2-4; frame P2-1, P2-2.

Taken as the next after «merged go next»: the money pass's quick wins
(«Звідки, що й коли») and the frame pass's one batch («Сервер відповідає —
видно»), as both passes ordered them. Not in it: money P2-2 and
orders-cash P2-2 (one look of a link with a sign, waiting for a screenshot
of before), money P2-5 (waits for Д4, the server's read, and В22-Г1),
goods P2-3 (б) (В22-Т1 / Н2).

No right, check, journal or step changes; nothing recorded or sent
changes; no backend change.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1255 (five new — the pressed look's in both themes — and
  eight extended).
- Branch: `feat/audit-1122-money-frame`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-22 (audit
  2026-11-22, batch 3: …)".

## What exists now

- **The set-off's return says where it came back from** (money P2-1):
  «14.10 · 1 шт. · з «Браку» «Брак ринку»» for a unit from «Брак», as
  «Постачальникам», its card and its result say it; «склад «…»» for a
  warehouse's, as before.
- **An invoice's history is the newest first** (money P2-3): the last
  payment at the top, a cancelled one where it was recorded. The server's
  order is unchanged; the phone reverses a copy.
- **«Зарахувати повернення» only with the right to read the returns**
  (money P2-4): with `supplier:debt` and not `supplier:return` (a role set
  up so), no way behind ⋯, no read, no «Немає доступу»; «Скасувати
  накладну» stays.
- **The sign-in with the server silent** (frame P2-1): «Сервер не
  відповідає. Продавайте на папері: …» on the paper's banner, read as a
  status, where the red refusal stood. Every other failure: the red
  plate, as before.
- **A read asked by a press keeps the press's look** (frame P2-2):
  - «Показати ще» (twenty lists): one `ListMore`; pressed while its own
    page is read — its edge and words kept, the eyelet's ring turning
    before them, no second tap. Held for any other reason: dashed, as
    before.
  - A plate's «Спробувати ще раз» (`Unread`, 106 places): pressed while
    its read is asked again. Held for another press on its way: `blocked`,
    no ring.
  - «Спробувати ще раз» before a store (the sign-in, «Магазинів поки
    немає», «Доступу ще немає», a store that does not trade): a pressed
    text button in the link's colour with the ring, until answered; a
    second tap no longer starts the read again.
  - Where motion is reduced, the ring stands, dashed.

## How it was built and proven

Sources:
- `frontend/src/suppliers/InvoiceActions.tsx`: the set-off's first line by
  `unitsOf` and `placeText`; `setsOff` asks `supplier:return`; the two
  retries' `held` and `blocked`.
- `frontend/src/suppliers/Invoices.tsx`: the history reversed.
- `frontend/src/shared/ListMore.tsx` (new), in twenty places:
  `cash/History`, `catalog/Catalog`, `catalog/FamilySearch`,
  `catalog/Models`, `credits/Credits`, `inventory/CatalogPicker`,
  `inventory/Stock`, `inventory/Stocktake` (2), `openings/Openings` (2),
  `orders/Orders`, `reports/ReportEntries`, `returns/Returns`,
  `sales/StockSearch`, `suppliers/Borrowed`, `suppliers/InvoiceActions`,
  `suppliers/Invoices`, `suppliers/NewReturn`, `suppliers/Suppliers`.
- `frontend/src/shared/Unread.tsx`: pressed and the ring while `held`;
  `blocked`. `catalog/FamilySearch.tsx` passes its own `blocked`.
- `frontend/src/App.tsx`: `paper` and `DoorPaper`, the sign-in's status
  born empty and filled after the screen shows; `rereading` and one
  `tryAgain` for the retries before a store; the failure shown kept while
  its own read is asked again (`lastFailure`), forgotten once answered;
  `NoAccess` pressed while `asking`.
- `frontend/src/styles.css`: the sign-in's banner's place, never the
  crash screen's; a pressed text button keeps the link's colour.

Decided here: see the business rules' entry — the sign-in's status
standing with the screen, born empty; the banner's place; the failure kept
while read again; `blocked` apart from `held`; the fourth retry before a
store.

The audit's checks:
- Д2 (money): nothing reads an invoice's lines' order.
- Д1 (frame): found otherwise by the review — a read that never answered
  loses its failure while read again, and the sign-in gave way to the
  opening's places; the failure is kept now, proven by the sign-in's
  journey (its banner said while held) and by «Магазинів поки немає»'s
  (an earlier failure, answered, not kept for a later read).
- Д2 (frame): the ring by `isFetchingNextPage`, never by a whole list's
  read.
- Д3 (frame): where a plate's retry is held while the list is read again,
  the ring turns; where it was held for another press, `blocked`. The ring
  is seen where the plate stays while read again — over rows read; a plate
  for what was never read gives way to the places, as before.

Journeys:
- New:
  - `supplier-invoices`: a unit given back from «Брак» at «Ринок» — a real
    damaged refund, taken, confirmed and returned through the API — and a
    warehouse's return: «з «Браку» «…»» and «склад «…»», wrapped at 360 ×
    640, the chosen's colours in both themes;
  - `supplier-invoices`: a history of three payments, the middle cancelled
    — newest first, the cancelled in its place, the newest cancelled from
    the top;
  - `supplier-invoices`: without `supplier:return` (`/me` stubbed) no
    «Зарахувати повернення», no read of the returns, «Скасувати накладну»
    there; with it, the way;
  - `design-system`: a pressed «Показати ще», plate's retry and text
    button in both themes — their edge and fill kept, the words' colour,
    4.5:1, the ring inside before the words, nothing moved; reduced
    motion — the ring stands, dashed.
- Extended:
  - `supplier-invoices`'s «paid in parts until it is settled»: three
    payments newest first;
  - `outage`'s sign-in at 503, 502, 504 and no answer: the paper's banner
    in a status, no alert, the words once; one retry held — pressed, the
    ring, one request after a second tap, the words still said; both
    themes at 360;
  - `outage`'s sign-in also proves its status born empty (a
    `MutationObserver` reads its children as it first stands);
  - `stores`'s «Магазинів поки немає»: entered after a sign-in that failed
    and was answered; its retry held — pressed, the ring, the screen and
    no paper's banner meanwhile, one request;
  - `first-sign-in`'s «Доступу ще немає»: the retry held — pressed, the
    ring, one request;
  - `session`'s blocked store read again: its retry held — pressed, the
    ring (the fourth door); unanswered, the paper's banner, no alert;
  - `orders-list`'s «Показати ще»: its page held — pressed, the ring, one
    request after a second tap; a failed page's plate retry held —
    pressed, the ring;
  - `failures`' sign-in walking a refusal, the silent server and a refusal
    again: the paper's banner in the status in between, no alert; the
    red plate back after it;
  - `fixtures`: `expectPressed`.

Runs on a fresh seed:
- The 25 specs the batch touches or reads (`design-system` first,
  `supplier-invoices` before `suppliers`, `suppliers-pages`, `borrowed`,
  `stocktake`, `cash-history`, `catalog`, `credits-list`, `credits`,
  `goods-places`, `models`, `openings`, `orders-list`, `returns-list`,
  `sales-report`, `stock`, `till-search`, `today`, `first-sign-in`,
  `outage`, `session`, `stores`, `people`, `orders`): 615/620. The five:
  the two the review found (the sign-in's retry and the till's never-read
  plate gave way to the places); the pressed look's width check in both
  themes, too strict for a button at its words' width, which takes the
  ring's room; and `session`'s blocked store read again, which pinned the
  silent server's red at the door — the change itself.
- After the review's fixes, `design-system`, `first-sign-in`, `outage`,
  `session`, `stores`, `people`, `orders-list`, `failures`: 261/262 — the
  one `failures`' sign-in pinning the same red; then `failures` 19/19.
- CI runs all 1255.

Mutants (mutate86, 20, each against its journey): 20/20 caught. One was
aimed again: its first form, a faded pressed button, was overridden by
the same rule's own `opacity: 1`.
- The set-off's «склад «…»» for «Брак»'s.
- The history oldest first (two journeys).
- The set-off's way without the right.
- The sign-in red when silent; the paper's banner for every failure.
- The door's failure lost while read again; an answered failure kept for a
  later read; the status born with its words.
- The door's retry tapped twice, without its ring, not pressed;
  «Доступу ще немає»'s not pressed.
- «Показати ще» without its ring, not pressed, tapped twice.
- The plate's retry without its ring, not pressed.
- A pressed text button in pencil; a pressed button faded.

## The review

An independent review read the diff against the two passes' task lists
and the decisions' draft, ran `tsc` and `eslint`, and checked TanStack
Query's refetch in the installed `query-core`. One High, two Mediums.
- **High, fixed:** the sign-in's retry cleared its failure while it read
  (a read that never answered loses its error on refetch), so the screen
  gave way to the opening's places — the ring never seen, the status
  remounted. The failure shown is kept while its own read is asked again,
  and forgotten once answered (a journey proves it is not kept for a later
  read). The docs' «Д1 checked» was wrong; corrected.
- **Medium, fixed:** the till's never-read plate gives way to the places
  while read again, so its pressed retry is never seen; the plate's
  journey is now a failed page's on the orders list, and the rule's line
  says where the ring shows.
- **Medium, fixed:** the sign-in's banner margin also took the crash
  screen's; scoped to `:not(.crashed)`.
- **Low, fixed:** the status was born with its words; it is filled just
  after the screen shows, and a journey proves it born empty.
- **Low, fixed:** two checks counted requests at once after a click; they
  poll, and the sign-in's loop waits for each answer.
- **Low, known:** a keyboard press disables the focused retry, and the
  focus may fall to the page; as «Показати ще» did before.
- **Nit, fixed:** a long line in `StockSearch.tsx` wrapped; the banner's
  spacing said as it is.
- **Checked fine:** every one of the twenty `ListMore` keeps its old
  `disabled` and reads its own query's next page; `held` means only «this
  read asked again» in all 102 `Unread`s but the two given `blocked`;
  nothing sent or recorded changes, the history's copy is reversed, never
  the cache; the CSS's specificity.

## Left

- money P2-2 with orders-cash P2-2: one look of a link with a sign, after
  a screenshot of before.
- money P2-5: Д4 (the server's read, which needs the user's consent) and
  В22-Г1; finding Н1 waits for В22-Г1.
- goods P2-3 (б) waits for В22-Т1 or a count (Н2), and a server field.
- What a reader hears of the sign-in's status on a phone, and Telegram's
  greyed MainButton (frame Д4), need a phone.
- Dependabot pull request #223 is closed only on the user's word.
