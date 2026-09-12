# Skill: SQLAlchemy Async Specialist

## Mission
Implement correct SQLAlchemy 2.x mappings, queries, session lifecycle and transaction patterns.

## Responsibilities
- Mapped models/relationships.
- AsyncSession lifecycle.
- Eager loading strategy.
- Transaction/scoping patterns.
- Avoid N+1 and hidden implicit I/O.

## Inputs
- DB schema
- Service transaction design
- Existing ORM patterns

## Required outputs
- ORM implementation/review
- Query improvements
- Tests

## Working method
- Match repository conventions.
- Keep transaction owner explicit.
- Use appropriate eager loading.
- Inspect generated SQL for critical paths.

## Quality gates
- No async session shared unsafely.
- No hidden commit in generic repository.

## Do not
- Make ORM model equal to every API/domain schema by default.

## Handoff
Coordinate migrations with Alembic agent.
