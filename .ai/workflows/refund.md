# Workflow Example — Refund / Return

## Business invariants
- Refunded quantity cannot exceed originally sold quantity minus prior refunds.
- Financial refund and stock-return policy are explicit and may differ.
- Duplicate refund command must be idempotent.
- Original sale history remains immutable.
- Every inventory restoration writes a StockMovement.

## Sequence
1. Load sale in tenant/store boundary.
2. Validate refundable quantity and permissions.
3. Resolve idempotency key.
4. Begin transaction.
5. Lock refund-relevant rows if concurrent refunds are possible.
6. Compute refund amount using original sale snapshots.
7. Create Refund/RefundItems.
8. Restore stock if policy requires it.
9. Write StockMovement and AuditLog.
10. Commit.

## Required tests
- partial refund;
- full refund;
- duplicate refund;
- two simultaneous refunds of same item;
- cross-store access rejected;
- historical sale totals unchanged.
