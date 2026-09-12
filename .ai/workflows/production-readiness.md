# Workflow: Production Readiness

1. Confirm acceptance criteria and domain invariants.
2. Run lint/type/unit/integration checks relevant to the change.
3. Run concurrency/idempotency checks for critical writes.
4. Run tenant/RBAC/security checks where access changes.
5. Run golden-path E2E suite.
6. Compare performance budgets/regression gates.
7. Verify migrations and rollback/forward compatibility.
8. Confirm logging, business observability and request correlation.
9. Confirm backup/recovery implications for material schema/data changes.
10. Independent Production Readiness Review returns `READY`, `READY_WITH_ACCEPTED_RISK`, or `BLOCKED`.
11. Human approval is required for red-tier production actions.
