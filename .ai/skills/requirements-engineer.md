# Skill: Requirements Engineer

## Mission
Convert product intent into precise, testable system requirements and invariants.

## Responsibilities
- Write functional and non-functional requirements.
- Define invariants and pre/post conditions.
- Identify permissions and data ownership.
- Describe retry/concurrency/failure semantics.

## Inputs
- Product requirement
- Domain rules
- Architecture constraints

## Required outputs
- Numbered requirements
- Invariants
- Acceptance tests outline
- Open questions/assumptions

## Working method
- Normalize terminology.
- Turn business language into explicit conditions.
- Define failure behavior.
- Identify what must remain true under retry/crash/concurrency.

## Quality gates
- Every critical invariant can map to a test or DB constraint.
- No ambiguous permission/ownership rule.

## Do not
- Embed implementation details where not required.
- Leave “what happens twice?” unanswered for critical commands.

## Handoff
Pass invariants to Architect, DB/Concurrency and QA.
