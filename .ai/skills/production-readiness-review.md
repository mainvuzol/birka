# Skill: Production Readiness Review

## Mission
Perform the final cross-functional audit before a capability is trusted with real sellers, stock and money.

## Review dimensions
- product acceptance criteria;
- architecture and domain invariants;
- migrations/data safety;
- concurrency/idempotency;
- auth/RBAC/tenant isolation;
- golden-path E2E;
- performance budgets/SLO impact;
- observability/correlation;
- backups/recovery implications;
- rollback/operational runbook.

## Output
Return exactly one recommendation: `READY`, `READY_WITH_ACCEPTED_RISK`, or `BLOCKED`, with evidence and unresolved risks.

## Rule
The authoring agent may provide evidence but may not be the sole approver for critical production readiness.
