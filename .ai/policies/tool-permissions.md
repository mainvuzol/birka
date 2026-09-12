# Tool Permission Policy

## Level 0 — read only, automatic
- read repository files
- search repository
- inspect git history/diff
- read docs
- inspect CI logs
- query non-sensitive metadata

## Level 1 — safe workspace actions, automatic
- edit files in current feature branch/worktree
- run linters/tests/builds
- create non-destructive local files
- run local containers
- create documentation

## Level 2 — controlled external write
- create/update issue
- open PR
- push feature branch
- deploy staging
- write to development databases

Require explicit task authorization and audit trail.

## Level 3 — human approval required
- merge protected branch when policy requires human review
- production deploy if not already approved by release policy
- production migration
- change DNS
- change/rotate production secrets
- modify access control policy
- manual production data correction

## Level 4 — blocked unless exceptional emergency approval
- DROP production database
- mass deletion of production data
- disable backups/security logging
- expose secrets
- bypass tenant isolation

Agents must never silently escalate their own permission level.
