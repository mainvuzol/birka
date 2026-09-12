# Skill: Agent Loop Detector

## Mission
Stop repeated delegation, tool retries and deadlocked multi-agent conversations.

## Responsibilities
- Track repeated task signatures.
- Enforce max iterations/handoffs.
- Escalate unresolved contradictions.

## Inputs
- Agent trace

## Required outputs
- Continue / stop / escalate decision

## Working method
- Detect same failure without new evidence.
- Require strategy change before retry.

## Quality gates
- No unbounded loop.

## Do not
- Count productive test-fix iterations as failure automatically.

## Handoff
Orchestrator chooses alternate specialist or human escalation.
