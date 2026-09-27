# Catalog evaluation foundation — 2026-09-27

Status: implemented and verified locally.

Baseline: `7b04668`, family discovery merged in PR #30. This increment adds a
reproducible evaluation gate and a proposed verification policy. It does not
complete full M1-022, promote aliases or enable automatic identity decisions.

## Scope

- A versioned synthetic catalog fixture with 15 scenarios: 2 SAME_VARIANT,
  10 AMBIGUOUS and one each NEW_VARIANT, NEW_MODEL, NEW_CATEGORY.
- Cases cover distinct models sharing names, competing verified aliases,
  color/material/length conflicts, learning aliases, explicit context, slash
  ambiguity and rare code1636. Ground truth exists only within this authored
  catalog. These are engineering regression expectations, not owner labels.
- The 44 real source rows remain unchanged and are evaluated separately for
  annotated extraction and raw preservation. Only26 rows carry extraction
  annotations;18 do not. None has independently confirmed product identity.
- A runner invokes the real PostgreSQL matcher, emits versioned JSON with dataset
  hashes and metrics, and rolls back synthetic catalog writes. It accepts only
  explicitly named local test databases.
- CI runs the gate and uploads the report. Missing targets, wrong decisions,
  lost conflicts, unsafe SAME_VARIANT proposals, truncation or weaker human
  confirmation fail the gate. Malformed fixtures cannot silently remove checks.
- A proposed policy documents required provenance, independent holdout labels,
  conflict handling, permissions, durable commands and audit before any future
  manual verification. It grants no runtime authority.

## Review decisions

The positive alias scenario originally used a phrase containing ambiguous
concept evidence. Real matcher evaluation conservatively returned AMBIGUOUS;
that behavior was retained as its own scenario. A separate unambiguous phrase
checks verified-alias retrieval. No matcher thresholds or expected real product
identity were invented to obtain a passing result.

Independent review requested strict real-corpus schemas/empty-input rejection and
rejection of inconsistent shared family/concept declarations in synthetic seed
input. These prevent apparently successful evaluation of missing or different
catalog facts. Runtime PostgreSQL metadata accompanies results because locale
changes affect Cyrillic matching.

## Files

- `backend/scripts/evaluate_catalog.py`: evaluation, guarded CLI and metrics.
- `backend/tests/fixtures/catalog_match_eval_v1.json`: synthetic test catalog.
- Evaluation unit/integration tests: validate gates and rollback behavior.
- `.github/workflows/ci.yml`: regression gate, artifact and explicit Unicode locale.
- `.ai/decisions/catalog-alias-verification-policy.md`: proposed future policy.
- [Runbook](catalog-evaluation-runbook.md): commands and interpretation.

## Verification

- Full backend suite: **767 passed**, 36.09s; one dependency deprecation warning from Starlette's httpx TestClient integration.
- New evaluator tests: **11 integration + 8 unit** passed. Fault injection proves wrong-top SAME, missing targets/conflicts and reduced confirmation fail the gate. Tests prove savepoint rollback on success and exception, malformed corpus rejection and inconsistent identity declarations rejected before seeding.
- CLI exit0; [generated baseline JSON](catalog-evaluation-baseline.json): **15/15** expected synthetic decisions, **3/3** labeled targets retrieved in top10, **0/2** unsafe SAME suggestions, **15/15** require human confirmation. Real extraction: **59/59** annotated assertions, **44/44** raw texts preserved. These small synthetic denominators do not establish production precision.
- Ruff lint passed; **144 files** format-clean; exact CI type check `mypy app scripts`: **79 files** passed.
- Architecture: **12 contracts kept, 0 broken**.
- Fresh migration to0014 and `alembic check` passed; no schema drift or new migration.
- CI YAML parses and contains evaluator gate/artifact step. Hosted GitHub CI/PostgreSQL17 execution and artifact upload were not run locally.
- PostgreSQL16.2 C.UTF-8 used only in `/tmp` disposable `birka_catalog_eval`, port55442. No work database, global package or Docker change.
- Frontend/E2E not rerun: no frontend or runtime application code changed. `git diff --check` clean.

Independent review findings about malformed parser evidence and inconsistent synthetic identity were fixed and pinned by tests. No unresolved blocking finding for this evaluation foundation; no promotion authority added.

Cleanup completed: the disposable evaluation database was dropped and the isolated PostgreSQL process stopped.

## Remaining work

There are zero independent human-confirmed holdout identity labels in this
repository evaluation set. Production precision, calibrated confidence,
acceptable error budgets and promotion readiness are therefore not established.
Manual VERIFIED API/UI and explicit conflict resolution remain unimplemented.
Snapshot import M1-023 can proceed independently with explicit human review;
actual opening-stock import remains the owner's later choice. No migration or
frontend behavior change is part of this increment.
