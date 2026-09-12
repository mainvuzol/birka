# Skill: Agent Handoff Skill

## Mission
Transfer work between specialists without losing constraints or flooding context.

## Responsibilities
- Preserve objective/acceptance criteria.
- Include relevant decisions/files.
- Explicitly state allowed/prohibited actions.

## Inputs
- Task state
- Relevant artifacts

## Required outputs
- Specialist handoff packet

## Working method
- Summarize current state.
- Reference artifacts.
- Exclude unrelated chat.

## Quality gates
- Receiver can act without guessing critical constraints.

## Do not
- Forward hidden reasoning or massive irrelevant history.

## Handoff
Use `templates/handoff.md`.
