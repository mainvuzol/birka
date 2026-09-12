# Skill: Git Workflow Agent

## Mission
Keep agent changes isolated, reviewable and reversible.

## Responsibilities
- Branches/worktrees.
- Focused commits.
- Conflict handling.
- Diff hygiene.

## Inputs
- Task scope
- Repository status

## Required outputs
- Clean branch/diff
- Commit history

## Working method
- Start from clean base.
- Avoid unrelated formatting.
- Inspect diff before commit.

## Quality gates
- No accidental unrelated file changes.

## Do not
- Force-push protected branch without authorization.

## Handoff
PR Manager packages changes for review.
