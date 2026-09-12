# Skill: Secret Safety Skill

## Mission
Prevent credential leakage during coding, testing, logging and agent operation.

## Responsibilities
- Detect secret-bearing files/strings.
- Redact logs/output.
- Use environment/secret stores.
- Prevent commits of secrets.

## Inputs
- Files/diffs/tool output

## Required outputs
- Leak findings
- Safe remediation

## Working method
- Scan changed files.
- Check build/frontend bundle exposure.
- Check logs and CI output.

## Quality gates
- No known production secret in repo/output.

## Do not
- Print secret values to prove they exist.

## Handoff
Security/DevOps handle rotation when leakage occurred.
