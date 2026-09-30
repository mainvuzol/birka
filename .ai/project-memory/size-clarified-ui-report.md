# A size read at the till (M1-025) — 2026-09-30

Baseline: `72fd34c` (PR #41).
Status: implemented and verified locally. Client only; no API change, no migration.
Branch: `feat/m1-025-size-clarified`.

## Why this was next

It was the one M1-025 flow left. The owner decided on 2026-09-29 (ADR-0005
§11, Q4) that a seller may give a coat held as "size not known" its size at
the counter, and the backend has accepted `size_clarified` on `POST /sales`
since M1-023. The till never sent it. A legacy list that loads every coat
without a size therefore left the seller two choices: sell each coat as
"size not known" and lose its size, or ask a manager. For M, if the system
held no M at all, the till could not even offer it for sale.

## What a seller can now do

**Sell a coat by the size on its label.** Choosing a row «… · розмір
невідомий» now offers «Розмір з етикетки». The seller picks M and sells the
coat as M. The basket line says its size came from a coat without one.

**Answer a shortfall with it.** When the server says a line is short —
because the system holds no M, or fewer than the basket — and the same model
is held at that warehouse with its size not known, the till offers «Це товар
без розміру — продати як M». The quantity it sends is the shortfall the
server named: that is the exact bound the owner set. The coat moves out of
"size not known" into M as the audited pair of movements the backend already
writes, and the receipt says «Уточнено розмір: 2 рух(и) складу».

**«Товар на місці» is not offered then.** The server refuses it, because a
found M could be one of the coats already counted without a size. A line
that is itself sold as "size not known" is offered neither: that size is
never added, and it has nothing to clarify.

## How the till knows the model is held without a size

It needs to know before it can offer the right answer. It uses three
sources:

- the page of the warehouse list it has loaded;
- the basket line itself, when it was built from a size-not-known row;
- the server refusing «товар на місці» with `UNKNOWN_SIZE_STOCK`.

In the third case nothing was sold. The till restores the same shortfall and
now offers the clarification instead. So a list page that does not reach
that row costs one extra tap, and never a wrong record.

## Refusals it now explains

| Server answer | What the till says, and does |
|---|---|
| `SIZE_NOT_KNOWN_SHORT` | fewer coats without a size than the clarification needs; the clarification is withdrawn |
| `SIZE_CLARIFIED` (the shortfall moved) | the stock changed while the seller answered; press «Продати» again |
| `SIZE_NOT_KNOWN_AMBIGUOUS` | the model is held under more than one unknown size; ask a manager |
| `RESERVED` | part of these units is reserved for an order |

`SIZE_NOT_KNOWN_SHORT` arrives as `INSUFFICIENT_STOCK`, shaped like a
shortfall. Read as one, it would have shown the "reserved for an order"
panel. It is now told apart by its `reason`.

## The sale journal stays compatible

An attempt written down by the previous till has no `size_clarified`. It is
still accepted, and resent exactly as stored — same key, same body — because
resending anything else under that key is a different payload. A browser
test pins this.

## Also changed

- A line sold as "size not known" shows «розмір невідомий» in the basket,
  instead of the raw size code.
- With one unit asked for, «на місці лише стільки» is no longer offered. Its
  only valid answer was a number between 1 and 0; fewer than one present is
  none, and the till already offers to remove the line (Q-G).

## Verification

- **56 Playwright tests** on mobile Chromium against the real API, after a
  fresh seed: 50 existing and 6 new. ESLint, `tsc` and the production build
  are clean.
- **944 backend tests passed.** Ruff, format, mypy and import-linter are
  clean. No backend code changed, only the E2E seed.
- The seed opens a fourth warehouse, «Старі залишки», the way a shop would,
  and it goes through the list's own commands:
  1. import «Лоран шоколад 3 шт»;
  2. resolve it as three coats with their size not known;
  3. approve it;
  4. then deliver one M.

  No ledger row is written by hand.

**Mutation testing — eight, eight caught**, each by the intended test:

| Mutation | Caught by |
|---|---|
| The label size is ignored | the sell-by-label test |
| The clarification sends the whole line, not the shortfall | the sized-line and server-refusal tests |
| «Товар на місці» offered beside the clarification | the sell-by-label and server-refusal tests |
| `UNKNOWN_SIZE_STOCK` is not understood | the server-refusal test |
| A clarification's own refusal is read as a shortfall | the refused-for-its-own-reason test |
| A line sold as size not known is offered «товар на місці» | the size-not-known line test |
| An old attempt without `size_clarified` is refused as corrupt | the old-journal test |
| An old attempt is resent with `size_clarified` added | the old-journal test |

## Changed files

- `frontend/src/sales/Sale.tsx` — the label size, the third answer, the
  refusals, the one-unit case.
- `frontend/src/sales/commands.ts`, `frontend/src/sales/types.ts` —
  `size_clarified`, optional on a stored attempt.
- `frontend/e2e/size.spec.ts` — new, 6 tests.
- `backend/scripts/seed_orders_e2e.py` — «Старі залишки», opened from a list.
- Status in the milestone, the till and stock-correction reports, and the
  risk register.

## Limits

- **Selling by the label size needs `inventory:receive`**, because the
  organization's sizes come from the receiving endpoint. The default seller
  holds it.
- One coat at a time, inside a sale. There is still no command to give sizes
  to a warehouse's size-not-known stock in bulk (known risks, M1-023).
- `taps-to-sale` still waits on the suggested price (Q-F), under M1-028.
