# Skill: Request & Operation Correlation

## Mission
Make one user action traceable through frontend, API, database, outbox, worker, bot and error monitoring.

## Responsibilities
- Generate/propagate `request_id` and stable business `operation_id` where needed.
- Put correlation fields in structured logs, Sentry/traces and asynchronous events.
- Never use secrets or PII as correlation keys.

## Required outputs
- Header/field convention.
- Propagation map.
- Logging/tracing examples.
- Investigation runbook using an ID.
