# M1-022: review queue and explicit rejection

Date: 2026-09-26. Baseline: `776464f` (durable matching PR #25 merged).
Status: review-queue/rejection backend increment implemented. Full M1-022
controlled alias learning and catalog UI remain incomplete.

## Delivered behavior

`GET /api/v1/catalog/match-decisions?store_id=...` lists outstanding PENDING and
NEEDS_REVIEW proposals, oldest first with UUID tie-break. Optional `status`
selects a historical state (including REJECTED/APPLIED). `limit` is 1..100,
default20; `offset` is 0..10000. The response has `items` and `has_more`.
Every result carries the previously saved preview rather than recalculating it.

`POST /api/v1/catalog/match-decisions/{id}/reject` accepts `{ "reason": "..." }`.
The reason must contain 1..1000 storable characters and cannot be whitespace-only;
its original formatting is preserved. It records REJECTED, the reviewer, exact
reason and one `catalog.match_rejected` audit event atomically. Existing raw input,
request, parse and preview are preserved. Response `rejection` contains `reason`
and `actor_user_id`; other decisions return null. `requires_confirmation` is now
true only for PENDING/NEEDS_REVIEW, false for both terminal statuses.

Same decision/reason retries return the existing result without another audit.
A changed rejection reason returns409; rejecting APPLIED or confirming REJECTED
returns409. A decision row lock serializes concurrent confirmation/rejection so
only one can succeed. Stale knowledge or a deleted candidate does not prevent
rejection, because rejection establishes no product identity. Processing remains
AMBIGUOUS: rejecting a proposal has not resolved its original input to a product.
A corrected/resubmitted input continues to use a new decision UUID.

All actions require `catalog:confirm` for the original store, scoped to the
organization from authentication. Queues are separate even between stores in
one organization. Inactive-store history remains readable; mutations require an
active store. No permissions were broadened.

## Learning boundary

Confirmation already retains predicted versus chosen variant and actor through
the previous increment. Rejection now adds explicit negative feedback on the
**proposal**. It does not prove that an alias is wrong: ambiguity may concern
attributes, model or source instead. Therefore this endpoint does not change
ProductAlias, AliasEvidence, evidence counts, knowledge revision, catalog identity,
stock or money. Controlled alias evidence/promotion remains a separate step with
an explicit target and calibrated policy; no automatic VERIFIED threshold was
invented. This is a partial M1-022 delivery, not completion of all learning work.

## Files and review

- `backend/app/modules/catalog/review.py`: queue and rejection service.
- `backend/app/modules/catalog/decisions.py`: terminal-state response and feedback.
- `backend/app/api/v1/catalog_decisions.py`: list/reject routes and schemas.
- `backend/tests/integration/test_catalog_review.py`: nine integration cases.
- Current milestone and this report: delivery status and evidence.

Independent read-only review found no blocking issue. Additional same-organization
store isolation, inactive-store and deleted-candidate cases were added following
review. No migration or schema change; the existing evidence JSON and audit table
store the rejection.

## Verification and remaining limits

Checks use Python3.12/SQLAlchemy2.0.54 and isolated PostgreSQL16.2 on port55442,
only disposable database `birka_review_queue`. No work databases or Docker
resources touched.

- `pytest -q --tb=short`: **706 passed**, no skips, 2 dependency deprecation
  warnings, 28.58 seconds (includes all nine new review tests).
- `mypy --no-incremental app scripts`: passed,75files.
- `ruff check .`: passed; `ruff format --check .`:134files formatted.
- `lint-imports`:12contracts kept,0broken.
- `git diff --check`:passed.

Offset pagination is stable for an unchanged queue. Concurrent resolution can
shift later pages; refresh from page1 to resynchronize. No performance budget or
large-catalog payload benchmark is claimed. PostgreSQL17/hosted CI and UI/E2E
remain unverified for this backend increment. Next work: explicit alias feedback
and promotion policy/evaluation, then catalog review UI and new-product intake.
