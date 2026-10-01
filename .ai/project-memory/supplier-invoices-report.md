# The store's purchases in parts — 2026-10-01

Baseline: `968415d` (returns to a supplier, merged as PR #58).
Status: implemented and verified locally. Migration `0027`.
Branch: `feat/supplier-invoices`.

## Why this was next

The owner chose it after returns to a supplier. It was the last part of the
owner's decisions of 2026-09-15 still unbuilt ("record separately when the
store purchased goods on installments"). Returns to a supplier recorded the
goods only, and left the money for this.

The owner answered on 2026-10-01 (business-rules.md, "the store's purchases
in parts").

## What exists now

**«Накладні» — for the owner and managers.** A seller does not see it.
- **What the store owes:** in all, and by supplier, the largest first.
- **«+ Записати накладну»:**
  - a supplier from the network's list, or added on the spot;
  - the sum on the invoice;
  - what was paid at once, from nothing to all of it;
  - a note.

  Paid in full, the invoice is closed at once and stays in the history.
- **The store's invoices**, newest first, filtered by supplier, those still
  owed or all of them.
- **An invoice** shows its sum, what was paid, set off and written off, what
  is left, and its history. From it:
  - **«Сплатити»**, never more than is left; «Увесь залишок» fills it in;
  - **«Залік за повернений товар»:** a return to that supplier from this
    store that still stands, and the sum the supplier counted for it;
  - **«Списати залишок»**, for the owner only, saying why. Final;
  - **cancelling a payment or a set-off** recorded by mistake, saying why:
    the invoice owes it again;
  - **«Скасувати накладну»**, saying why, once nothing on it stands. Until
    then the app says to cancel its payments and set-offs first.
- **«Чиї накладні» → stores that are blocked or closed:** their invoices,
  paid here. Each payment says which store made it. A payment made there by
  mistake is cancelled there too.
- **A lost answer** blocks the app until the same command is resent
  unchanged, through the shared journal. The money is counted once.

**«Постачальникам».** A return the supplier counted shows what was set off
and when. Instead of «Скасувати повернення», it says to cancel the set-off
in «Накладні» first.

**On the server:**
- **An invoice:** `POST /supplier-invoices` with a `command_id`, the
  supplier, the sum and `paid_now`. A first payment shares the invoice's
  `command_id`.
- **A payment:** `POST /supplier-invoices/{id}/payments`.
  - Refused above what is owed (`MORE_THAN_OWED`), or once nothing is
    (`NOT_OWED`).
  - From another store only while the one that owes does not trade
    (`store_id`, else `PAID_WHERE_OWED`). It is recorded as
    `paid_at_store_id`.
- **A set-off:** `POST /supplier-invoices/{id}/set-offs`.
  - It names a return of the same store (else 404) and the same supplier
    (`OTHER_SUPPLIER`) that still stands (`RETURN_CANCELLED`).
  - It is never more than is owed. One return may be set off against
    several invoices.
- **A write-off:** `POST /supplier-invoices/{id}/write-off`, with
  `supplier:write_off`. While the store does not trade, it needs that
  permission network-wide.
- **Mistakes:**
  - `POST /supplier-invoices/{id}/entries/{entry_id}/cancel` and
    `POST /supplier-invoices/{id}/cancel`, with a reason.
  - Each happens once; a second answers with the invoice as it is.
  - An invoice is refused while a payment or set-off stands
    (`ENTRIES_STAND`, with their ids). Anything written off is refused
    (`WRITTEN_OFF`).
- **A return set off against an invoice** is refused when cancelled, from
  either door (`SET_OFF`, with the set-offs). `GET /supplier-returns` shows
  each return's standing set-offs.
- **Reading:** `GET /supplier-invoices` (`supplier_id`, `status`,
  `elsewhere`) and `GET /supplier-invoices/summary`.
- **The suppliers' list** is also kept by whoever holds `supplier:debt`.
- **Migration `0027`:**
  - `supplier_invoice`, plus `supplier_invoice_entry`,
    `supplier_invoice_entry_cancel` and `supplier_invoice_cancel`, the last
    three append-only;
  - `supplier:debt` for every role holding `supplier:return`, and
    `supplier:write_off` for every role holding `credit:write_off`.

  The downgrade refuses while any invoice is recorded. The `0026` digest is
  frozen.
- **Inside module `suppliers`**, as `suppliers.invoices`, with one new import
  contract (25 in all) and an ADR-0001 amendment. It never reaches the
  ledger, not even through the returns.

## Evidence

- **Backend: 1203 passed, 1 skipped** (the `age` test, run by CI). 10 tests
  are new, in `test_supplier_invoices.py`:
  - **paid in parts until settled:**
    - never a seller's;
    - nothing, part or all paid at once, never more;
    - the same command is answered with what it did, another body is
      refused, and a seller is refused before any answer;
    - never more than is owed, nothing once settled;
    - the summary by supplier, the largest first, without what is settled;
    - each store its own; another network's supplier and invoice are not
      reached;
  - **whoever records invoices keeps the list of suppliers**, but returns no
    goods;
  - **two payments in one instant** never pay more than is owed;
  - **set-offs:**
    - not by a seller;
    - not another supplier's return, nor another store's, nor more than is
      owed;
    - one return against two invoices;
    - the return lists them, and is refused until both are cancelled;
    - a cancelled return is never counted;
  - **a unit from «Брак»** comes back only once its set-off is cancelled;
  - **mistakes:**
    - an invoice with a standing payment is refused, naming it;
    - a cancellation needs a reason, happens once, and never by a seller;
    - a settled invoice owes again when its payment is cancelled;
    - a cancelled invoice is paid no more and owes nothing;
  - **the write-off:** not by a manager; final for it, the payments before
    it and the invoice;
  - **a store that does not trade:**
    - another store pays its invoice only then;
    - its own people are refused;
    - the payment names the store that made it, and is cancelled there;
    - the network's manager writes off nothing, and its owner does;
  - **an open invoice does not keep a store from the archive;**
  - **the migration:**
    - `supplier:debt` reaches whatever role returns goods, and
      `supplier:write_off` whatever role writes off a customer's debt, and
      no other;
    - it round-trips;
    - it refuses to go down while an invoice is recorded.
- **Older tests changed by design:** the role matrix gains `supplier:debt`
  for managers and `supplier:write_off` for the owner, and the frozen
  digests gain `0026`.
- **Gates:**
  - ruff, format and mypy are clean;
  - 25 import contracts are kept (1 new);
  - `alembic check` is clean;
  - the full `downgrade base` → `upgrade head` round trip passes on an
    empty database. On one holding invoices, the downgrade refuses, as
    designed.
- **E2E: 114 → 120 passed** on a fresh database against the real API. 6 are
  new, in `supplier-invoices.spec.ts`, in the stores' own network:
  - an invoice recorded with part paid at once, and paid in parts until
    settled; the bodies are checked, and the summary changes;
  - a return set off against an invoice: a cancelled return is not offered,
    the return card waits for the set-off, and cancelling it frees the
    return;
  - a payment and then the invoice cancelled, saying why;
  - a manager is not offered the write-off; the owner writes off what is
    left;
  - an archived store's invoice paid at «Центр», naming it;
  - a lost payment resent unchanged, and paid once.

  The E2E network gains Марко, a manager with a manager's default rights,
  and an open invoice of the archived «Старий».

**Mutation testing — 53 mutants, all caught (backend 38, frontend 15).**
None survived on the first run.
- **Backend:**
  - a seller recording, paying, setting off, cancelling or listing;
  - a seller's payment replayed;
  - more paid at once than the invoice says; the first payment not
    recorded; an invoice paid in full left open;
  - the same invoice, payment or command done again, or another request
    under it;
  - more paid or set off than is owed; a settled invoice paid again;
  - another store paying while the one that owes trades; the paying store
    not recorded; a payment made elsewhere cancelled only at home;
  - another supplier's, another store's or a cancelled return set off;
  - a return cancelled while its set-off stands, or kept by a cancelled one;
  - a manager writing off, here or for a store that does not trade;
  - a payment cancelled after the write-off, a written-off invoice
    cancelled;
  - an entry cancelled twice; a settled invoice not reopened; a cancelled
    payment still lowering the debt; an invoice cancelled while a payment
    stands;
  - the summary counting closed invoices; the closed stores' list showing
    trading ones;
  - whoever records invoices unable to keep the list of suppliers;
  - the migration giving the debts to nobody, the write-off to whoever
    returns goods, or its downgrade forgetting the invoices.
- **Frontend:**
  - what was paid at once, the note or the payment's sum not sent;
  - a payment for a closed store not marked, or naming no store;
  - a manager offered the write-off;
  - a return with a set-off, or an invoice with a payment, offered for
    cancelling;
  - a cancellation without a reason;
  - a cancelled return offered for a set-off;
  - the closed stores' invoices not asked for, or offered a set-off;
  - «Увесь залишок» filling the invoice's sum;
  - a lost operation forgotten on reload, or blocking nothing.

## Not covered here

- **An invoice is not linked to the goods it paid for**, as the owner
  chose. Nothing checks its sum against what was received.
- **A set-off's sum is what the person types.** No purchase price is known
  for returned goods.
- **No advance to a supplier:** a payment above what is owed is refused.
- **A write-off cannot be undone.**
- **Still waiting for the owner's rules:** the JSON stock import, and
  settling money between stores.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0027_supplier_invoices.py`;
  - `backend/app/modules/suppliers/invoices.py` and `common.py`;
  - `backend/app/api/v1/supplier_invoices.py`;
  - `backend/tests/integration/test_supplier_invoices.py`;
  - `frontend/src/suppliers/Invoices.tsx` and `invoiceCommands.ts`;
  - `frontend/e2e/supplier-invoices.spec.ts`.
- Backend:
  - `suppliers/models.py`: the four tables;
  - `suppliers/service.py`: the shared helpers moved to `common.py`; a
    return refuses to be cancelled while a set-off stands; returns show
    their set-offs; the list is kept by `supplier:debt` too;
  - `api/v1/suppliers.py`: `set_offs` on a return;
  - `authz/permissions.py`: `supplier:debt`, `supplier:write_off`;
  - `models_registry.py`, `api/v1/router.py`;
  - `pyproject.toml`: one contract;
  - `scripts/seed_orders_e2e.py`: Марко and «Старий»'s invoice.
- Frontend:
  - `src/App.tsx`: «Накладні» and its journal;
  - `src/suppliers/Suppliers.tsx`: set-offs on a return;
  - `src/suppliers/types.ts`.
- Docs:
  - business rules;
  - ADR-0001;
  - the release checklist;
  - the risk register;
  - the milestone;
  - the README.
