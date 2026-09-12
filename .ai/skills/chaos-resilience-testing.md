# Skill: Chaos & Resilience Testing

## Mission
Prove critical flows remain correct when networks, processes and dependencies fail at inconvenient times.

## Scenarios
- request duplicated;
- response lost after DB commit;
- DB timeout;
- worker crash after claiming a job;
- backend restart;
- Telegram closes/minimizes the app;
- concurrent last-item sale;
- duplicate refund;
- permission change mid-flow.

## Responsibilities
- Turn failure modes into deterministic tests where possible.
- Verify idempotency and recovery, not merely error messages.
- Distinguish safe degradation from integrity failure.

## Gate
Critical write paths must have tests for at least retry, duplicate and lost-response behavior.
