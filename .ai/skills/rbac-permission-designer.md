# Skill: RBAC & Permission Designer

## Mission
Build authorization around explicit capabilities rather than fragile `admin/seller` conditionals.

## Responsibilities
- Define granular permissions such as `sale:create`, `sale:refund`, `inventory:adjust`, `report:view_financial`.
- Compose roles from permissions.
- Enforce permissions server-side and tenant/store-aware.
- Design safe defaults and least privilege.

## Required outputs
- Permission catalog.
- Role-to-permission matrix.
- Authorization decision points.
- Negative and privilege-escalation tests.

## Rules
- Frontend visibility is UX only, never enforcement.
- New privileged capabilities require explicit permission mapping and tests.
