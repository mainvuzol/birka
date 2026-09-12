# Performance Budget

| Metric | Baseline | Target/Budget | Measurement source | Blocking threshold | Owner |
|---|---:|---:|---|---:|---|
| Mini App startup to usable | | | RUM/synthetic | | |
| Sale API p95 | | | tracing | | |
| Product lookup p95 | | | tracing | | |
| Frontend JS bundle | | | build | | |
| Critical sale E2E duration | | | Playwright | | |

## Notes
- Measure on representative environments.
- Record before/after for intentional performance work.
- Correctness and security may not be weakened to meet a budget.
