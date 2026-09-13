# ADR-0001 — Modular monolith with CI-enforced module boundaries

Status: Accepted (planning run 2, conceptual approval)

## Context

Milestone 1 builds catalog identity, inventory ledger, sales, refunds, transfers, legacy import, auth and RBAC at once. Those concerns have very different risk profiles: a mistake in the catalog matcher costs a confusing product list, a mistake in the inventory ledger costs money and trust.

The governing documents constrain the answer. `constitution.md` §14 forbids distributed infrastructure without measured need. `PRODUCT_EXCELLENCE_STANDARD.md` §8 prefers a modular monolith and boring infrastructure. `skills/modular-monolith-guardian.md` names the target modules and requires that extraction stays possible later.

The real risk is not deployment topology — it is that internal boundaries erode. A sales module that reaches directly into the inventory tables is faster to write today and makes invariant I3 ("every quantity change has a ledger entry") unenforceable tomorrow, because the code that changes stock is no longer in one place.

The deployment target is a single small VPS running two shops. There is no measured load, no isolation requirement and no regulatory boundary that would justify separate services.

## Decision

One deployable FastAPI application, organized into modules with explicitly declared dependency edges, and a build that fails when an edge is violated.

Modules: `core`, `identity`, `tenancy`, `authz`, `catalog`, `inventory`, `sales`, `refunds`, `transfers`, `audit`, `telegram`.

Permitted edges:

```text
sales     → inventory, catalog, authz, tenancy, core
refunds   → sales, inventory, authz, tenancy, core
transfers → inventory, authz, tenancy, core
inventory → catalog (read-only), core
catalog   → core            (leaf: catalog depends on nothing but core)
identity  → authz, tenancy, core
authz     → tenancy, core
*         → audit  (any module that changes business state writes its own
                    audit entry, inside the same transaction as the change)
telegram  → identity, core
api/v1    → modules (routers call services only)
```

`sales → audit` and the other audit edges exist because an audit row written
in a different transaction from the change it describes is worse than none: it
either records something that did not happen or misses something that did. The
module making the change therefore writes its own entry.

`identity → authz` is the authentication flow asking authorization what the
user may do before it issues a session. The reverse edge is forbidden, which is
why the "is this user still active?" check lives in the API layer
(`api/deps.py`) rather than inside `resolve_scope` — putting it there would
make `authz` depend on `identity` and close the cycle.

Rules:

1. Cross-module access goes through a service function. No module imports another module's repositories, ORM models or SQL.
2. `inventory` is the only module that writes the `inventory` and `stock_movement` tables. This is what makes invariant I3 checkable.
3. Routers parse the request, call one service, and shape the response. Business rules and transaction boundaries live in services (`conventions.md`).
4. The boundary is enforced by `import-linter` contracts executed in CI (task M1-004). A violating import fails the build, not a review.
5. A contract may only name modules that exist — import-linter errors on a missing module. So **each contract ships with the module it constrains**, and every task that introduces a module must add its contract in the same change. `backend/pyproject.toml` lists the contracts still to be added and the gate that owns each. Until a contract exists, invariant I19 is enforced only for the relationships already encoded; the plan says so rather than claiming blanket coverage.
5. Introducing microservices, a message broker, Kubernetes, Elasticsearch, Redis or a second database requires a new ADR citing measured evidence.

## Alternatives considered

- **Layered monolith (controllers / services / repositories, no module boundaries).** Simpler to start, and the usual outcome is that `SaleService` grows inventory SQL inside it. Rejected: it makes the ledger invariant unverifiable, which is the single most valuable property of this system.
- **Services split by domain (catalog service, inventory service, POS service).** Rejected: no measured need, and it converts every invariant that currently commits in one transaction into a distributed-transaction problem. The sale flow in `architecture.md` depends on a single ACID boundary.
- **Boundaries by convention only, checked in code review.** Rejected: conventions decay under delivery pressure, and this project explicitly prefers deterministic enforcement over intention (`constitution.md` §15).
- **Separate database schemas per module.** Deferred. It would strengthen the boundary but complicates the cross-module transactions the sale flow needs. Revisit if module coupling becomes a real problem.

## Consequences

Positive:

- One transaction can span catalog lookup, inventory update and sale insert — required by `workflows/sale.md`.
- One deployment, one database, one log stream. Operable by one person.
- The ledger invariant becomes mechanically checkable because exactly one module writes stock.
- Extraction stays possible: a module with declared edges and no foreign table access is the unit you would extract later.

Negative:

- Import rules add friction when a genuine new dependency is needed; the contract must be updated deliberately, which is the point but costs time.
- Shared process means a runaway query in the catalog module can affect sale latency. Accepted at two-shop scale; revisit against measured p95.
- `inventory → catalog` read-only coupling is a compromise: inventory needs variant display data. Kept read-only and narrow so it does not become a two-way dependency.

## Operational impact

- **Deployment:** single Docker Compose stack (API, web, PostgreSQL, Caddy). No orchestration.
- **Migration:** one Alembic history for the whole application; module ownership of tables is a code convention, not a database boundary.
- **Monitoring:** one correlation id per request flows through every module and into the audit log.
- **Rollback:** one artifact to roll back. Migration rollback is reviewed per migration (M1-006).
- **CI cost:** the import-linter contract runs in seconds; it is a lint job, not a test suite.
