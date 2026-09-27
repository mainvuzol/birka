# Catalog family discovery — 2026-09-27

Status: implemented and verified locally against merged baseline `d7c412b` (PR #29); verification results below. No commit, push or merge by agent. Bounded next increment after reviewed product intake, not completion of all M1C.

## Behavior and architecture

Reviewers can now search existing product families beyond the proposal's candidate list before adding a variant. The form displays concept, source, category, garment and distinction note. Selection is explicit; searching, paging or receiving results never chooses a family. The selected family remains in the selector as searches change. Search failures/empty results preserve the structured draft. Enter in the search field searches without submitting the product form.

`GET /api/v1/catalog/families` requires both catalog:create and catalog:confirm for the active requested store. Every linked identity is restricted to the caller's organization; malformed cross-tenant references are excluded rather than shown as empty labels. Only active family/concept pairs appear. Families need neither stock nor variants to be discoverable. No variant join means independent same-name families remain separate and pagination has no variant-induced duplicates.

Search is literal substring over normalized concept/source names and distinction notes, with escaped `%`, `_`, and backslash. Names use casefold keys; free-form notes use PostgreSQL lowercase comparison, not full Unicode casefold. Empty query browses. Pages default to 20, maximum 50, with offset capped at 10000 and deterministic concept-name/family-UUID ordering. Concurrent catalog edits can shift offset pages; selections are always revalidated by the existing creation command.

TanStack Query cache includes organization/user/store journal scope, decision, query and page. Pending page loads disable selection. Existing transactional intake remains the authority for permissions, active state, identity and replay. This read-only search neither changes matcher thresholds nor merges models or touches stock/money. No migration.

## Changed files

- `backend/app/modules/catalog/search.py`: permission-scoped, tenant-safe discovery query.
- `backend/app/api/v1/catalog.py`: endpoint and typed response schema.
- `backend/tests/integration/test_catalog_search.py`: 15 tests covering authorization, inactive identities/store, linked tenant boundaries, literal search, labels, duplicates, variantless families and pagination.
- `frontend/src/catalog/FamilySearch.tsx`: search, pages, explicit choice, empty/error/loading states.
- `frontend/src/catalog/CreateProduct.tsx`, `Catalog.tsx`: selected search family and scoped token/cache wiring.
- `frontend/e2e/catalog.spec.ts`: real-API search outside original preview, no implicit selection, new variant in existing family, empty/failure draft preservation.

## Verification

- PostgreSQL 16.2, isolated `/tmp` runtime and databases, port 55442. Initial disposable C-locale database correctly exposed unsupported Cyrillic lowercase behavior; final tests use C.UTF-8, matching the required Unicode lowercase behavior in Compose/CI. Production ICU uk-UA PostgreSQL17 was not repeated in this increment.
- Full backend: **748 passed**, 37.81s; one dependency deprecation warning for Starlette httpx TestClient.
- New search integration tests: **15 passed**, 0.83s.
- Ruff clean; **141 files** format-clean; mypy `app scripts`: **78 files** passed.
- Import-linter: **12 contracts kept, 0 broken**.
- Fresh migrations through0014 passed; `alembic check`: **no new upgrade operations**.
- Frontend lint/typecheck/build passed.
- Mobile Chromium against real API/PostgreSQL: **23 passed**, 12.6s. Search screenshot inspected; horizontal overflow check passed.
- `git diff --check` clean.
- Independent architecture/security review: no actionable defects found.

Cleanup completed: the test API and isolated PostgreSQL are stopped; all three task test databases were dropped. Work databases, other projects, Docker and global packages were not changed.

## Limits and next increment

This is discovery for reviewed intake, not automatic identity resolution or full catalog editing. Identically labeled families still require human knowledge; no guessed merge is allowed. No benchmark on a large production catalog or live Telegram-device check is claimed. Verified alias promotion/evaluation, M1-023 snapshot import and later release work remain. These changes do not import previous stock; the owner's final opening-balance decision remains deferred.
