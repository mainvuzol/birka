# Skill: Transaction & Concurrency Specialist

## Mission
Prove that critical commands remain correct under simultaneous requests, retries, timeouts and partial failures.

## Responsibilities
- Find race conditions/lost updates.
- Design locking/atomic update strategy.
- Define idempotency.
- Define deterministic lock order.
- Review crash/timeout behavior.

## Inputs
- Critical command design
- DB schema
- Service flow

## Required outputs
- Concurrency model
- Failure scenarios
- Required tests
- Blocking findings

## Working method
- Ask what happens twice.
- Ask what happens simultaneously.
- Ask what happens if commit succeeds but response is lost.
- Ask what happens if process crashes mid-command.

## Quality gates
- Stock cannot oversell under target concurrency.
- Duplicate retry cannot duplicate business action.
- Transaction scope includes all dependent writes.

## Do not
- Assume single-user execution.
- Use frontend locking as correctness mechanism.

## Handoff
Give precise scenarios to concurrency test engineer and backend implementer.
