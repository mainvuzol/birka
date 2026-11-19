# «Зарахувати повернення» reads past the fifty newest returns — 2026-11-19

Baseline: `00762170` (main after #231).

The one find of audit 2026-11-18 outside the redesign (money TZ,
«Находки вне редизайна»), taken as the next after «merged go next». The
owner's reading had sent it to development as a fix of its own. Also: the
choose place's corner in «Перевірка каталогу», a find of batch 7's review.

Nothing recorded, sent or counted changes. No request, check, journal,
right or word changes. What a set-off records, and the server's checks of
it, are as before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1212 (1211 before).
- Branch: `feat/set-off-pages`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-19 (audit
  2026-11-18, the set-off's find: …)".

## What was wrong

«Зарахувати повернення» on an invoice's card read this store's returns to
the invoice's supplier once: the fifty newest (`limit=50`, the most the
server gives), with no next page, then left out the cancelled. So:
- a return older than the fifty newest, still standing, could not be set
  off, and nothing on the screen said so;
- the fifty newest all cancelled, the sheet said «Цей магазин нічого не
  повертав постачальнику …» over returns it had never read.

## What exists now

- The returns are read page by page, fifty a page, newest first, each page
  after those read, as «Постачальникам» reads its list.
- «Показати ще» under the returns brings the older ones. The cursor goes to
  the first return it brings, as in the catalogue's search sheet.
- A page that fails: its «Спробувати ще раз» alone where «Показати ще»
  stood; the returns read stay. A return read twice, as a page's edge
  moves, is shown once.
- Decided here:
  - None standing among those read and more to read: the next page is read
    at once, the returns' places in grey meanwhile. «нічого не повертав» is
    said only once every page is read.
  - A page «Показати ще» brought with none standing is read past too, the
    list as it is, until one standing comes or the pages end. At the end
    the cursor goes to the last return, kept in the sheet (review).
  - None chosen, Tab's stop is the return the cursor is on (review).
  - Pressing «Зарахувати» ends a page's claim on the cursor; a page's retry
    is held as «Показати ще» is (review).
- «Перевірка каталогу» read slowly: the place of each offered model's
  «Обрати» has the button's corner, 8, never the grey's own (it was 10:
  `.skeleton` is drawn later).

Known, not changed:
- Past the server's furthest page (10 000 returns to one supplier, every
  one cancelled), «нічого не повертав» is said with older ones unread.
- A whole reading again that fails puts its plate in the list's place, as
  before.
- A return's own screen reads its supplier's fifty newest to show a
  set-off cancelled meanwhile, and keeps the row's or its cancel's answer
  past them (`ReturnDetail.tsx`), as before.

## How it was built and proven

Sources:
- `suppliers/InvoiceActions.tsx`, `SetOff`: `useInfiniteQuery` (fifty a
  page, offset up to 10 000), de-duplicated by id; `useNextPageFailed`;
  the reading on; «Показати ще» and the cursor; Tab's stop.
- `styles.css`: `.new-model-candidates .skeleton-choose`.

Journeys (+1):
- `supplier-invoices.spec`, new — a real supplier, invoice and return of
  two units; the set-off's read served as the server pages it, with a
  hundred and fifty returns listed over the real one: the first page all
  cancelled, the second all but one, the third all cancelled, the real one
  the fourth's.
  - Opened: the second page read at once, three grey places meanwhile,
    never «нічого не повертав».
  - That page fails once: its retry alone, still no «нічого».
  - Then one return and «Показати ще». The next page fails once: its retry
    where «Показати ще» stood.
  - Retried: that page has none standing and is read past by itself. The
    real return comes, the cursor and Tab's stop on it.
  - Chosen and set off for 1 200,00: the server records it against the
    real return. Every page asked fifty, at offsets 0, 50, 100 and 150.
- `goods-places.spec`: the choose place's corner 8.

Runs on a fresh seed:
- Touched specs (`supplier-invoices`, `goods-places`, `suppliers-pages`,
  `design-system`): 75/75.
- mutate77: 12/12 caught (11 on the first run; `retryrefetch`, the page's
  retry reading every page again, survived until the journey asserted each
  retry asks its own page alone, as «Постачальникам»'s does).
- After the review's fixes, on a fresh seed: `supplier-invoices`, `suppliers-pages`,
  `goods-places` 42/42.

Not proven by a journey (small, by reading): the cursor on the last return
when the pages end with none new; «Зарахувати» ending a page's claim on the
cursor; a retry held while the set-off is sent.

## The review

An independent review read the diff: no High, nothing in financial
integrity — only an id tapped among those standing is sent, and `submit`
checks it again; a return cancelled meanwhile drops out, the server's order
(`created_at desc, id`) only moves older ones down. The reading on cannot
loop or fire twice: it waits for `isFetching`, stops at `has_more`, the
furthest offset or a failed page.

Fixed:
- M1: a page «Показати ще» brought with none standing answered the press
  with nothing, the cursor lost to the page, and the cursor's claim kept for
  a later reading again to take — now read past, and the cursor goes to the
  last return when the pages end.
- L1: pressing «Зарахувати» ends that claim (a refusal's reading again
  cancels a page still read; «Показати ще» stays for it).
- L2: a page's retry held as «Показати ще» is.
- L3: none chosen, Tab's stop is the return the cursor is on.
- The journey: a date's year in the first days of January allowed; a failed
  page while none stands, and a page with none standing, covered.

Left: L4 (past 10 000 returns, all cancelled) and L5 (a whole reading again
that fails replaces the list) — as before, named above.
