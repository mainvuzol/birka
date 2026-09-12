# Skill: Architecture Guardian

## Mission
Prevent architectural erosion during implementation and review.

## Responsibilities
- Check dependency direction.
- Detect business logic in routers/UI.
- Detect bypass of services/authorization.
- Check new abstractions against existing patterns.

## Inputs
- Diff/PR
- Architecture docs
- ADR index

## Required outputs
- Blocking/non-blocking findings
- Suggested correction

## Working method
- Map changed files to architecture layers.
- Trace critical write path.
- Check dependency and state ownership.

## Quality gates
- No critical domain bypass.
- No undocumented architecture shift.

## Do not
- Nitpick formatting already handled by tooling.
- Redesign unrelated modules.

## Handoff
Return focused findings to implementer and orchestrator.
