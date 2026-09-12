# Example Handoff — Concurrency Specialist

## Objective
Design concurrency-safe semantics for `POST /sales` when two sellers try to buy the last unit simultaneously.

## Context
- PostgreSQL is source of truth.
- Inventory cannot become negative.
- Same idempotency key must not duplicate sale.
- Sale and StockMovement must be atomic.

## Relevant files
- `backend/app/services/sales.py`
- `backend/app/models/inventory.py`
- `backend/tests/integration/`

## Acceptance criteria
- One of two simultaneous requests can sell the last unit; the other gets `INSUFFICIENT_STOCK`.
- Final quantity is zero.
- No partial Sale row exists for rejected request.
- Retry with same idempotency key returns original sale.

## Output
- recommended locking/update strategy;
- deadlock considerations;
- test scenarios;
- any required DB constraint/index.

## Prohibited
- do not modify production;
- do not redesign unrelated inventory modules.
