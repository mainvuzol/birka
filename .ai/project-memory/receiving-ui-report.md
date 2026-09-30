# The back door — goods can now be received from the app (M1-025) — 2026-09-30

Baseline: `9feb2c6` (receipt command identity, PR #36).
Status: implemented and verified locally. Branch `feat/m1-025-receiving`.

## Why this was next

The app could sell but not take delivery. Stock entered only through the
legacy import or a seed, so a shop using it for a week would watch every
balance fall and have no way to put goods back. The receipt API has existed
since M1B; what was missing was a screen — and, it turned out, two reads that
screen needs. The command itself was made safe to build on in PR #36
(ADR-0006): before that, a receiving journal like the till's would have
received a delivery twice when replayed after a week away.

## What was missing underneath

**The till's product search could never find a delivery.** The till searches
`stock-options`, which lists positive balances — right for selling, because
you can only sell what a warehouse holds. A delivery is usually of exactly what
the shop has run out of, or of a model nothing has been sold of yet. None of
those appear there.

**Nothing listed variants independently of stock**, and nothing could: a
variant does not declare the sizes it comes in. Sizes belong to the
organization's size systems, and a `(variant, size)` pair becomes real only
when stock or a movement names it.

Two reads, both gated by `inventory:receive`, which the default seller holds:

- `GET /catalog/receivable-variants` — the catalogue, not the shelf. Every
  word of the query must match the model, the source or the colour, so
  «лоран шоколад» finds the chocolate Лоран and not every Лоран. Wildcards a
  person types are literal, as in family search. Organization-scoped at every
  join.
- `GET /catalog/sizes` — the organization's sizes in the order a seller reads
  them. Nothing sets `sort_order`, so without an order the list read
  `L, M, S, XL, XS`; alpha sizes now follow XS…XXL, numeric codes sort as
  numbers, verbatim sizes like «46-48» follow, and a `sort_order` an owner sets
  one day still wins. **"Size not known" is never offered**: goods arrive with
  a size, and that one enters only from a legacy list (ADR-0005 §3).

**Which catalogue states are offered.** Only a *merged* identity is excluded.
A variant, family or concept parked in `NEEDS_REVIEW` is still offered — the
rule product intake already follows ("a family parked there is the one most
likely to be this product… only a merged family is gone"). A coat whose
catalogue entry is awaiting review is physically in the seller's hands;
refusing to receive it until review finishes would leave real goods off the
books. My first draft offered only `ACTIVE`; that was wrong, and is now
pinned the other way by a test.

## The screen

«Приймання», gated by `inventory:receive`. Choose the warehouse the goods
physically arrived at — only active warehouses this store may receive into;
prefilled when there is exactly one, by the same reasoning and boundary as the
till. Search the catalogue, pick the model, size, quantity and how it arrived
(purchase, consignment, borrowed). Build the delivery, add an optional note
(delivery note, supplier), receive. The result shows what arrived and what
each balance is now.

**Purchase cost** was left out at first, as an owner question; the owner
answered on 2026-09-30 and it is now on the screen — see the section below.

**The journal** follows the till's protocol — the attempt and its key are
written down before sending; a definite refusal clears them and keeps the
list; anything else blocks the whole app, the till included, until the
identical attempt is resent. It is simpler than the till's for one reason: since
ADR-0006, resending returns the original receipt at any distance in time, so
there is no read-back path to maintain. Resending *is* the recovery.

**Layout.** The first screenshot showed the size picker truncated to «Об» and
the search row falling apart — three fields forced into a two-field row built
for the till's quantity + price. Fixed locally, without touching the shared
style the till and orders rely on; the search button is measured, not
eyeballed, to sit on the input's baseline.

## Changed files

- `backend/app/modules/catalog/search.py` — `search_receivable_variants`.
- `backend/app/modules/catalog/read.py` — `real_sizes`, reading order.
- `backend/app/api/v1/catalog.py` — the two endpoints.
- `backend/tests/integration/test_receiving_reads.py` — new, 10 tests.
- `frontend/src/inventory/{Receive.tsx,receiptCommands.ts,receiptTypes.ts}` — new.
- `frontend/src/App.tsx` — the tab, the journal, its banner; the till now
  also waits on an unsettled delivery, and receiving on an unsettled sale.
- `frontend/src/styles.css` — a search-row class.
- `frontend/e2e/receive.spec.ts` — new, 5 tests.

No migration, no change to any stock or money rule.

## Verification

- **Backend: 926 passed**, 0 skipped (916 + 10).
- **E2E: 41 passed** (36 + 5), mobile Chromium, real API and PostgreSQL — including
  creating a brand-new product through the API and receiving it, which is the
  property this screen exists for.
- Ruff, format (158 files), mypy (85 files), import-linter, `alembic check`,
  frontend lint / TypeScript / build — clean. Screenshots inspected.

**Mutation testing — eight, eight caught**, each by exactly the intended test:

| Mutation | Caught by |
|---|---|
| The journal clears on a dropped connection | unknown-outcome browser test |
| Recovery resends under a fresh key | unknown-outcome browser test |
| The screen searches the shelf instead of the catalogue | brand-new-model browser test |
| Any word matches instead of every word | `test_every_word_must_match…` |
| Only `ACTIVE` is offered | `test_a_merged_variant_is_gone_but_one_in_review_is_not` |
| Typed wildcards are not escaped | `test_wildcards_typed_by_a_person_are_literal` |
| "Size not known" is offered | `test_sizes_read_in_order…` |
| Sizes read in stored order only | `test_sizes_read_in_order…` |

## Limits and what is next

- **`POST /inventory/adjustments` still doubles a correction** replayed after
  its 7-day cache (ADR-0006). That blocks the last M1-025 seller flow — quick
  correction — from getting a durable journal, and needs a design choice
  among the three options recorded there.
- **A product that does not exist yet** must be created in «Каталог» first;
  the screen says so when a search finds nothing.
- **Two journals now share one protocol**, written twice (`@/sales/commands`,
  `./receiptCommands`). Extract it when a third appears, not before.
  *Done 2026-09-30:* the stock correction was the third, and receipts and
  corrections now share `@/shared/journal`; the till keeps its own, since a
  sale is read back by id.
- PostgreSQL 17 not re-run for this change set; no migration, no
  version-sensitive SQL.

## Purchase cost — 2026-09-30

The owner answered: **a seller may enter and see what the shop paid.**

- **Entered per line, optional.** Quantity and cost share the till's
  two-field row; «Як надійшов» moved to its own line so nothing is squeezed
  again. Money is typed as a person writes it («1850,50») and refused when it
  is not money; it travels as `"1850.50"`, never as a float.
- **A line is a lot**, so the same model and size may appear twice in one
  delivery at two prices. Choosing another model clears the previous price.
- **The delivery shows its value** — quantity × cost over the priced lines —
  and says how many lines carry no price rather than counting them as zero.
- **Shown back as stored.** Each receipt line now carries the lot's
  `unit_cost` and `currency_code`, so the result screen shows what was
  recorded, not what was typed — and a late replay, answered from the
  permanent record, says the same. Both fields default to null, so an answer
  frozen before they existed still reads.
- **The cost is part of the delivery's identity.** It was already in the
  permanent fingerprint; a test now pins that the same `command_id` at another
  price is refused as another delivery.
- **Not built:** cost is visible at receipt only, not in the stock view —
  lots of one model can carry different costs, and which one a balance
  "costs" is a reporting question. Purchase installments remain unbuilt.

**Verification:** 928 backend tests (+2), 42 E2E (+1, against the real API:
invalid money refused, a priced and an unpriced line, the exact payload, the
stored cost shown back, the delivery's value). **Five mutations, five
caught**: the cost not echoed, the cost out of the fingerprint, the result not
showing it, the cost sent as typed, an unpriced line not pointed out.
