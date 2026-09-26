# M1-022: explicit alias evidence

Date: 2026-09-26. Baseline: `2e3272e`, review queue/rejection merged in PR #26.
Status: explicit evidence collection implemented and verified locally. Full
M1-022 remains partial: verified promotion requires evaluation and a reviewed
policy. No push, production migration or deployment performed.

## API and evidence rules

`POST /api/v1/catalog/match-decisions/{id}/alias-feedback` accepts:

```json
{
  "feedback_id": "client-generated UUID",
  "variant_id": "explicitly selected variant UUID",
  "event": "CONFIRM"
}
```

`event` is CONFIRM or REJECT. The original decision store supplies authorization
context (`catalog:confirm`, active store); organization comes from authentication.
The phrase is derived exclusively from immutable raw input, using casefold and
whitespace collapse, identical to matcher normalization. It must normalize to
1..200 characters; longer input is rejected with422, never truncated or split.
The original raw input is unchanged. No arbitrary phrase or organization can be
injected through this endpoint.

CONFIRM requires an APPLIED decision and its actual resolved variant. REJECT
requires an APPLIED or REJECTED decision, an explicitly selected original preview
candidate and a target different from any resolved variant. Rejecting a whole
proposal never implicitly creates alias rejection evidence. Both events require
a current active variant and valid active/tenant-linked identity chain. Missing
or unavailable targets require fresh review; no dangling aliases are learned.

The response returns immutable event identifiers and the alias's current
normalized phrase, counters and status. Replaying the same UUID/decision/target/
event creates nothing. Its returned statistics may reflect subsequent evidence.
Changing that UUID's payload yields409. A different UUID for the same decision
and alias also yields409; one reviewed decision cannot inflate a mapping's count
or replace its previous event. Original actor/event stay in append-only
AliasEvidence. Evidence, count/status changes and audit commit together.

## Conservative policy

- Positive observations enter LEARNING, never automatically VERIFIED.
- Negative-only observations become REJECTED; mixed evidence becomes AMBIGUOUS.
- Competing positive mappings for one phrase become AMBIGUOUS across target
  types, including existing VERIFIED mappings. Such feedback can reduce trust.
- Historical AMBIGUOUS remains ambiguous until a future explicit resolution
  workflow. Legacy VERIFIED rows with zero counters retain their historical
  conflict after demotion and further observations.
- Consistent existing VERIFIED rows may retain their status. This service never
  creates VERIFIED authority or lowers human-confirmation requirements.

Counters represent observations, not independent people or statistically
independent examples. New decision UUIDs may reflect repeated observations; raw
provenance is retained for evaluation. No promotion threshold is invented.
Learning/rejected/ambiguous aliases do not become strong matcher candidates.
No product identity, inventory or financial facts are changed.

## Transactions, review and migration

Feedback executes as its own request after decision confirmation. It does not
reuse confirmation's transaction/revision SHARE lock. Lock order is feedback
command, variant KEY SHARE, normalized phrase, existing alias rows in UUID order,
then writes; the existing catalog trigger advances knowledge revision. Phrase
serialization protects updates across competing targets. Revision, counters,
evidence and audit roll back together.

Migration `0014_alias_feedback_identity` adds a partial unique index on
`(alias_id, decision_id)` for non-null decisions. It refuses duplicate historical
pairs with an explicit error rather than rewriting append-only evidence. Upgrade
requires a short alias_evidence write lock. Downgrade removes only the index and
preserves evidence; stop the new feedback API before downgrading its protection.
Apply with `alembic upgrade head` before using the endpoint.

Independent review found a legacy VERIFIED/zero-counter mapping could lose its
ambiguity on later feedback. Fixed and covered for VARIANT, FAMILY and CONCEPT
mappings. No remaining blocking finding in static review. Concurrent external
maintenance that ignores application lock ordering remains outside the supported
request workflow.

## Changed files

- `backend/app/modules/catalog/feedback.py`: service, validation and evidence policy.
- `backend/app/modules/catalog/evidence.py`: unique-index model definition.
- `backend/app/api/v1/catalog_decisions.py`: feedback route and response schemas.
- `backend/migrations/versions/0014_alias_feedback_identity.py`: migration.
- `backend/tests/integration/test_catalog_feedback.py`: 14 integration cases.
- `backend/tests/unit/test_migration_history_is_frozen.py`: pin shipped0013.
- Current milestone and this report: delivery status.

## Verification

Python3.12, SQLAlchemy2.0.54, isolated PostgreSQL16.2 on port55442; only disposable
`birka_alias_check` and `birka_alias_migration` databases used.

- `pytest -q --tb=short`: **721 passed**, no skips, 2 dependency deprecation
  warnings,30.91seconds. Includes all14 feedback cases and prior regressions.
- `mypy --no-incremental app scripts`: passed,76source files.
- `ruff check .`: passed; `ruff format --check .`:137files formatted.
- `lint-imports`:12contracts kept,0broken.
- Empty upgrade head → downgrade base → upgrade head: passed.
- `alembic check`: no schema drift.
- Duplicate-history fixture at0013: upgrade refused; both append-only evidence
  rows and migration version retained unchanged.
- `git diff --check`:passed.

Temporary databases removed and isolated server stopped after verification.
No system installation, work database or Docker resource modified.

## Remaining work

Hosted CI/PostgreSQL17 and UI/E2E were not rerun for this backend increment.
Large-catalog performance, calibrated verified promotion and ambiguity resolution
remain unimplemented/unmeasured. Next practical step is a catalog review UI using
the existing queue, explicit confirmation/rejection and this opt-in evidence API;
collect human-reviewed data before enabling stronger automation. New-product
intake and snapshot import remain separate roadmap items.
