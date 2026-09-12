# Installing This Pack Into an Existing Git Repository

## Recommended location

Extract the contents of this pack into `.ai/` at the repository root.

```text
my-project/
├── .git/
├── .ai/
│   ├── README.md
│   ├── constitution.md
│   ├── PRODUCT_EXCELLENCE_STANDARD.md
│   ├── 80_20_OPERATING_PROFILE.md
│   ├── CATALOG_ARCHITECTURE.md
│   ├── ADAPTIVE_CATALOG_LEARNING.md
│   ├── START_PROJECT_PROMPT.md
│   ├── skills/
│   ├── policies/
│   ├── workflows/
│   ├── templates/
│   └── project-memory/
├── frontend/          # when created
├── backend/           # when created
└── ...
```

## Commit the extracted instructions, not the ZIP

Recommended:
- commit `.ai/` to Git so the engineering rules are versioned with the product;
- keep the downloaded ZIP outside the repository or delete it after extraction;
- do not commit secrets, `.env` files, production exports, private credentials, or database dumps.

## Bridge file for coding agents

Most coding agents discover a short repository-level instruction file more reliably than an archive. Copy/adapt the relevant template from `.ai/integration/`:

- `AGENTS.md.template` -> repository-root `AGENTS.md` for agents that support AGENTS.md-style project instructions;
- `CLAUDE.md.template` -> repository-root `CLAUDE.md` for Claude Code;
- `cursor-rule.mdc.template` -> `.cursor/rules/project-governance.mdc` for Cursor;
- use `generic-project-instructions.md` when the tool has its own project/system-instruction setting.

The bridge should be short. It should tell the tool to read `.ai/constitution.md`, `.ai/project.md`, `.ai/definition-of-done.md`, the catalog architecture, current milestone, and only relevant specialist skills.

## First commit

A good first governance commit is:

```text
chore(ai): add engineering operating system and project governance
```

Inspect the diff before committing.

## Branching recommendation

Do not let the initial agent build the entire application directly on `main`. Create an implementation branch, for example:

```text
feat/foundation-milestone-1
```

or let your normal Git workflow create a feature branch/PR.

## What the first agent run should do

The first run should NOT generate the entire application. It should:
1. read and acknowledge the governing files;
2. inspect the existing repository;
3. create a repository map;
4. separate facts from assumptions;
5. define domain model v1 and invariants;
6. propose modular-monolith architecture;
7. define Milestone 1 and dependency graph;
8. update `.ai/project.md` and project memory with approved facts;
9. produce an implementation plan for human review.

Only after this review should implementation begin.
