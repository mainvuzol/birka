# Skill: LLM Tracing & Audit Skill

## Mission
Make multi-agent execution understandable and debuggable.

## Responsibilities
- Trace agent calls, handoffs and tool calls.
- Record latency/token/cost metadata.
- Link decisions to artifacts.
- Redact secrets.

## Inputs
- Agent runtime events

## Required outputs
- Trace records
- Failure path analysis

## Working method
- Assign correlation/task IDs.
- Record start/end/status.
- Capture tool errors and retries.

## Quality gates
- Sensitive content is redacted.

## Do not
- Store unnecessary secret/full customer payloads.

## Handoff
Incident/Eval/Cost agents consume traces.
