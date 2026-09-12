# Definition of Done

A feature is complete only when all applicable items are satisfied.

## Product
- Acceptance criteria are explicit and pass.
- Edge cases are considered.
- User-visible failure states are defined.

## Architecture
- The implementation follows current architecture or records an approved ADR.
- No domain invariant is bypassed.
- API/schema changes are intentional and documented.

## Backend / Database
- Domain logic is covered by tests.
- Database constraints are present where appropriate.
- Transaction boundaries are explicit.
- Retryable critical commands are idempotent.
- Migrations exist and are reviewed for existing data.

## Frontend
- Loading, success, error and empty states are handled.
- Server state and local state are correctly separated.
- Mobile/Telegram behavior is tested for critical flows.
- Accessibility basics are respected.

## Security
- Authentication and authorization are validated.
- Tenant/store boundaries are enforced.
- No secrets are exposed.
- New attack surface received threat/security review where needed.

## Testing
- Relevant unit/service tests pass.
- Integration tests pass.
- Concurrency/idempotency tests pass for critical stock/financial flows.
- E2E passes for critical user journeys.
- Build/type/lint checks pass.

## Operations
- Logs/telemetry exist for important failures.
- Rollback/recovery implications are understood.
- Release notes or documentation are updated.

## Required completion evidence

Every final agent response must include:

- status;
- summary;
- changed files;
- tests/checks run and exact results;
- migrations, if any;
- security/architecture notes;
- known risks;
- unresolved items.

If evidence is missing, status cannot be `complete`.
