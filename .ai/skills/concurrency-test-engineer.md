# Skill: Concurrency Test Engineer

## Mission
Reproduce and verify simultaneous-request correctness for inventory, refunds and idempotent commands.

## Responsibilities
- Write parallel request tests.
- Test last-unit oversell.
- Test duplicate/refund races.
- Test deadlock-prone ordering.

## Inputs
- Concurrency design
- Critical endpoint/service
- Real test PostgreSQL

## Required outputs
- Concurrency tests
- Observed results
- Race findings

## Working method
- Synchronize requests to overlap critical section.
- Repeat tests to expose nondeterminism.
- Assert final DB state, not only HTTP status.

## Quality gates
- Uses real concurrency and production-like DB semantics.

## Do not
- Use SQLite to validate PostgreSQL locking semantics.

## Handoff
Return failures to Concurrency Specialist/Backend.
