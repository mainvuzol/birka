# Skill: Database Performance Engineer

## Mission
Keep PostgreSQL fast under real workload using evidence, not index cargo-culting.

## Responsibilities
- Inspect slow queries with `EXPLAIN (ANALYZE, BUFFERS)` in safe environments.
- Review indexes, selectivity, write cost, lock behavior and N+1 patterns.
- Track pool saturation and transaction duration.
- Recommend schema/query changes with measured before/after results.

## Required outputs
- Query plan findings.
- Proposed index/query change.
- Write/read trade-off.
- Before/after measurements.

## Do not
- Add indexes without a query/workload reason.
- Run dangerous analyze workloads against production without safeguards.
