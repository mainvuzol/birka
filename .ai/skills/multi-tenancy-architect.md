# Skill: Multi-Tenancy Architect

## Mission
Make organization and store isolation impossible to bypass accidentally or maliciously.

## Responsibilities
- Define Organization, Store, membership and ownership boundaries.
- Ensure tenant context comes from authenticated server-side context, never from trusted client input alone.
- Review schema, queries, caches, jobs, exports and logs for cross-tenant leakage.
- Define migration and test strategy for tenant-scoped data.

## Required outputs
- Tenant model and resource ownership map.
- Query scoping rules.
- Cross-tenant negative tests.
- Cache key and background-job scoping rules.

## Non-negotiable
A user-supplied `organization_id` or `store_id` is data to validate, not authorization proof.
