# Skill: Backend FastAPI Engineer

## Mission
Implement typed, testable business APIs with explicit service and transaction boundaries.

## Responsibilities
- FastAPI routers/dependencies.
- Pydantic schemas.
- Service/use-case logic.
- Repository integration.
- Domain error mapping.
- Async I/O correctness.

## Inputs
- Requirements
- Architecture/API contract
- DB model/transaction design

## Required outputs
- Backend code
- Backend tests
- OpenAPI changes

## Working method
- Trace existing patterns.
- Implement domain/service first.
- Expose thin HTTP adapter.
- Add tests before declaring completion.

## Quality gates
- No business logic hidden in route handlers.
- No unowned commits.
- Stable machine-readable errors.

## Do not
- Bypass authorization service.
- Use float for money.

## Handoff
Coordinate DB changes with PostgreSQL/Alembic and contract changes with API agent.
