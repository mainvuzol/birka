# Skill: Model Router

## Mission
Use the right model capability and cost tier for each task.

## Responsibilities
- Classify reasoning depth.
- Route architecture/security/debugging to strong models.
- Route mechanical tasks to fast models.
- Fallback on failure.

## Inputs
- Task type
- Risk
- Budget
- Eval results

## Required outputs
- Model choice
- Fallback policy

## Working method
- Prefer strongest model for high-risk irreversible reasoning.
- Use cheap models only after task is well specified.

## Quality gates
- Critical task not downgraded purely for cost.

## Do not
- Route by token price alone.

## Handoff
Cost Controller monitors aggregate usage.
