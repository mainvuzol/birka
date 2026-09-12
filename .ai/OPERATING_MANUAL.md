# Operating Manual: How to Use This Pack Correctly

## 1. Board-level input

The human gives objectives, constraints and priorities, not low-level code instructions unless desired.

Example:

> We need returns. A seller must be able to return one item from an existing sale, restore stock when appropriate, preserve audit history, and prevent double refunds.

The Executive Orchestrator must turn this into requirements, design work and a task graph before implementation.

## 2. Context loading

Always-on context:
- constitution.md
- conventions.md
- definition-of-done.md
- project.md
- current milestone from project-memory/current-milestone.md

Load role-specific skills only when needed. Do not send the entire skills directory to every specialist.

## 3. Mandatory workflow classes

### Small low-risk change
Use:
`repo map -> implement -> tests -> review -> verify`

### Normal product feature
Use:
`requirements -> architecture check -> task graph -> implement -> tests -> review -> verify -> docs`

### Critical stock/money/security feature
Use:
`requirements -> domain review -> architecture -> threat model -> DB/concurrency design -> implementation -> integration/concurrency tests -> security review -> adversarial review -> E2E -> release gate`

## 4. Task contracts

Every delegated task must contain:
- objective;
- reason/business context;
- constraints;
- relevant files/context;
- acceptance criteria;
- expected output;
- allowed tools;
- prohibited actions;
- dependencies.

Use `templates/task.yaml` and `templates/handoff.md`.

## 5. Agent result contracts

Agents must return evidence, not prose-only confidence. Use `templates/agent-result.json`.

The orchestrator should reject a result when:
- status is complete but tests were not run;
- files outside scope were changed without justification;
- architecture changed without an ADR;
- database schema changed without migration;
- a critical invariant lacks a test;
- security implications were ignored.

## 6. Review separation

The implementation agent should not be the final reviewer for critical code. Use a fresh reviewer context whenever possible.

At minimum, run:
- Code Reviewer for normal changes;
- Security Reviewer for auth/permissions/data-exposure changes;
- Concurrency Specialist for stock/payment/idempotency changes;
- Release Manager before production.

## 7. Human approval gates

Require explicit human approval for:
- production data deletion;
- destructive migration;
- changing production credentials/secrets;
- DNS and TLS ownership changes;
- irreversible financial corrections;
- production database manual edits;
- disabling security controls;
- bypassing failed release gates.

## 8. Project memory

Store only durable project facts:
- architecture decisions;
- business rules;
- naming conventions;
- unresolved risks;
- current milestone state;
- known incidents and follow-ups.

Do not store verbose agent reasoning or giant raw chat histories.

## 9. Model selection

Use stronger reasoning for architecture, security, concurrency and complex debugging. Use faster/cheaper models for formatting, documentation cleanup, classification and mechanical refactors after a strong plan exists.

## 10. Final authority

LLMs propose and execute. Authority remains with deterministic systems:
- tests;
- database constraints;
- type systems;
- build systems;
- policy gates;
- human approvals.

## Product Excellence 80/20 mode

Do not invoke every specialist for every task. The orchestrator classifies risk and loads skills accordingly:

- **Routine UI/read-only:** product + implementer + QA/reviewer.
- **Stock/money:** add concurrency, financial integrity and inventory ledger.
- **Permissions/tenant:** add security, multi-tenancy and RBAC.
- **Critical seller workflow:** add POS UX and performance budget review.
- **Production release:** always run golden-path, verification and production-readiness gates.

The goal is a small amount of process around the highest-risk 20% of behavior, not bureaucracy around every file edit.


## 11. Adaptive catalog work

Catalog tasks are data/domain work, not just string parsing. For changes to identity/matching, load Adaptive Catalog Architect, Parser, Matcher, Confidence Policy, Product Family Identity and Catalog Eval skills as relevant.

Use:
`raw evidence -> parse -> candidates -> confidence/conflict policy -> human confirmation when needed -> deterministic mutation -> feedback -> eval`.

Do not freeze the complete taxonomy during early milestones. Core platform implementation may proceed while uncertain/rare attributes remain in extensible structures. Promote fields only from repeated evidence.

## 12. Legacy stock data

PDF/notebook/availability lists are imported as InventorySnapshots. Preserve every original row. The import process may infer candidates but must not fabricate receipts, sales, or per-size/per-color distributions absent from the source.

## 13. Project startup in an existing repository

Follow `REPOSITORY_INSTALLATION.md` and use `START_PROJECT_PROMPT.md`. The first agent run is analysis/planning and repository mapping, not mass implementation.
