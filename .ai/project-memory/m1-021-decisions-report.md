# M1-021: durable proposals and existing-variant confirmation

Date: 2026-09-26. Baseline: `2a62232` (preview PR #24 merged).
Status: this backend increment implemented and verified locally. Full M1C and
catalog intake/review UI are not complete. No push or deployment performed.

## Behavior and API

- `POST /api/v1/catalog/match-decisions` accepts `decision_id` (client UUID),
  `store_id`, exact `raw_text`, optional `family_id`, `concept_name` and
  `business_category_name`. It atomically saves RawInput, ParseResult,
  RawInputProcessing, CatalogMatchDecision and an audit event.
- Retrying the same UUID and exact payload returns the saved decision. Reusing
  the UUID with a changed payload returns 409. Repeating text with a new UUID
  deliberately creates a new piece of evidence. Current permissions are always
  checked before replay. Foreign decisions are not disclosed.
- `GET /api/v1/catalog/match-decisions/{id}` returns the saved state and original
  preview. Historical reads remain available for inactive stores to authorized
  users; writes require an active store.
- `POST /api/v1/catalog/match-decisions/{id}/confirm` takes `variant_id` and
  `expected_knowledge_revision`. It explicitly resolves an existing active
  variant, checks tenant-linked identity and any selected family, records the
  actor/audit, and marks processing RESOLVED. It creates no product, alias,
  stock movement or financial fact.
- All endpoints require `catalog:confirm` in the source store. Organization is
  derived from authenticated scope, not client data.
- Unknown/ambiguous proposals may be resolved through an explicit manual
  variant choice. This human choice may correct parser/lexical attributes or
  name/category context; an explicitly selected family must still match.
  Original prediction, raw input, conflicts and candidates remain in the saved
  preview. No automatic matching or alias promotion is introduced.
- A stale revision returns domain 409 (`CATALOG_AMBIGUOUS`); create a new proposal
  with a new UUID, review it and confirm its revision. An already applied
  decision retries successfully with its original variant/revision even if the
  catalog subsequently changes. A different resolution returns 409.

## Knowledge revision and concurrency

Migration `0013_catalog_knowledge` adds an organization revision row and database
triggers for category, garment type, concept, source, attribute term, family,
variant and alias changes. Changes and their increments commit/rollback together.
Old/new organizations are invalidated on reassignment. Revision is an invalidation
counter, not a count of business events; even conservative invalidations are safe.
The matcher reads the revision in the same SQL snapshot as its candidates.

Confirmation protects selected and original top variant keys in UUID order,
then locks the decision, then takes a SHARE lock on the revision and revalidates.
Creation similarly protects its top-candidate FK and checks the revision before
saving. Concurrent deletion yields a controlled conflict rather than a dangling
FK/500. Replays and concurrent confirmation cannot duplicate the applied audit.
This relies on the project's default PostgreSQL READ COMMITTED isolation.

Independent static review identified deletion/confirmation lock inversion and a
candidate deletion race during proposal creation. Both were fixed, re-reviewed
and covered by real database regression tests.

The request and original full preview are stored as a named JSON envelope in
`CatalogMatchDecision.field_scores`; existing score columns retain rounded
Decimal summaries. RawInput remains protected by the existing append-only DB
trigger. No historical decision migration/rewrite is needed.

## Migration / rollback

Run `alembic upgrade head` before using the new endpoints. Installation locks
catalog tables against writes while backfilling and attaching triggers; plan a
maintenance window for a large catalog. Existing organization counters begin
above all their persisted decision revisions, so partial downgrade/re-upgrade
cannot accidentally revive an old decision. New organizations start at zero.
Downgrade removes only the revision table/triggers/functions and retains saved
raw/parse/decision/audit evidence; the new API must not run while downgraded.

## Changed files

- `backend/app/modules/catalog/decisions.py`: persistence, authorization, replay,
  explicit confirmation and audit.
- `backend/app/modules/catalog/knowledge.py`, `models.py`: revision model/lock.
- `backend/app/modules/catalog/matching.py`: revision in retrieval snapshot.
- `backend/app/api/v1/catalog_decisions.py`, `catalog_matching.py`, `router.py`:
  endpoints and explicit response contracts.
- `backend/migrations/versions/0013_catalog_knowledge.py`: revision foundation.
- `backend/tests/integration/test_catalog_decisions.py`,
  `test_catalog_knowledge.py`: 23 new integration cases, including concurrency.
- `backend/tests/unit/test_migration_history_is_frozen.py`: pin shipped 0012.
- Current milestone and this report: delivery state and verification evidence.

## Verification

Python 3.12, SQLAlchemy 2.0.54, isolated PostgreSQL 16.2 on port 55442; only
`birka_decisions_check` and `birka_decisions_migration` were used.

- Full `pytest -q --tb=short`: **697 passed**, no skips, 2 dependency deprecation
  warnings, 49.65 seconds.
- New decision/knowledge suites: **23 passed**, 4.70 seconds.
- `mypy --no-incremental app scripts`: success, 74 source files.
- `ruff check .`: passed; `ruff format --check .`: 132 files formatted.
- `lint-imports`: 12 contracts kept, 0 broken.
- Empty database upgrade → downgrade base → upgrade head: passed.
- `alembic check`: no schema drift.
- Populated partial downgrade to 0012, catalog edit, re-upgrade: original
  evidence retained, revision advances past persisted decision, stale confirmation
  correctly rejected; subsequent drift check clean.
- `git diff --check`: passed.

## Limits and next work

No PostgreSQL 17/hosted CI or frontend/E2E run is claimed for this increment.
Large-catalog latency and write contention from a per-organization counter have
not been benchmarked. Concurrent maintenance TRUNCATE is outside the supported
request workflow: stop application writes/confirmations before maintenance;
its trigger invalidates revisions but does not promise freedom from lock cycles.
Category/garment inactive flags retain existing service semantics; variant,
family, concept and referenced attribute terms must be active to confirm.

Next: review queue and explicit rejection/feedback (M1-022), then controlled
new-product intake via the existing structured creation service, confirmation
UI and snapshot import. Alias promotion/automation still require reviewed
policy and evaluation data; they are not enabled by this increment.
