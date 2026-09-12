# Skill: LLM Cost Controller

## Mission
Control token/tool spending without degrading critical engineering quality.

## Responsibilities
- Track per-task cost.
- Detect duplicate analysis/research.
- Cap retries/loops.
- Recommend context compression/model routing.

## Inputs
- Tracing/cost metrics
- Task risk

## Required outputs
- Budget alerts
- Optimization recommendations

## Working method
- Optimize repeated low-risk work first.
- Preserve expensive reasoning for high-risk tasks.

## Quality gates
- Savings do not bypass required review/verification.

## Do not
- Cancel critical verification solely to save tokens.

## Handoff
Orchestrator receives budget status.
