# Workflow Example — Create Sale

## Business invariants
- A sale cannot reduce any stock below zero.
- All sale items and stock changes are atomic.
- Same idempotency key returns the original result.
- SaleItem stores immutable price/discount/tax snapshots.

## Recommended sequence
1. Authenticate and resolve seller/store/organization.
2. Validate cart request.
3. Resolve idempotency key.
4. Start DB transaction.
5. Lock or atomically reserve/update inventory rows in deterministic order.
6. Validate availability.
7. Calculate monetary totals with Decimal/fixed precision.
8. Create Sale + SaleItems.
9. Create StockMovement entries.
10. Update inventory.
11. Commit.
12. Return canonical Sale response.
13. Frontend reconciles optimistic state with server response.

## Required tests
- happy path;
- insufficient stock;
- duplicate idempotency request;
- two concurrent sales for last unit;
- DB failure rolls back sale and stock;
- seller cannot sell from foreign store;
- frontend handles timeout/retry safely.
