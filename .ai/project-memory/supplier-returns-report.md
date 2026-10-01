# Returns to a supplier — 2026-10-01

Baseline: `562068f` (store states, merged as PR #57).
Status: implemented and verified locally. Migration `0026`.
Branch: `feat/supplier-returns`.

## Why this was next

The owner chose it after store states. Until now a return to a supplier was
written off with a note (release checklist, "decided not to block"):
- the stock was right, but nothing said where the goods went;
- there was no supplier anywhere in the system;
- a unit with confirmed damage in «Брак» could only be written off.

The owner answered on 2026-10-01 (business-rules.md, "returns to a
supplier").

## What exists now

**«Постачальникам» — for the owner and managers.**
- **«+ Повернути товар постачальнику»:**
  - choose a warehouse of the store (never a «Брак») and a supplier;
  - the warehouse's goods free to sell are listed with how many are free,
    and the person types how many of each go back;
  - a note, then «Повернути постачальнику N од.».
- **The supplier** is picked from the network's list or added on the spot
  with a name and, if wished, a phone. A name already on the list, however
  spaced or capitalised, is not added again: that supplier is picked, and
  the app says so.
- **The store's returns**, newest first and filtered by supplier. Each shows:
  - the supplier, the date, the warehouse or «Брак», and who sent it;
  - what went back, and the note;
  - «Скасовано …» with its reason, or «Скасувати повернення».
- **Cancelling** asks why, says where the goods will come back, and happens
  once. A unit from «Брак» comes back into «Брак».
- **«Список постачальників»:** any supplier's name or phone can be
  corrected.
- **A lost answer** blocks the app until the same return is resent, as every
  other command does. The goods leave once.

**«Брак».** A unit whose damage is confirmed has «Повернути постачальнику»
next to «Списати», for the owner and managers.
- It asks for the supplier and a note.
- The unit leaves «Брак» and is listed under «Постачальникам».
- Cancelling that return puts it back in «Брак», still confirmed damaged.

**On the server:**
- **The list:** `GET/POST/PUT /suppliers`, with `supplier:return` in the
  store asking.
  - A name is unique in the network by `normalized_name`.
  - A duplicate is refused as `DUPLICATE`, with the existing supplier's id
    and name.
- **A return:** `POST /supplier-returns` takes a `command_id`, a warehouse, a
  supplier and up to 100 lines.
  - Each line is a model and size, once.
  - Only goods free to sell leave; held ones are refused `INSUFFICIENT_STOCK`.
  - It is refused `FROM_DAMAGED` from a «Брак».
  - The same command is answered with what it did. Someone without the
    permission is refused before any answer is replayed.
- **Cancelling:** `POST /supplier-returns/{id}/cancel` with a reason.
  - It cancels the whole return, once; a second answers with it as it is.
  - A unit from «Брак» is refused `FROM_DAMAGED`: it comes back through
    `POST /damaged-units/{id}/cancel-supplier-return`, which names the
    return, so a late press never cancels a newer one.
- **From «Брак»:** `POST /damaged-units/{id}/return-to-supplier`, from
  CONFIRMED only. The unit becomes `SUPPLIER`, and its return's name is
  derived from the unit and how many times it went back.
- **The ledger:** `SUPPLIER_RETURN` movements out, `SUPPLIER_RETURN_CANCEL`
  back. They name the return or its cancellation. Store states apply: a
  blocked store returns nothing.
- **Migration `0026`:**
  - `supplier`, plus `supplier_return`, `supplier_return_line` and
    `supplier_return_cancel`, the last three append-only;
  - `damaged_unit.supplier_return_id` and the `SUPPLIER` status;
  - the two movement types;
  - `supplier:return` for every role holding `inventory:adjust`.

  The downgrade refuses while any supplier is on the list. The `0025` digest
  is frozen.
- **New module `suppliers`**, with two import contracts (24 in all) and an
  ADR-0001 amendment. Only «Брак» and the API use it, and it never imports
  «Брак». So stock in «Брак» still changes only through returns and the
  «Брак» section, as the owner decided.

## Evidence

- **Backend: 1192 passed, 1 skipped** (the `age` test, run by CI). 6 tests
  are new, in `test_supplier_returns.py`:
  - **the suppliers' list:**
    - kept by the owner and managers, never a seller;
    - one name, however spaced or capitalised, with the existing supplier
      offered instead;
    - corrected from either store;
    - another network's list is not reachable;
  - **goods go back from a warehouse and come back when cancelled:**
    - the ledger moves out and back;
    - the same command is answered with what it did, another body is
      refused, and someone without the permission is refused before any
      answer;
    - each store lists its own returns, filtered by supplier;
    - a cancellation needs a reason and happens once;
  - **only goods free to sell go back:** goods held for an order stay, and
    each line is a model and size once;
  - **who, what and from where:**
    - not a seller;
    - not from a warehouse the store does not reach, nor from a «Брак»;
    - not to another network's supplier;
    - not from a store that does not trade;
  - **a confirmed unit from «Брак»:**
    - not before its damage is confirmed, and not by a seller;
    - it leaves «Брак» and its return is listed;
    - it comes back only through «Брак», confirmed, once;
    - it may go back again;
    - a stale cancellation never touches the newer return;
    - the units in «Брак» always add up to its stock;
  - **the migration:**
    - it gives `supplier:return` to whatever role corrects stock, and to no
      other;
    - it round-trips;
    - it refuses to go down while a supplier is on the list.
- **Older tests changed by design:** the role matrix gains `supplier:return`
  for managers, and the frozen digests gain `0025`.
- **Gates:**
  - ruff, format and mypy are clean;
  - 24 import contracts are kept (2 new);
  - `alembic check` is clean;
  - the full `downgrade base` → `upgrade head` round trip passes.
- **E2E: 109 → 114 passed** on a fresh database against the real API. 5 are
  new, in `suppliers.spec.ts`, in the stores' own network:
  - goods go back from a warehouse with a new supplier added on the spot;
    the body is checked, the stock falls and returns when cancelled;
  - goods held for an order are not offered;
  - a supplier already on the list is picked, not added again;
  - a unit from «Брак» goes back to its supplier and comes back to «Брак»
    confirmed;
  - a lost answer is resent unchanged, and the goods leave once.

**Mutation testing — 30 mutants, all caught (backend 20, frontend 10).**
- **Survived at first:**
  - three times, the permission checked before a step already done: a
    seller replaying a manager's return, or pressing a «Брак» step that was
    already taken. Each is now refused with 403 in a test.
  - in the app, goods held for an order offered for return. A journey now
    holds one.
  - a fresh `command_id` on every render. It was equivalent, because a
    resend comes from the journal, so the id is now made when it is sent
    and the state is gone.
- **Backend:**
  - a seller returning goods, listing suppliers, returning or cancelling a
    unit from «Брак»;
  - a name written twice;
  - a warehouse return from «Брак»;
  - a return cancelled twice;
  - a «Брак» return cancelled through the warehouse door;
  - another request under the same command, or the same command done again;
  - «Брак» stock not vouched for;
  - other stores' returns listed;
  - the supplier filter ignored;
  - a unit returned before its damage is confirmed;
  - a stale cancellation cancelling the newer return;
  - a unit's second return named as its first;
  - a cancelled unit not confirmed again;
  - the permission given to nobody, or to every role;
  - the downgrade forgetting the suppliers.
- **Frontend:**
  - goods held for orders offered;
  - the quantity or the note not sent;
  - a lost return forgotten on reload, or blocking nothing;
  - a «Брак» return cancelled through the warehouse door;
  - a cancellation without a reason;
  - a duplicate supplier not picked;
  - «Брак» returned without a supplier, or offering no return.

## Found on the way

- **The E2E API once answered from an old copy of the code.** Started from
  `frontend/`, Python imported a stale installed `app` from site-packages
  instead of the working tree, and every request failed on `is_active`.
  The server is now started with `--app-dir backend`. CI starts it from
  `backend/`.

## Not covered here

- **No money is recorded with a return**, as the owner chose. It waits for
  the store's purchase installments.
- **Receiving does not record a supplier yet**, so a return is not linked to
  the delivery its goods came in.
- **Still waiting for the owner's rules:** the store's purchase
  installments, the JSON stock import, and settling money between stores.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0026_supplier_returns.py`;
  - `backend/app/modules/suppliers/` and `backend/app/api/v1/suppliers.py`;
  - `backend/tests/integration/test_supplier_returns.py`;
  - `frontend/src/suppliers/` («Постачальникам» and the supplier picker);
  - `frontend/e2e/suppliers.spec.ts`.
- Backend:
  - `damaged/models.py`, `damaged/service.py`, `api/v1/damaged.py`: a unit
    back to its supplier, and back;
  - `inventory/models.py`, `inventory/service.py`: the two movement types;
  - `authz/permissions.py`: `supplier:return`;
  - `models_registry.py`, `api/v1/router.py`;
  - `pyproject.toml`: two contracts and two guards widened.
- Frontend:
  - `src/App.tsx`: «Постачальникам» and its journal;
  - `src/damaged/Damaged.tsx`: «Повернути постачальнику».
- Docs:
  - business rules;
  - ADR-0001;
  - the release checklist;
  - the risk register;
  - the milestone;
  - the README.
