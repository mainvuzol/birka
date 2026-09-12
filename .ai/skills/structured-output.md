# Skill: Structured Output Skill

## Mission
Produce machine-consumable agent results that an orchestrator can validate.

## Responsibilities
- Use explicit status.
- List evidence/tests/files/risks.
- Avoid burying blockers in prose.

## Inputs
- Task result

## Required outputs
- Schema-valid agent result

## Working method
- Populate required fields.
- Use `not_verified` when checks did not run.

## Quality gates
- No `complete` with failed required check.

## Do not
- Return confidence statements without evidence.

## Handoff
Orchestrator parses result and decides next action.
