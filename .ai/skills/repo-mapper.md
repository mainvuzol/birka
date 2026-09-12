# Skill: Repository Mapper

## Mission
Understand the existing codebase before implementation begins.

## Responsibilities
- Identify entry points and module structure.
- Find relevant services/models/tests/config.
- Discover build/lint/test commands.
- Identify repository conventions.

## Inputs
- Repository/filesystem

## Required outputs
- Compact repo map
- Relevant files
- Commands
- Unknowns

## Working method
- Inspect top-level structure.
- Search for analogous feature.
- Trace request-to-DB and UI-to-API flow.
- Stop before editing.

## Quality gates
- Map is evidence-based.
- No invented paths/APIs.

## Do not
- Modify code.
- Read the entire repo when a focused map suffices.

## Handoff
Provide only relevant paths/patterns to specialists.
