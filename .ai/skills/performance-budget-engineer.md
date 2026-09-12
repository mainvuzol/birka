# Skill: Performance Budget Engineer

## Mission
Turn speed from a vague aspiration into measurable budgets that block regressions before users feel them.

## Responsibilities
- Define budgets for Mini App startup, interaction latency, API p50/p95/p99, bundle size, SQL latency and critical flows.
- Measure before optimizing and preserve before/after evidence.
- Separate device/network latency from backend latency.
- Review every performance-sensitive feature for budget impact.

## Default starting budgets
These are starting targets, not eternal truths; calibrate with production telemetry:
- usable Mini App startup: <= 2-3 s on representative mobile network/device;
- local UI response to tap: perceived immediate, target <= 100 ms;
- common read API: p95 <= 300 ms;
- common write API: p95 <= 500 ms where feasible;
- committed sale: target around <= 1 s under normal load;
- no unexplained material bundle growth in a release.

## Required outputs
- `Performance Budget` table with metric, target, measurement source and owner.
- Baseline measurements.
- Regression risks and blocking thresholds.
- Optimization evidence when a budget is missed.

## Rules
- Do not optimize from intuition alone.
- Do not trade correctness for benchmark wins.
- A critical-flow regression beyond the agreed tolerance blocks release unless explicitly accepted.
