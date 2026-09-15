# Architecture Decisions Index

| ADR | Title | Status | Decided |
|---|---|---|---|
| [ADR-0001](../decisions/ADR-0001-module-boundaries.md) | Modular monolith with CI-enforced module boundaries | Accepted | planning run 2 |
| [ADR-0002](../decisions/ADR-0002-catalog-identity-and-nullable-uniqueness.md) | Catalog identity and nullable uniqueness | Accepted | planning run 2 |

ADR files live in `.ai/decisions/` and follow `.ai/templates/adr.md`.

## Decisions recorded outside an ADR

These were confirmed by the product owner at conceptual approval and are recorded in `.ai/project-memory/milestone-1-plan.md`. Promote any of them to an ADR if it later needs its own alternatives/consequences analysis.

- No LLM parsing and no embeddings in Milestone 1. Matcher v1 is deterministic: verified aliases → `pg_trgm` lexical retrieval → structured attribute-conflict rules.
- A seller may complete a sale against zero system stock when the goods are physically present; the correction and the sale commit in one transaction with reason code `FOUND_DURING_SALE`. Arbitrary inventory adjustment stays a manager/owner permission.
- Milestone 1 is delivered through four internal gates: M1A platform, M1B first complete sale vertical slice, M1C refund/transfer/catalog pipeline/legacy import, M1D client/E2E/release.
- `OutboxEvent` is not built in Milestone 1: no consumer exists, and `audit_log` covers traceability.

- [ADR-0003 — Durable sale replay and complete basket locks](../decisions/ADR-0003-sale-command-replay.md): permanent payload/response proof, command serialization, complete ordered inventory locks, legacy 409 behavior.

### M1-017 (refund), 2026-09-15 — applying ADR-0003 rather than deciding anew

Recorded here rather than as an ADR: the refund reuses accepted decisions instead of making new ones. Details and evidence in [`m1-017-refund-report.md`](m1-017-refund-report.md).

- The refund follows ADR-0003 exactly — permanent `command_id`, nullable `command_fingerprint`, persisted `response_snapshot`, advisory lock keyed on `(organization, command_id)`. An earlier draft made the fingerprint `NOT NULL` on the reasoning that `refund` had never been written; that made revision 0004 a one-way door and was reverted. Nullable is the decision ADR-0003 already made for the same problem.
- Invariant I9 is serialized on the sale's own `sale_item` rows, `FOR UPDATE` in id order, locking the **whole receipt** rather than only the lines being refunded. Two refunds of one receipt therefore queue; in exchange the lock order is provably identical on every path.
- A refund happens in the store of the sale. The store is not a request field, because restocking into another shop would be a transfer without a transfer (I16).
- `refunds` may not import `catalog` (new import-linter contract). Refund money and labels come from the frozen `SaleItem`; only `inventory.service` may reach catalog rows underneath, to check a stock key still exists.
- Text that PostgreSQL cannot store — a NUL byte, a lone surrogate — is refused at every boundary by `app/core/text.py`. Found during this task, but the defect was API-wide and pre-existing since M1B, so the fix is shared rather than refund-local.
