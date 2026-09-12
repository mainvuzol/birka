# Skill: Transaction Outbox Engineer

## Mission
Keep business truth atomic while making notifications, analytics, webhooks and background side effects reliable.

## Responsibilities
- Use the same database transaction to write business state and an outbox event.
- Design event identity, type, payload version, retry and delivery status.
- Make consumers idempotent.
- Ensure a failed external side effect can be retried without rolling back committed business truth.

## Canonical flow
`BEGIN -> business writes -> outbox insert -> COMMIT -> worker delivers -> mark delivered`

## Use for
- sale notifications;
- analytics updates;
- webhooks;
- report generation triggers;
- integrations that must not run inside the critical sale transaction.

## Required outputs
- Event schema and ownership.
- Producer transaction boundary.
- Retry/backoff and dead-letter policy.
- Consumer idempotency strategy.
- Operational queries for stuck events.

## Do not
- Call unreliable external services inside a critical DB transaction.
- Introduce Kafka or distributed infrastructure unless measured requirements justify it.
