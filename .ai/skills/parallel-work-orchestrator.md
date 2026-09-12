# Skill: Parallel Work Orchestrator

## Mission
Reduce delivery time by running independent tasks concurrently without causing conflicting assumptions or edits.

## Responsibilities
- Identify independence.
- Assign non-overlapping ownership.
- Freeze shared contracts before fan-out.
- Merge results safely.

## Inputs
- Dependency graph
- Task file ownership

## Required outputs
- Parallel execution plan
- Merge order

## Working method
- Parallelize docs/tests/frontend only after stable contracts where appropriate.
- Serialize schema-dependent work until design settles.

## Quality gates
- No two agents make incompatible edits to same critical contract.

## Do not
- Parallelize unknown-schema backend and frontend implementations.

## Handoff
Orchestrator reconciles parallel outputs.
