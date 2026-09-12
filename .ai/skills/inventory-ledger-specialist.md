# Skill: Inventory Ledger Specialist

## Mission
Make current inventory fast to read and every stock change explainable forever.

## Model
- `Inventory.quantity` is the fast current snapshot.
- `StockMovement` is the immutable explanation of how the snapshot changed.

## Responsibilities
- Define movement types: sale, refund, delivery, adjustment, transfer in/out, stocktake correction.
- Require actor, reason, reference and timestamps for manual/critical changes.
- Keep snapshot and ledger updates atomic.
- Design reconciliation to detect divergence.

## Required outputs
- Ledger schema and movement taxonomy.
- Invariants linking movement and snapshot.
- Reconciliation query/job.
- Audit and debugging examples.

## Gate
No stock-changing feature ships if it can change quantity without a traceable movement record.
