# Example — From Board Request to Delivery

Human request:

> Add returns. Sellers must be able to return one item from a sale. Stock should come back when the item is physically returned, and double refunds must be impossible.

## Orchestrator decomposition

1. Product Strategist: define seller workflow and return policy.
2. Requirements Engineer: write refund quantity, permission and idempotency invariants.
3. Retail Domain Expert: define Refund, RefundItem and StockMovement effects.
4. Architect: decide API and transaction boundary.
5. Threat Model: check cross-store refund and role abuse.
6. PostgreSQL/Concurrency: define locking for simultaneous refunds.
7. API Contract: define `POST /sales/{id}/refunds` and errors.
8. Backend Engineer: implement service/API.
9. Frontend Engineer: implement return UI and optimistic/pending behavior only where safe.
10. QA: integration + concurrency tests.
11. Security + Adversarial Review.
12. Playwright: seller returns one item and stock updates.
13. Release Manager: READY/BLOCKED.
