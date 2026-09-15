# Confirmed owner decisions — 2026-09-15

Source: explicit owner message in the project conversation. Status: recorded requirements; no code, migrations, financial records or existing stock changed.

## 1. Warehouses

There is one primary warehouse (the primary/parent store’s warehouse) from which both the primary and child stores sell. There is also a separate child-store warehouse.

This supersedes the assumption that selling store and physical stock location are the same. Shared stock must have one authoritative balance, not duplicated balances per selling store. Sales attribution must remain visible per store.

Design work before M1-018: model warehouse access and source/destination locations separately from the store of sale; preserve existing quantities and ledger provenance during migration. Physical movement between locations must be explicit and auditable. Selecting shared stock for a sale is not itself a transfer.

Still to define: ownership rules for goods in the child warehouse, who can accept a return from the other store, which destination is allowed, and which store handles money. A warehouse name alone must not infer legal ownership or grant access. Do not implement cross-store returns merely by removing the existing authorization check.

## 2. Store states

Add:
- temporarily blocked by an administrator;
- ceased trading / archived.

Daily closing/end of shift is a separate concept. Do not equate these states with “may refund money but cannot receive goods.” Before implementation define permitted reads, sales, receipts, returns, transfers, payment settlements and reactivation/archive authority. Historical operations remain accessible to authorized users; closure does not erase records or obligations.

## 3. Return condition

Mark returned units as intact or damaged. Support different conditions for units from the same sale line within one return. Aggregate all parts when enforcing remaining returnable quantity.

Condition must be separate from disposition. “Damaged” does not automatically mean written off, absent, or saleable. Exact destination/quarantine/repair/write-off flow remains to be designed; do not silently return damaged items to saleable stock. Existing restock:boolean does not fully represent this requirement.

## 4. Payments

Owner clarified the earlier refund question and then resolved “arbitrary amount”: it means the **agreed final selling price**, negotiated below or above the suggested price, including an increase such as +200 UAH. It is not an initial/partial payment and does not itself create an outstanding balance.

Price and payment timing are separate dimensions: agree the final price, then account for full payment or installments. For example, a suggested price of3000 UAH may become an agreed2800 or3200 UAH; full payment of that agreed amount settles the sale. Preserve the agreed price as a historical sale fact without changing the catalog suggested price. This is not approval of refund installments or deductions from refunds.

Also record separately when the store purchased goods on installments. Customer payments and the store’s purchase obligations are different records and must not be conflated. Existing immutable sale prices and StockLot acquisition costs remain historical facts; payment changes must not rewrite them.

The arbitrary-price question is resolved. Installment schedules, due dates, reconciliation and the return of partially paid purchases still need explicit rules and tasks. A single boolean may flag installment terms but cannot by itself account for payments and outstanding balances. Price-change permissions and audit requirements must be specified without inventing discount/surcharge limits.

Refund deductions remain unapproved; existing receipt-based refund amounts are not changed by this decision. Installment-sale refunds need a design before those sales become available.

## 5. Return age

No automatic cutoff based on the age of a sale. This does not bypass permission checks, linkage to the original sale or limits accounting for all previous returns. It does not mean automatic acceptance of every return.

## Roadmap handoff

1. Design stock locations and their migration before M1-018; preserve one shared balance and ledger continuity.
2. Specify blocked/archived state permissions and amend the existing return workflow for conditions and allowed locations.
3. Create explicitly scoped payment/obligation tasks with negotiated final prices separated from full/installment settlement; do not silently count these new requirements as delivered by M1-017.
4. Keep M1C parser/import work independent where possible. Keep raw source records unchanged.

Historical implementation reports remain evidence of the tested baseline; they are not evidence that these newly confirmed requirements have been built.
