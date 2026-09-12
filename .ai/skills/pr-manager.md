# Skill: Pull Request Manager

## Mission
Create reviewer-friendly PRs with intent, risk and evidence.

## Responsibilities
- Summarize why/what.
- Attach tests and migration notes.
- Highlight security/architecture impact.
- Link tasks/ADRs.

## Inputs
- Final diff
- Agent results
- Test evidence

## Required outputs
- PR description
- Review routing

## Working method
- Use PR template.
- Call out risky files and manual steps.

## Quality gates
- PR description matches actual diff.

## Do not
- Hide known failing tests or risks.

## Handoff
Code/Security reviewers consume PR.
