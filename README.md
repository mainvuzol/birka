# birka

Inventory and Stock Management for Outerwear Stores (Telegram Mini App)

Two related women's outerwear shops currently run on a paper notebook. birka has to be faster
than that notebook at the counter while keeping stock, money and product identity provably
correct.

## Status

**Milestone 1, gate M1A (platform foundation) — implemented and independently reviewed.**
Gate M1B (first complete sale vertical slice) has not started.

Locally verified: lint, formatting, strict type checking, architecture contracts and
95 tests. Not verified locally, because this machine has no Docker, no PostgreSQL and
no Node: the database integration tests (15), `docker compose up`, and the frontend
build. Those run in CI, and the first CI run on push is what proves them.

The plan, the decisions and the current state live in [`.ai/`](.ai/):

| Document | What it is |
|---|---|
| [`.ai/project-memory/milestone-1-plan.md`](.ai/project-memory/milestone-1-plan.md) | The plan: domain model, 22 invariants, 28 tasks, 4 gates |
| [`.ai/project-memory/current-milestone.md`](.ai/project-memory/current-milestone.md) | Where the work stands right now |
| [`.ai/decisions/`](.ai/decisions/) | Architecture decision records |
| [`.ai/constitution.md`](.ai/constitution.md) | Engineering rules this repository is governed by |

## Layout

```text
backend/      FastAPI modular monolith, SQLAlchemy async, Alembic
frontend/     React + TypeScript + Vite Telegram Mini App (scaffold; built in gate M1D)
infra/        Docker Compose, Caddy, environment template
data/legacy/  private legacy shop documents — gitignored, never committed
.ai/          engineering operating system and project memory
```

## Running the backend locally

Requires Python 3.12+ and PostgreSQL 15 or newer (17 is what CI and production use —
`UNIQUE NULLS NOT DISTINCT` does not parse below 15, see
[ADR-0002](.ai/decisions/ADR-0002-catalog-identity-and-nullable-uniqueness.md)).

```bash
cd backend
python -m venv .venv
```

```bash
backend/.venv/Scripts/python.exe -m pip install -e ".[dev]"
```

Set the environment (copy `infra/.env.example`), then apply migrations and start the API:

```bash
backend/.venv/Scripts/python.exe -m alembic upgrade head
```

```bash
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

Create the first organization, its two stores, the default roles and an owner:

```bash
backend/.venv/Scripts/python.exe -m scripts.seed_organization --telegram-user-id 123456789
```

## Checks

Everything below runs in CI on every push, and all of it must pass.

```bash
backend/.venv/Scripts/python.exe -m ruff check . ; backend/.venv/Scripts/python.exe -m ruff format --check .
```

```bash
backend/.venv/Scripts/python.exe -m mypy app scripts
```

```bash
backend/.venv/Scripts/lint-imports.exe --config pyproject.toml
```

```bash
backend/.venv/Scripts/python.exe -m pytest -q
```

Database integration tests need a real PostgreSQL and are skipped without one. To run them,
set `BIRKA_TEST_DATABASE_URL` to a migrated test database. A skipped run is never evidence
that the database behaviour works.

## The rules that matter most

- PostgreSQL committed state is authoritative. Stock can never go negative.
- Every stock change is explained by a `StockMovement`; sale and stock effects commit atomically.
- Money is `NUMERIC` and `Decimal`, never a float. Historical sale lines never change.
- Raw human catalog input is immutable evidence; interpretation is stored beside it.
- An uncertain catalog match asks a human. It never silently merges two products.
- Authorization is server-side; a client-supplied store id is data to validate, not proof.
