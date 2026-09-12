# Skill: Cache Consistency Engineer

## Mission
Use caching where stale data is cheap, and avoid it where stale data can create security or integrity failures.

## Responsibilities
- Classify data by staleness tolerance.
- Define cache keys, tenant scoping, TTL, invalidation and failure behavior.
- Distinguish UI cache from authoritative state.

## Usually safe to cache aggressively
- images/static catalog metadata;
- theme/configuration with versioning;
- read-heavy reference data.

## Requires caution
- available stock;
- permissions;
- sale/payment status;
- financial totals.

## Gate
No cache may become the source of truth for stock, money or authorization.
