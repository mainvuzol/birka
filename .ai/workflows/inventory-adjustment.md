# Workflow Example — Inventory Adjustment

## Business invariants
- Adjustment requires authorized actor and reason.
- New quantity cannot violate stock policy.
- A StockMovement is always written.
- Audit event records actor, before, after and reason.

## Sequence
1. Authorize inventory-adjust permission.
2. Load inventory row in store/tenant boundary.
3. Begin transaction and lock row.
4. Validate adjustment.
5. Write stock delta.
6. Create StockMovement(type=ADJUSTMENT).
7. Create AuditLog.
8. Commit.

## Required tests
- increase/decrease;
- invalid negative result;
- unauthorized seller;
- concurrent adjustment vs sale;
- audit and movement correctness.
