# The till — a seller can finally sell (M1-025 core) — 2026-09-29

Baseline: `8b1f9d3` (stock view merged as PR #33).
Status: implemented and verified locally. No commit to `main`, no push, no merge.
Branch: `feat/m1-025-sale-till`.

## Why this was next

Every part of a sale existed except the one the shop actually uses. The
backend has carried `POST /sales` with all three in-sale corrections since
M1-030 and M1-023, and the client could browse the catalogue, read balances
and reserve a customer order — but **it could not take money over the
counter**. M1D's exit criterion is that sellers can work in Telegram; without
a till screen that is not close.

## What a seller can now do

Pick the warehouse they are physically handing goods from, pick a product and
size, set the negotiated price, build a basket, and sell it. The receipt shows
what was sold and what the sale did to the shelf.

The part that matters is what happens when the shelf and the ledger disagree,
because that is the normal case this whole design was built around:

- The screen **does not block a quantity above the recorded balance.** A
  seller holding two coats when the system believes in one must be able to
  offer that to the server; blocking it in the client would make «фізично є»
  unreachable from the only place it is ever used.
- The server refuses, naming the stock key, what was asked and what is on the
  books. The till finds that line in the basket and asks the seller the two
  questions the owner's decisions allow: **«товар на місці»** (sell all of it,
  `found_in_store`) or **«на місці лише стільки»** (`missing_in_store`).
- The seller states **how many are present**, never the size of the shortage.
  That is the one number in the flow that is easy to invert, so it is asserted
  on the wire by a browser test.
- Each answer is gated by its own permission, separately: the default seller
  holds `inventory:correct_during_sale` and does **not** hold
  `inventory:report_missing_during_sale`. A seller with neither is told to
  fetch a manager rather than shown a button that would 403.
- A shortfall the server marks `correctable: false` — something reserved
  against a customer order — offers no correction at all, and says why.
- Confirming **zero** present is refused by the server by design (the owner has
  not relaxed it). The till answers that case honestly: it offers to remove the
  line so the rest of the basket can still be sold.

The server may only report the first short line, so answers accumulate across
rounds until the basket goes through.

## Selling once, and only once

A sale takes money, so the journal rules are stricter than the order screen's.

- The attempt — its body **and its Idempotency-Key** — is written to
  `localStorage` **before** the request leaves, so a page that dies mid-flight
  still knows what to ask about.
- A **definite** refusal (an authorization, validation or stock answer to an
  attempt that was never in doubt) proves nothing was written. The journal is
  cleared, the basket is the seller's again, and the payload may now change.
- Anything else — a timeout, a dropped connection, a 5xx — leaves the attempt
  on disk marked ambiguous, blocks every other operation in the app, and
  offers one action: resend the identical attempt under the identical key.
  Either the cache replays the receipt or the sale is performed now.
- **While an outcome is unknown the payload is frozen.** Adding a correction
  then would change the fingerprint under the same `command_id`; if the first
  attempt had in fact committed, the seller would be left holding a sale they
  could not see.
- `command_id` is stable for a basket and minted afresh whenever the basket
  changes. Each *attempt* gets its own Idempotency-Key, so one key always
  answers one payload.
- Once an unknown sale is settled, the till is remounted and the confirmed
  total is shown, so a full basket cannot survive an operation that turned out
  to be complete.

## Two defects found on the way

**1. The sale API documented its own retry rule backwards.** The module
docstring of `app/api/v1/sales.py` said that reusing the rejected
Idempotency-Key "correctly returns `IDEMPOTENCY_CONFLICT`". It does not: the
refusal rolls its claim back with the rest of the transaction, so the key is
free. A client author who believed it would have treated a perfectly good
retry as a lost sale, or built a recovery path around an error that never
arrives.

The advice — mint a new key per payload — is right; the reason given for it
was wrong, and the real reason is stronger: nothing can sell twice because
`command_id` is permanent (I20), which is what makes the corrected attempt
safe under *any* key. Fixed, and pinned by five tests in
`tests/integration/test_sale_retry_contract.py`, including the one case the
old text described correctly (a key whose attempt *succeeded*).

**2. A vague banner over a precise answer.** The command store raised every
refusal globally, so a shortfall produced "Доступного товару вже недостатньо"
above the panel that named the product, the counts and the two things to do
about it. Refusals the till can answer are now returned to the screen instead
of raised; the global banner is kept for the failures nobody can act on
locally.

## Changed files

- `backend/app/api/v1/sales.py` — the corrected retry contract (docstring only).
- `backend/tests/integration/test_sale_retry_contract.py` — new, 5 tests.
- `backend/scripts/seed_orders_e2e.py` — a second warehouse for the till (below).
- `frontend/src/sales/{types,commands}.ts`, `frontend/src/sales/Sale.tsx` — new.
- `frontend/src/shared/api.ts` — an Idempotency-Key header and the refusal's
  `details`, both additive.
- `frontend/src/App.tsx` — the «Продаж» tab, the sale journal, the unresolved-sale
  banner and the settled-sale confirmation.
- `frontend/e2e/sale.spec.ts` — new, 6 browser tests.

No migration. No change to any stock, money or catalogue rule.

## Verification

- **Backend: 909 passed**, 0 skipped (904 at baseline + 5 new), isolated
  PostgreSQL 16.2.
- Ruff clean; **154 files** format-clean; `mypy app scripts`: **84 files**;
  import-linter exit 0; `alembic check`: no new operations.
- **E2E: 34 passed** (28 at baseline + 6 new), mobile Chromium against a real
  API, real PostgreSQL and the 15 merged migrations.
- Frontend lint, TypeScript and production build pass. Mobile screenshot
  inspected; no horizontal overflow.
- The ledger after the run holds exactly what it should: the corrected sale as
  `SALE −29` beside one `ADJUSTMENT FOUND_DURING_SALE +1` — the correction is
  the shortfall and nothing more.

**Mutation testing.** Five deliberate mutations, five caught:

| Mutation | Caught by |
|---|---|
| Every failure treated as definite (the journal clears on a timeout) | the unknown-outcome test |
| `missing_in_store` sends the shortage instead of the count present | the wire assertion |
| `found_in_store` sends the whole line instead of the shortfall | the real-API correction test |
| The correction is offered without its permission | the permission test |
| The idempotency claim is committed before the command runs | `test_a_refusal_frees_its_own_idempotency_key` |

A sixth mutation survived and was not a defect: `error instanceof ApiError` in
the `definite` guard is redundant, because the status check already excludes
everything that is not an `ApiError`. Left in place as an explicit statement of
intent rather than removed.

## The E2E seed gained a warehouse

The order specs reserve stock, and a reservation makes a shortfall
uncorrectable **by design** — so a till test sharing that shelf could never
reach «фізично є» and failed with `correctable: false`. The seed now provisions
a second warehouse, «Каса-склад», stocked and reachable by the same store, and
the sale spec works there. The existing specs select their warehouse by name or
id and are untouched.

This is worth remembering as a real operational property, not a test artefact:
**an outstanding customer reservation on a stock key disables «фізично є» for
that key**, for every seller, until the order is dispatched or released.

## Limits and what is deliberately not here

- **No `size_clarified` in the UI.** The third in-sale correction (a
  "size not known" coat given its size at the counter, ADR-0005 §11) is
  implemented in the backend and not offered by this screen. It needs the
  seller to see the size-not-known balance of the same model, and it is
  refused outright when either balance is reserved. Its own increment.
- **No suggested price.** `VariantPrice` exists in the schema with a
  `suggested_price` column and a docstring saying it is there "so the seller
  does not retype it (F33)" — but **nothing writes it, nothing reads it, and no
  endpoint exposes it.** The seller types every price. That is not wrong —
  prices are negotiated at the counter by the owner's own decision — but the
  convenience the schema was built for does not exist, and **who may set a
  suggested price is an unanswered permission question.** Not invented here.
  See the question below.
- **No refund, receipt or transfer screen**, no whole-catalogue search, no
  printed receipt, no offline queue.
- **`POST /sales` p95 still unmeasured**, now with a UI that can generate the
  load. Still the oldest open item on the release gate.
- The full backend suite ran on PostgreSQL 16.2; **PostgreSQL 17 was not
  re-run** for this change set. It adds no migration and no version-sensitive
  SQL, but that is an argument, not evidence.

## For the owner

**Q-F. Who may set a suggested selling price, and per store or per
organization?** The table is built for it (`variant_price`, unique per
organization + store + variant) and unused. Until this is answered the till
cannot prefill a price, and "taps-to-sale ≤ 5" stays out of reach. This is a
permission question, not a technical one, so it is not being guessed.

**Q-G. Should confirming that *nothing* is present drop the line instead of
refusing the sale?** Carried over from M1-030 and now visible at the counter:
the till offers to remove the line by hand, which is correct but is one more
tap during the moment a customer is waiting.
