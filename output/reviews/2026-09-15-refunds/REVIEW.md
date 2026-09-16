# Review of PR13/14 — 2026-09-15

Range d85cc13..7f761c6. Reviewed refund command, input-validation changes, migration0004 and owner-decision documentation. Source working tree initially clean. No application code edited.

## Finding

[P2] Validation-error sanitization still fails for dictionary keys and nonfinite numbers. backend/app/main.py131-142: `_encodable` handles surrogate string values but copies dictionary keys with `str(key)` without sanitizing them, and returns all floats unchanged. JSONResponse cannot UTF-8 encode a lone-surrogate key or serialize NaN/Infinity with allow_nan=False.

Reproduced through actual catalog HTTP endpoint with a valid synthetic shop scope and otherwise valid product payload:
- sizes={"\ud800":1}: the expected list validation error reaches the handler, whose response raises UnicodeEncodeError.
- sizes=NaN in raw JSON: the validation response raises ValueError: Out of range float values are not JSON compliant.

These malformed requests should be422, but remain500 failures. This is an incomplete repair of the preexisting malformed-input issue, not evidence of incorrect refund arithmetic. Fix sanitation of both keys and values and nonfinite floats, preserving safe normal error details; add HTTP regression coverage. Reproducer saved temporarily in /tmp/birka-refund-review-validation.py. No stock or money changes occur in these rejected requests.

## Verified

Temporary PostgreSQL16.2/Python3.12 environment. From backend:
- BIRKA_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55439/postgres /tmp/birka-review-venv/bin/alembic upgrade head:0003→0004 successful.
- BIRKA_TEST_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55439/postgres /tmp/birka-review-venv/bin/pytest -q:354passed,0skipped,2existing dependency deprecation warnings.
- ruff check .:pass; ruff format --check .:90files; mypy app:55files; lint-imports:9kept/0broken. Executables from /tmp/birka-review-venv/bin.
- alembic check with the same database URL:no new upgrade operations.
- git diff --check:pass.

Independent refund reviewer found no actionable defects under configured READ COMMITTED isolation: sale-line locks precede cumulative refund totals, command replay is serialized, Decimal money derives from historical sale facts, mutations/audit are atomic, and migration0004 is additive/nullable. The reviewer did not rerun tests; the full suite above was independently run by the primary agent. Prior report's additional isolation-level experiments are not reproduced or independently endorsed here.

## Roadmap and scope

PR14 records requirements; it does not implement shared warehouses, separate child warehouse, blocked/archived states, explicit intact/damaged return condition, mixed conditions on one sale line, installments or purchase obligations. Refund code currently requires the original store, one entry per sale line and a restock boolean. This is a documented scope limit, not a hidden implementation of the new rules.

Before M1-018, agree stock-location/access design and migration preserving a single shared balance. Continue independent M1C work where possible, but do not claim owner refinements implemented. No new blocker found in the reviewed refund business invariants. Repair the P2 validation issue before full sign-off of the input-hardening change.

PostgreSQL17 and Docker Compose not run in this review; deployment readiness remains unverified. No frontend changes in reviewed commits. No production access, code edits, commits or pushes performed; only this review artifact added.
