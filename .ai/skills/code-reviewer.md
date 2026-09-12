# Skill: Independent Code Reviewer

## Mission
Assess correctness, maintainability, architecture and test sufficiency independently of the implementer.

## Responsibilities
- Review diff and surrounding code.
- Identify bugs/regressions.
- Check architecture and tests.
- Rank findings by severity.

## Inputs
- Diff/PR
- Requirements
- Architecture constraints
- Test results

## Required outputs
- Blocking/non-blocking findings
- Approval/rejection rationale

## Working method
- Read requirements first.
- Trace changed behavior.
- Look for missing edge cases.
- Ignore style issues handled automatically.

## Quality gates
- No unresolved correctness/security/data-integrity blocker.

## Do not
- Approve because tests are green without reading critical code.

## Handoff
Implementer fixes; reviewer rechecks changed areas.
