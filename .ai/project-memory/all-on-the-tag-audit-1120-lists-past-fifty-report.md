# «Усе на бірці», audit 2026-11-20, batch 2: lists past fifty — a return's and an invoice's own read finds them past their supplier's fifty newest; «Моделі» found past fifty; «Початкові залишки» past a hundred; «Клієнт забрав» and «Скасовані й повернені на склад» read on while none of theirs is read — 2026-11-21

Baseline: `c091e2c5` (main after #235).

Points: money Н1 and Н2, goods Н1 and Н2, orders-cash Н3 — the audit's
finds of a list read only in part. Taken as the next after «merged go
next».

No request, check, journal, right or word changes; no backend change.
What is recorded, and the server's checks of it, are as before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1226 (1219 before).
- Branch: `feat/audit-1120-lists-past-fifty`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-21 (audit
  2026-11-20, batch 2: …)".

## What exists now

- **A return's own screen finds it past its supplier's fifty newest**
  (money Н1):
  - Before: a return from «Брак» older than them, cancelled on its screen,
    stayed standing — the server answers that cancel with «Брак»'s unit.
    The buzz said done, the sheet closed, «Скасувати повернення» was
    offered again.
  - Now: «Скасовано», when, why and who, as the server says them.
- **An invoice read again after a refusal is found past its supplier's
  fifty newest** (money Н2): «Винні …», «Увесь залишок …» and the card's
  «Сплатити» are as the invoice is now.
- **«Моделі» found past fifty** (goods Н1, and «Об’єднати моделі»):
  «Показати ще» until the server has no more. Before, it was gone at fifty
  with more found.
- **«Початкові залишки» past a hundred** (goods Н2): «Показати ще» under
  the tags. A list «Сьогодні» opens that is not among the hundred newest
  opens all the same.
- **«Клієнт забрав» and «Скасовані й повернені на склад» read on**
  (orders-cash Н3):
  - Before: with none of theirs among the fifty newest closed, a heading
    and one «Показати ще», no words.
  - Now: the next page is read at once, the rows' places in grey; «Тут
    посилок немає.» once every page is read.

## How it was built and proven

Sources:
- `suppliers/findPaged.ts` (new): one return or invoice found among its
  supplier's page by page, fifty a page, to the server's furthest page.
- `suppliers/ReturnDetail.tsx`: the card's read is `findPaged`, keyed by
  the return; a cancelled answer of its own cancel stands over a read from
  before it.
- `suppliers/Invoices.tsx`: `readAgain` is `findPaged`; a read that comes
  after the invoice was shown anew is let go.
- `catalog/Models.tsx`: `ModelSearch` is an infinite query, twenty a page
  by `offset`; the next page's failure (`useNextPageFailed`) where
  «Показати ще» stood; the cursor to the first row brought.
- `openings/Openings.tsx`: the lists an infinite query, a hundred a page;
  «Показати ще», its failure, the cursor to the first «Відкрити» brought;
  a list to open not read yet is read on to (`seeking`).
- `orders/Orders.tsx`: `closedHere` — the closed rows the screen shows;
  `readingOn` reads the next page while none of them is read, or while a
  press's page brought none; `closedRows` / `closedMore` draw the places,
  the rows, «Тут посилок немає.» and «Показати ще».

Decided here:
- how far each reads on: every page, as «Зарахувати повернення»;
- the cursor after «Показати ще» on «Початкові залишки»: the first brought
  list's «Відкрити»;
- a list to open not among those read: read on to, its big tag's place
  meanwhile.

Journeys (+7):
- New:
  - `orders-list` ×3 — «Клієнт забрав» with none collected among the fifty
    newest (the next page asked at once, the grey places heard, no
    «Показати ще»); «Скасовані…» with none among them («Тут посилок
    немає.» once every page is read); «Показати ще» whose page brings none
    collected, after that page's retry too (the button held, the rows
    kept).
  - `models` — sixty-five found: «Показати ще» to the last, the cursor on
    the first brought, a refused page's retry where «Показати ще» stood.
  - `supplier-invoices` — a payment refused as another phone paid: the
    invoice found on its supplier's second page, «Увесь залишок 300,00
    грн», the card's «300,00 грн».
  - `today` ×2 — a list to approve on the lists' second page opens from
    «Сьогодні»; the lists' «Показати ще», its refused page's retry, the
    cursor on the first «Відкрити» brought.
- Extended: `suppliers` — the «Брак» return on its supplier's second
  page, cancelled on its screen: «Скасовано … · постачальник відмовив · …»,
  no «Скасувати повернення».
- Each list past its page is the server's, cut by a stub: the first page
  answered as fifty others (the real rows, their ids changed), the next
  page as the real first.

Runs on a fresh seed:
- The 24 specs the change reaches (`design-system`, `stocktake`,
  `borrowed`, `supplier-invoices` and `suppliers` first): 637 passed, 2
  failed.
  - `suppliers:1636` — the new assertion's space after «Скасовано», which
    the page has not (the review's High), fixed.
  - `orders-list:1336` — its extension tapped «Скасовані…» once every page
    was read and none cancelled, when the link is gone as decided
    (2026-11-01); the case is a journey of its own now, the link tapped
    while there is more to read.
- After the fixes, 17 specs on a fresh seed (the 15 the fixes reach, and
  `models`, `today`): 542/542. A name declared twice in the reworked
  `orders-list` journey first kept the file from loading; renamed. The app's
  `tsc` reads `src` only: the journeys, checked with the lint's config,
  have no error main has not.
- mutate79, 17 mutants, each against its journey: 17 caught.
  - money: one page only (the return, the invoice); the card without its
    read;
  - goods Н1: fifty at most, no `offset`, no cursor, no plate;
  - goods Н2: no read on to the list to open, no «Показати ще», no cursor,
    no plate;
  - orders-cash Н3: no read on («Клієнт забрав», «Скасовані…»), no places,
    a bare «Показати ще», no press kept, the press let go at its page's
    failure.
- CI runs all 1226.

## The review

An independent review read the diff against the five points. `tsc` and
ESLint are clean.

Checked and found right:
- each journey fails on the code before, by what is shown or by the pages
  asked;
- the sheet of «Скасувати повернення» closes only once the return is read
  again to its page;
- the new keys collide with none, and nothing sets or gets them; hooks come
  before every early return;
- no loop: every read on waits for the read before, stops at a failure
  and at the last page;
- the cursor, the dedupe and `except`; the tap guard, the search and the
  open places of «Замовлення» untouched.

Found and fixed:
- **High:** the «Брак» journey's assertion expected a space after
  «Скасовано»; it would fail with the fix or without.
- **Low:** a press's page that failed lost its reading on after its retry;
  it is kept for the retry now, and the journey covers it.
- **Low:** «Замовлення»'s pages stopped at an offset of 10 000, which
  `/orders` does not have; gone.
- **Low:** a return cancelled, its read again failing, was shown standing;
  the cancel's own answer stands now.
- **Low:** a read again after a refusal that came after a payment answered
  meanwhile put the older invoice back; it is let go.
- **Low:** the journey said «Показати ще» was held without checking; it
  checks.

Known, kept:
- **Medium:** a shop with many closed orders and none cancelled reads them
  all to say «Тут посилок немає.» on «Скасовані…», and again on each return
  to the app while that screen or «Клієнт забрав» stands. Bounded; the
  screen is a rare one. The server's own filter (Н3 (б), Backend) ends it.
- **Low:** a return's walk past its fifty newest is not stopped when its
  screen is left.
- **Low:** «Початкові залишки»: a list found past the first page may be
  read on to once more when the lists are read again whole.

## Left

- Audit 2026-11-20's P2s.
- Н3 (б): the server's filter of the collected and the cancelled (Backend).
- The owner pack's answers.
- Dependabot pull request #223 is redundant after #233. It is closed only on
  the user's word.
