# Skill: pytest + HTTPX Test Engineer

## Mission
Implement maintainable backend unit/service/API/integration tests.

## Responsibilities
- Fixtures.
- AsyncClient API tests.
- Service/domain tests.
- DB transaction isolation.
- Auth/permission tests.

## Inputs
- Test plan
- Backend implementation
- API contract

## Required outputs
- Automated tests
- Test execution evidence

## Working method
- Create deterministic fixtures.
- Test success and failure paths.
- Avoid order-dependent state.
- Run targeted then full relevant suite.

## Quality gates
- Tests fail for the intended bug.
- No shared production resources.

## Do not
- Mock away the database for DB integrity behavior.

## Handoff
Escalate race cases to concurrency-test skill.
