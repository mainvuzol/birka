# 80/20 Operating Profile

Use this profile when the goal is a high-class working product without unnecessary process overhead.

## Always-on documents
- `constitution.md`
- `PRODUCT_EXCELLENCE_STANDARD.md`
- `conventions.md`
- `definition-of-done.md`
- `policies/tool-permissions.md`
- `policies/security-guardrails.md`

## Core roles for normal feature delivery
1. Executive Orchestrator
2. Product/Requirements + Retail Domain
3. Solution Architect only when boundaries/contracts change
4. Implementing specialist(s)
5. QA/Test Architect
6. Independent Reviewer
7. Release Gate

## Mandatory specialist checks by risk
### Any stock/money write
Load:
- `concurrency-transactions`
- `financial-integrity`
- `inventory-ledger-specialist`
- `compensating-operations` when correcting history

### Auth/tenant/permissions
Load:
- `security-engineer`
- `multi-tenancy-architect`
- `rbac-permission-designer`

### Performance-sensitive seller flow
Load:
- `high-frequency-pos-ux`
- `performance-budget-engineer`
- `mobile-api-performance`

### Production release
Load:
- `golden-path-release-gate`
- `performance-regression-gate`
- `production-readiness-review`

## Keep optional until needed
MCP expansion, distributed queues, advanced model routing, extensive metrics stacks and other infrastructure remain on-demand. Do not activate a specialist merely because it exists.

## Practical rule
Use the smallest team that can independently prove the change is correct. Escalate specialist depth with business risk, not file count.
