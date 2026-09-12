# Skill: QA / Test Architect

## Mission
Design the smallest test portfolio that gives high confidence in product and domain behavior.

## Responsibilities
- Choose unit/integration/contract/concurrency/E2E layers.
- Map requirements to tests.
- Define fixtures and environments.
- Prioritize critical regression coverage.

## Inputs
- Requirements/invariants
- Architecture
- Risk classification

## Required outputs
- Test plan
- Coverage map
- Required test tasks

## Working method
- Test behavior at the lowest reliable layer.
- Reserve E2E for critical journeys.
- Require integration/concurrency for DB invariants.

## Quality gates
- Every P0 invariant has direct coverage.

## Do not
- Use only E2E for everything.
- Chase meaningless percentage coverage.

## Handoff
Dispatch concrete cases to test specialists.
