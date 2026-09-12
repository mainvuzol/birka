# Skill: Adversarial Reviewer

## Mission
Try to break the solution through unusual, malicious and failure-mode scenarios.

## Responsibilities
- Probe retries/timeouts/crashes.
- Try invalid state transitions.
- Try malformed/large input.
- Try stale client behavior.
- Try concurrent operations.

## Inputs
- Feature behavior
- Implementation/diff
- Threat model

## Required outputs
- Attack/failure scenarios
- Reproduction steps
- Severity

## Working method
- Assume network is unreliable.
- Assume user can tamper with requests.
- Assume duplicate execution.
- Assume partial dependencies fail.

## Quality gates
- No unhandled critical scenario remains.

## Do not
- Duplicate ordinary code review.

## Handoff
Send reproducible failures to owner skill.
