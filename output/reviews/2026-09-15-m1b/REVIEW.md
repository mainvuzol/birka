# Independent M1B review — 2026-09-15

Reviewed main64bf25d, new product-creation changes since1683dfb. Working tree was clean; both previous fixes and product creation are merged locally. No source code changed during this review.

Status: roadmap alignment confirmed; M1B sign-off pending two P2 validation fixes and separately tracked Compose execution evidence.

## Findings

1. P2 — Unsupported product identity fields are silently discarded. `backend/app/api/v1/catalog.py:50-64` uses Pydantic default extra=ignore, as do ProductRequest and SizePayload. Confirmed through HTTP with synthetic data: two requests pointing at the same family, with variant.attributes.hood=true and false, both return201 and the SAME product_variant_id. The persisted attributes are {}. This loses explicitly supplied distinctions; unsupported descriptors must be rejected rather than silently accepted. Minimal fix: extra=forbid on catalog request and nested payload schemas, with HTTP regressions. Implementing flexible attributes is not required to close this finding.

2. P2 — Whitespace-only distinction bypasses the NEW_MODEL explanation. `backend/app/api/v1/catalog.py:94,113` and `backend/app/modules/catalog/service.py:657` check truthiness, not meaningful content. Actual HTTP: existing named product followed by new_model=true, distinction_note='   ' returns201 with a NEW family ID; stored note remains three spaces. Trim and require nonempty content at API and service boundaries. Add regression proving refusal creates no second family.

Independent catalog reviewer confirmed both issues; root reproduced them through actual ASGI HTTP calls and persisted PostgreSQL rows. No new concurrency defect found in the reviewed creation path.

## Verification

Temporary Python3.12 environment /tmp/birka-review-venv and PostgreSQL16.2 review cluster. Commands from backend:

- BIRKA_TEST_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55439/postgres /tmp/birka-review-venv/bin/pytest -q — 278passed,0skipped,2existing dependency deprecation warnings.
- /tmp/birka-review-venv/bin/ruff check . — pass.
- /tmp/birka-review-venv/bin/ruff format --check . —84files formatted.
- /tmp/birka-review-venv/bin/mypy app —52source files pass.
- /tmp/birka-review-venv/bin/lint-imports —8kept,0broken.
- BIRKA_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55439/postgres /tmp/birka-review-venv/bin/alembic check — no new upgrade operations.
- Extra reproduction: /tmp/birka-review-new-catalog.py, using existing lifecycle-test HTTP fixtures and synthetic records. Results: blank distinction201/new family; hood true/false201/201/same variant; stored note='   ', attributes={}.

The prior implementation report records PostgreSQL17.9 on another environment; this review independently ran16.2 and does not claim a17rerun. Docker is unavailable on this host; Compose startup remains NOT VERIFIED. No new migration in PR11. Frontend unchanged by PR11; not rerun here. No production changes or push performed.

## Next

Fix the two validation findings and rerun relevant plus full tests. Execute the Compose startup/migration/health smoke check in a Docker-capable environment before claiming deployment readiness. Then proceed to M1C per roadmap. When M1C introduces merge/review states, unify lifecycle checks on explicit-family and named-concept paths; currently this is not reachable through M1B writes.
