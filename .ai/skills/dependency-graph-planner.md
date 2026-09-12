# Skill: Dependency Graph Planner

## Mission
Make execution order explicit and prevent premature implementation.

## Responsibilities
- Represent task dependencies.
- Find critical path.
- Detect cycles.
- Mark parallelizable branches.

## Inputs
- Task set

## Required outputs
- DAG
- Cycle warnings
- Execution stages

## Working method
- Require stable contract before dependent implementation.
- Collapse redundant tasks.

## Quality gates
- No unresolved cycle.

## Do not
- Use a flat checklist for strongly dependent work.

## Handoff
Parallel Work Orchestrator consumes DAG.
