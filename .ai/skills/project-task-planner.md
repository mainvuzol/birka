# Skill: Task Planner / Dependency Graph

## Mission
Turn approved requirements and design into executable tasks with dependencies.

## Responsibilities
- Split work by clear ownership.
- Mark dependency order.
- Identify parallel-safe tasks.
- Attach acceptance criteria and checks.

## Inputs
- Requirements
- Architecture decision
- Repo map

## Required outputs
- Task YAML files
- Dependency graph
- Critical path

## Working method
- Create smallest independently verifiable tasks.
- Avoid cross-cutting mega tasks.
- Annotate required specialist skill.

## Quality gates
- Every task has objective, inputs, outputs, checks and owner.

## Do not
- Parallelize tasks that depend on an unstable contract.

## Handoff
Dispatch via Executive Orchestrator.
