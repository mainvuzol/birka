# Goods borrowed from another shop — 2026-10-01

Baseline: `01d52a2` (where an order goes, merged as PR #60).
Status: implemented and verified locally. Migration `0029`.
Branch: `feat/borrowed-goods`.

## Why this was next

Settling money between stores was offered as the next work. The owner
answered that stores of one network do not settle with each other. What the
network needs instead is a record of jackets taken from another shop, "as
from a supplier, roughly", which is "a loan of jackets with a sum".

The owner answered the rest on 2026-10-01 (business-rules.md, "no settling
between the network's stores" and "goods borrowed from another shop").

## What exists now

**«Приймання», for the owner and managers.**
- «Як надійшов» offers «Позичено» and «Під реалізацію» beside «Закупівля».
- **For those two, the price is the price agreed** with the supplier, and it
  is required: «Вкажіть ціну за одиницю, домовлену з постачальником».
- **The supplier is picked** from the network's list, or added on the spot,
  and is required: «Оберіть постачальника, чий це товар».
- **A seller does not see «Як надійшов»** and receives the shop's own goods
  only.

**«Постачальникам» → «Позичене й під реалізацію».**
- Each lot shows:
  - what it is, from whom, borrowed or under consignment, when, where;
  - the agreed price;
  - «взято · продано · повернено · на руках».
- **The list shows what is still on hand, or everything.**
- **«Продано»** with a quantity: the store owes the supplier their price.
  It is an invoice in «Накладні», «За продане позичене: … × N», paid there
  like any other.
- **«Повернути постачальнику»** with a quantity: a return to the supplier,
  listed among the returns. It takes the goods off the shelf, for nothing.
- **Never more than is on hand:** «На руках лише N од.».
- **A «Продано» marked by mistake:** cancelling its invoice in «Накладні»
  puts the goods back on hand. The invoice says so.
- **A lost answer** blocks the app until the same command is resent:
  - for «Продано», through the invoices' journal, and the list says to check
    it in «Накладні»;
  - for a return, through the returns' journal.

**On the server:**
- **`POST /inventory/receipts`** takes a `supplier_id`. Lines `BORROWED` or
  `CONSIGNMENT` need:
  - `supplier:debt` (403 otherwise);
  - a supplier (`SUPPLIER`), on the network's list (404 otherwise);
  - a price above nothing (`PRICE`).

  The permanent fingerprint carries the supplier only when one is stated,
  and so does the 7-day cache's. A delivery sent before keeps its print, and
  the same command from another supplier is refused.
- **`GET /borrowed`** (`supplier_id`, `on_hand`) is what this store borrowed,
  for whoever keeps the suppliers. On hand is what arrived, less the invoices
  for it that stand, less the returns of it that stand.
- **`POST /supplier-invoices/sold`** (`stock_lot_id`, `quantity`, permanent
  `command_id`) is an invoice for `quantity` × the agreed price. It names its
  lot, quantity and label, which `GET /supplier-invoices` shows as `sold`.
  - It is refused above what is on hand (`MORE_THAN_ON_HAND`).
  - Another store's lot is refused (404).
- **`POST /supplier-returns`** takes a `stock_lot_id`. Such a return is that
  lot alone:
  - its supplier, or it is refused (`OTHER_SUPPLIER`);
  - its warehouse, model and size, one line (`NOT_THE_LOT`);
  - never more than is on hand (`MORE_THAN_ON_HAND`).
- **Each such command holds the lot's row**, so two never both count the same
  goods.
- **Migration `0029`:**
  - `goods_receipt.supplier_id`;
  - `supplier_invoice.stock_lot_id`, `lot_quantity` and `lot_label`, checked
    to stand together;
  - `supplier_return.stock_lot_id`.

  The downgrade refuses while any receipt names its supplier. The `0028`
  digest is frozen.
- **`suppliers.borrowed`**, a new file of module `suppliers`. The invoices
  still never reach the ledger. Settling between stores leaves the backlog.

## Evidence

- **Backend: 1217 passed, 1 skipped** (the `age` test, run by CI). 5 tests
  are new, in `test_borrowed_goods.py`:
  - **borrowed goods come from a supplier at a price:**
    - not a seller's, though a seller still receives purchases;
    - no supplier, no price, a price of nothing, another network's supplier
      are all refused;
    - the same delivery from another supplier is refused;
    - a purchase from a supplier is not listed;
    - consignment is listed too;
    - the list is never a seller's, each store's own, filtered by supplier;
  - **marked sold:**
    - an invoice for their price, its lot named;
    - no goods move;
    - the same command is answered with its invoice, never to a seller;
    - never more than on hand, never another store's;
    - cancelling the invoice puts them back on hand;
  - **sent back unsold:**
    - to their supplier only, their own model and size only;
    - off the shelf;
    - never more than on hand, counting what was marked sold;
    - gone from the list once nothing is on hand;
    - cancelling the return puts them back;
  - **a mark and a return in one instant** never take more than is on hand;
  - **the migration** round-trips, and refuses to go down while a receipt
    names its supplier.
- **Older tests changed by design:** the frozen digests gain `0028`.
- **Gates:**
  - ruff, format and mypy are clean;
  - 25 import contracts are kept;
  - `alembic check` is clean.
- **E2E: 125 → 130 passed** against the real API. 5 are new, in
  `borrowed.spec.ts`, in the stores' own network:
  - borrowed jackets taken in «Приймання», refused at first without a price
    and a supplier; then marked sold, with the invoice in «Накладні»; the
    bodies are checked;
  - unsold ones sent back, refused above what is on hand, gone from the list;
  - a mistaken «Продано» undone by cancelling its invoice;
  - a seller sees neither «Як надійшов» nor «Постачальникам»;
  - a lost «Продано» resent unchanged after a reload, counted once.

  The E2E network gains Ліда, who sells at «Центр» with a seller's default
  rights.

**Mutation testing — 36 mutants, all caught (backend 24, frontend 12).**
- **Survived at first:** the supplier picker hidden until a borrowed line
  was added. The journey now checks that it appears as soon as «Позичено»
  is chosen.
- **Backend:**
  - a seller taking borrowed goods;
  - borrowed goods with no supplier, no price, or a price of nothing;
  - another network's supplier;
  - whose goods not kept;
  - another supplier's delivery taken for this one;
  - other stores' lots or bought goods listed;
  - what is no longer on hand still listed; the supplier filter ignored;
  - a cancelled invoice or return still counted;
  - a sale priced as one whatever the count;
  - more marked sold or sent back than is on hand;
  - another store's lot sold;
  - borrowed goods sent to another supplier, or other goods sent as the
    lot;
  - a seller seeing the list;
  - the return or the invoice forgetting its lot, or the lot not checked;
  - the downgrade forgetting whose goods they were.
- **Frontend:**
  - borrowed goods added at no price, or sent from nobody;
  - the supplier not sent;
  - a seller offered borrowed goods; no supplier to pick;
  - a mark of sold counting one;
  - a return forgetting its lot;
  - what is no longer on hand still listed;
  - a lost mark not pointed out;
  - the invoice hiding what was sold;
  - a delivery or a return the journal cannot keep.

## Not covered here

- **The till does not tell borrowed jackets from the shop's own**, as the
  owner chose: marking them sold is by hand. Nothing reminds anyone.
- **A plain return to the supplier** of borrowed goods leaves them on hand in
  the list: only a return from the list names the lot.
- **Still waiting for the owner:** the JSON stock import (backlog).
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0029_borrowed_goods.py`;
  - `backend/app/modules/suppliers/borrowed.py`;
  - `backend/tests/integration/test_borrowed_goods.py`;
  - `frontend/src/suppliers/Borrowed.tsx`;
  - `frontend/e2e/borrowed.spec.ts`.
- Backend:
  - `api/v1/inventory.py`: the supplier, the price and the right for
    borrowed goods;
  - `inventory/models.py`: `goods_receipt.supplier_id`;
  - `suppliers/models.py`, `invoices.py`, `service.py`, `common.py`: the lot
    on invoices and returns; the keeper's check shared;
  - `api/v1/suppliers.py`, `api/v1/supplier_invoices.py`: `/borrowed`,
    `/supplier-invoices/sold`, the lot on returns;
  - `scripts/seed_orders_e2e.py`: Ліда.
- Frontend:
  - `src/inventory/Receive.tsx`, `receiptTypes.ts`, `receiptCommands.ts`;
  - `src/suppliers/Suppliers.tsx`, `Invoices.tsx`, `invoiceCommands.ts`,
    `commands.ts`, `types.ts`;
  - `src/App.tsx`.
- Docs:
  - business rules;
  - the backlog, which loses settling between stores;
  - the risk register;
  - the milestone;
  - ADR-0001;
  - the README.
