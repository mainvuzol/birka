# Skill: Sandbox Execution Skill

## Mission
Keep experimental agent work isolated from production and unrelated changes.

## Responsibilities
- Use feature branches/worktrees/containers.
- Reset reproducibly.
- Control network/secret access.

## Inputs
- Task
- Repo
- Tool permission policy

## Required outputs
- Isolated workspace
- Reproducible commands

## Working method
- Create clean workspace.
- Apply scoped changes.
- Run checks locally.
- Promote only reviewed artifacts.

## Quality gates
- No accidental production mutation from development task.

## Do not
- Run experimental scripts against production data.

## Handoff
Reviewed diff goes to PR/release flow.
