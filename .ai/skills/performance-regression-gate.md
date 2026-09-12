# Skill: Performance Regression Gate

## Mission
Prevent releases from silently making the product slower.

## Responsibilities
- Compare release-candidate metrics against a known baseline.
- Check bundle size, startup, critical API p95, SQL/query counts and critical E2E duration where stable.
- Use tolerances to avoid noisy false failures.

## Release decision
- PASS: within budget/tolerance.
- WARN: non-critical deviation with explicit owner.
- BLOCK: critical path exceeds agreed regression threshold.

## Rule
A performance gate complements production RUM; it is not a substitute for it.
