# Catalog review UI

Date: 2026-09-26. Baseline: `087d3c5`, alias evidence PR #27 merged.
Status: first catalog review UI increment implemented and verified locally.
No push, deployment or migration performed. This does not complete all M1D.

## Delivered user flow

The store workspace now includes Каталог for users with `catalog:confirm`.
It uses the existing backend contracts and authentication; server authorization
remains authoritative. The header now describes the general store workspace.

- Store-scoped open queue, APPLIED/REJECTED history, pagination, empty/loading/
  error states and refresh.
- New raw description up to2000characters, preserved exactly on submission.
- Original text, original candidate names/distinction notes, translated conflict
  warnings and review reasons; no preselected variant or probability claims.
- Explicit existing-variant confirmation against the saved knowledge revision.
- Rejection with a reason and visible rejection history.
- Optional, separate alias CONFIRM after an applied decision; explicit candidate
  selection for alias REJECT. No feedback is sent merely by confirming/rejecting
  the proposal, and no automatic VERIFIED promotion is enabled.

A stale409 explains the need to create/review a fresh proposal. It does not
silently refresh candidate identity or copy incomplete context. New-product
creation from the intake form and choosing outside the saved candidate pool are
not delivered here. Existing catalog services still support structured creation.

## Retry / safety behavior

A separate catalog journal in localStorage is scoped by organization, user and
store. Exact payload and decision/feedback UUID are saved before sending.
Reopening restores the pending operation and opens Catalog. Navigation/new
operations remain blocked while the outcome is uncertain. The orders journal
remains independent; both are checked before allowing another mutation.

The journal validates scope, allowed endpoint, UUIDs and request shape. Before
non-create mutations, a read verifies the target belongs to the selected store.
Recovery validates original raw text or final variant/revision/rejection reason.
The final response identity/store are checked before clearing the journal.

First definitive4xx rejection leaves the draft editable. A network failure,
failed follow-up read or access failure after an uncertain attempt retains the
journal; it is never silently discarded. Retrying feedback uses its original
UUID. Corrupt/unreadable storage fails closed with support guidance. The journal
contains raw catalog text and pending payloads until completion, never tokens.

## Changed files

- `frontend/src/catalog/Catalog.tsx`: queue, intake, detail, confirmation/rejection,
  opt-in feedback and local state.
- `frontend/src/catalog/commands.ts`: validated durable retry journal.
- `frontend/src/catalog/types.ts`: API types and user-facing labels.
- `frontend/src/App.tsx`: permission-gated navigation and journal coordination.
- `frontend/src/styles.css`: wrapping and catalog evidence/candidate styles.
- `frontend/e2e/catalog.spec.ts`: eight new focused browser scenarios.
- Current milestone and this report: delivery state/evidence.

No backend contract, schema, permission grant or dependency change. No migration.

## Verification

Synthetic signed Telegram launch, real FastAPI API on localhost58042 and isolated
PostgreSQL16.2 on port55442, only disposable `birka_orders_ui`. Existing typed
seed fixture was reused unchanged. Browser: Playwright mobile Chromium/Pixel7.

- `npm run lint`:passed.
- `npm run typecheck`:passed.
- `npm run build`:passed; production JS approximately243kB,77kB gzip.
- `npm run test:e2e -- --reporter=line`: **15 passed in8.9s**, eight new catalog
  scenarios plus all seven existing order/Telegram regression scenarios.
- Covered explicit selection/opt-in feedback, rejection/history, stale revision
  through real catalog mutation, denied navigation, lost proposal/feedback
  responses across reopening, same-UUID replay, wrong-store preflight and
  uncertainty retained across later403 before recovery.
- Mobile overflow assertion passed; full-page screenshot inspected for layout.
- `git diff --check`:passed.

Artifacts: `output/verification/2026-09-26-catalog-ui/` contains the E2E log and
mobile screenshot (local verification output).

Independent static review found recovery needed stronger scope/payload checks;
these were added, including final response identity validation. Final review
reported no blockers. Early browser failures were test-selector mismatches with
the rejection prefix and automatic opening of a pending catalog operation;
corrected to assert the intended user-visible behavior.

Cleanup: task API stopped, task database dropped, isolated PostgreSQL stopped.
No work database, Docker image or unrelated project modified.

## Limits / next step

Real Android/iOS Telegram webviews, hosted CI/PostgreSQL17 and production have
not been exercised for this increment. Backend source was unchanged, so its full
721-test suite was not rerun; real API migration/flows were exercised by E2E.
Multiple independent browser tabs are not globally coordinated (same limit as
orders). Uncertain operations that cannot be reconciled after loss of access need
support; do not clear browser storage. Offset pages may shift under concurrent
queue updates. Previously recorded alias feedback reports a duplicate conflict;
a dedicated evidence-history UI is not yet present.

Next: controlled creation of a new product from reviewed input, preserving
context/distinction requirements, then snapshot import. Alias promotion and
ambiguity resolution still require a reviewed policy and evaluation data.
