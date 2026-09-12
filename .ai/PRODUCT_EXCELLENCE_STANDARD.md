# Product Excellence Standard

This document defines what “high-class product” means for this project. It is intentionally concise: the team should optimize the vital 20% that determines most user trust and business value.

## The standard
A production capability must be:

1. **Correct** — business invariants hold under retries, concurrency and failures.
2. **Fast** — high-frequency seller workflows feel immediate and stay inside explicit budgets.
3. **Observable** — technical and business failures can be detected and traced.
4. **Auditable** — important changes have actor, reason, before/after and references.
5. **Recoverable** — mistakes and outages have tested recovery paths.
6. **Secure** — authorization, tenant isolation and secrets are enforced by deterministic systems.
7. **Testable** — critical behavior has automated proof, including golden paths and concurrency cases.
8. **Simple to operate** — prefer a modular monolith and boring infrastructure until evidence demands more.
9. **Hard to misuse** — routine human errors produce recoverable outcomes rather than corrupted history.
10. **Easy to evolve** — contracts, migrations, ADRs and module boundaries preserve future changeability.

## 80/20 product priorities
The first-class workflows are:
- open/authenticate;
- scan/find product;
- create sale;
- maintain correct inventory ledger;
- refund/correct mistakes;
- understand what happened through audit/reporting.

A release that improves secondary features while degrading these workflows is not an improvement.

## Authoritative truth
- PostgreSQL committed state is authoritative for stock, money and durable business state.
- Server-side authorization is authoritative for access.
- Database constraints + deterministic domain logic enforce invariants.
- LLMs may propose and explain; they do not become the authority for money, stock, permissions or final accounting.

## Perceived speed vs business truth
Give immediate local feedback, but do not show final financial/inventory success until the authoritative transaction commits. Optimistic UI is allowed only when its failure semantics are honest and reversible.

## Simplicity principle
Do not introduce microservices, Kafka, Kubernetes, Elasticsearch, Redis or another database merely because they are common in large systems. Introduce complexity only when a measured bottleneck, isolation need, compliance requirement or operational boundary justifies it.
