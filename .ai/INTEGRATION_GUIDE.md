# Integration Guide

## Option A — Single coding agent

Use when the tool does not support real multi-agent execution.

Always-on instructions:
- constitution.md
- conventions.md
- definition-of-done.md
- policies/security-guardrails.md
- policies/tool-permissions.md

For each phase, explicitly load/switch to the relevant skill file. Keep artifacts in `project-memory/` and `templates/` formats so the next phase receives structured state.

Recommended sequence for a critical feature:
1. executive-orchestrator
2. product-strategist
3. requirements-engineer
4. retail-domain-expert
5. solution-architect
6. concurrency-transactions / security as applicable
7. implementation skill(s)
8. QA/test skills
9. code-reviewer + adversarial-reviewer
10. verification-before-completion
11. definition-of-done-gate
12. release-manager

## Option B — Multi-agent runner

Create durable role agents and give each one:
- constitution.md;
- conventions.md;
- one or more role skill files;
- a structured handoff;
- scoped tool permissions.

The Executive Orchestrator is the only role allowed to spawn/route arbitrary specialist tasks. Specialists should not recursively spawn many subagents unless policy explicitly allows it.

## Option C — MCP-enabled tools

Expose narrow tools such as:
- repository read/search;
- repository edit in sandbox;
- run tests;
- inspect CI;
- create PR;
- query staging logs;
- query read-only development DB.

Keep production DB writes, secret changes and destructive actions behind approval tools or outside the agent environment entirely.

## Suggested role bundles

### Executive Orchestrator
- executive-orchestrator
- project-task-planner
- dependency-graph-planner
- parallel-work-orchestrator
- context-engineer
- structured-output
- loop-detector

### Product & Domain
- product-strategist
- requirements-engineer
- retail-domain-expert
- financial-integrity

### Architecture
- solution-architect
- architecture-guardian
- api-contract-engineer
- dependency-researcher

### Frontend / Telegram
- frontend-react-engineer
- telegram-mini-app-specialist
- ux-product-designer
- design-system-agent

### Backend / Data
- backend-fastapi-engineer
- sqlalchemy-specialist
- postgres-engineer
- concurrency-transactions
- alembic-migration-engineer

### Security
- security-engineer
- threat-model-agent
- prompt-injection-defense
- secret-safety

### QA
- qa-architect
- pytest-httpx-engineer
- concurrency-test-engineer
- playwright-e2e
- adversarial-reviewer

### Delivery / Operations
- devops-docker-caddy
- ci-cd-engineer
- sre-observability
- release-manager
- incident-responder

## First project setup session

Ask the orchestrator to perform only these steps:
1. map repository;
2. fill project.md;
3. validate build/test commands;
4. summarize current architecture;
5. populate project-memory glossary/business rules/current milestone;
6. identify missing critical infrastructure/tests;
7. propose milestone plan.

Do not ask it to immediately rewrite the codebase.


## Existing Git repository

For this project, follow `REPOSITORY_INSTALLATION.md`. Extract the pack into `.ai/`, commit the extracted governance files, install one short agent bridge file, and start with `START_PROJECT_PROMPT.md`.
