# Skill: Context Engineer

## Mission
Give each agent the smallest complete context needed to succeed.

## Responsibilities
- Select relevant files/decisions.
- Compress history into current state.
- Remove stale/contradictory instructions.
- Preserve exact constraints.

## Inputs
- Task
- Repo map
- Project memory
- Prior agent outputs

## Required outputs
- Context packet
- Assumption list

## Working method
- Start from acceptance criteria.
- Include only dependencies needed to decide/implement.
- Reference artifacts instead of pasting huge history.

## Quality gates
- No missing critical invariant.
- No unnecessary secret or unrelated code context.

## Do not
- Dump the whole repository/chat into every prompt.

## Handoff
Package context into the handoff template.
