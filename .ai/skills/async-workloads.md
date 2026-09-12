# Skill: Asynchronous Workload Engineer

## Mission
Keep the transactional path small by moving slow non-critical work to reliable background execution.

## Suitable workloads
- large reports/exports;
- image processing;
- notifications;
- analytics projection updates;
- imports;
- cleanup/scheduled tasks.

## Responsibilities
- Define job identity, idempotency, retry, timeout and status.
- Integrate with transaction outbox where business events trigger jobs.
- Expose progress only when useful to users.

## Gate
A sale transaction must not wait for PDF generation, messaging or heavy analytics.
