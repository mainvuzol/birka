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
