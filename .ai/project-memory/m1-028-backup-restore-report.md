# A backup, and a restore that proves it (M1-028) — 2026-09-30

Baseline: `614ba35` (PR #42).
Status: implemented and verified locally on PostgreSQL 16.2. A CI job runs
the same drill on PostgreSQL 17 with the production locale on every push.
No migration, no API change.
Branch: `feat/m1-028-backup-restore-drill`.

## Why this was next

M1-025 is complete. Gate M1D's exit criterion ends with "a restore drill has
actually been executed". Nothing in the repository could take a backup, let
alone restore one. It is the gap that turns a hardware failure into losing
every sale the shop has recorded.

## What exists now

- **`scripts.backup_database`** writes a `pg_dump --format=custom` archive and
  a manifest. The manifest holds:
  - the SHA-256;
  - the migration revision;
  - the locale;
  - every trigger and its state;
  - every table's row count.

  The counts are read in the transaction whose snapshot `pg_dump` copies
  (`pg_export_snapshot`). A sale landing mid-backup is therefore in both the
  counts and the archive, or in neither. It never deletes or overwrites.
- **`scripts.restore_drill`** restores an archive into a new scratch database
  on a named server, with the source's locale, in one transaction, stopping
  at the first error. It then checks the copy — see below — and drops it. It
  never writes to any other database.
- **The `ops` image** (`backend/Dockerfile`, target `ops`) is the API image
  plus the PostgreSQL 17 client tools. On the server it is the
  `docker compose --profile ops` service. It receives the database URL and
  nothing else — no bot token, no session secret.
- **A CI job, `restore-drill`**, builds that image and then, on PostgreSQL 17
  with ICU `uk-UA`:
  1. migrates;
  2. seeds an organization;
  3. backs it up;
  4. drills the backup;
  5. uploads the report.

  The backend job installs the same client tools, so the integration tests
  below run on PostgreSQL 17 as well.
- **A runbook**, [backup-restore-runbook.md](backup-restore-runbook.md). It
  covers taking and drilling a backup on the server, restoring for real, and
  what the backup does not contain.

## What the drill proves

| Check | Fails when |
|---|---|
| archive | the file is not the one the manifest describes (checked before anything is created) |
| restore | `pg_restore` stops on an error |
| migration | the copy is at another revision |
| rows | a table is missing, extra, or has a different count |
| triggers | a trigger differs, **or any is disabled** — a copy that faithfully keeps the ledger's append-only guard switched off is not healthy |
| locale | provider, collation, ctype or `lower()` differ from the source |
| cyrillic | `lower('ОЛЯ')` is not `'оля'` (catalog matching silently misses) |
| ledger | any balance disagrees with its movements, in any organization (invariant I3, the app's own reconciliation) |

## Evidence

- **The whole test suite's database, drilled locally.** The suite had run
  twice, leaving 35,262 rows in 47 tables and 25 triggers.
  - The archive (2.5 MB) restored in **0.42 s**, and every row, trigger and
    the locale matched.
  - **The ledger check failed, correctly.** It named exactly the balances
    that two reconciliation tests corrupt on purpose
    (`UPDATE inventory SET quantity = quantity + 7`, and `+ 5`), two per
    suite run.

  That is also why CI drills a freshly seeded database rather than the
  suite's own.
- **A seeded organization, drilled through the command-line tools** the way
  the CI job runs them: all eight checks pass, and the scratch database is
  gone afterwards.
- **973 backend tests passed** (944 + 29 new: 9 integration, 20 unit). Ruff,
  format, mypy, import-linter clean; `alembic check` reports no drift.

**Mutation testing — ten, ten caught:**

| Mutation | Caught by |
|---|---|
| `pg_dump` does not use the counted snapshot | `test_a_sale_during_the_backup_is_in_neither_the_counts_nor_the_archive` |
| The archive is not checked before restoring | `test_a_damaged_archive_is_refused_before_anything_is_created` |
| Row counts are not compared | the missing-rows test, and its unit counterpart |
| The ledger is not reconciled | the ledger test, and the happy path's list of checks |
| The scratch copy is left behind | the happy path |
| The scratch database ignores the source locale | `test_the_scratch_database_keeps_the_source_locale` |
| A manifest's locale reaches SQL unchecked | the three injection cases |
| A trigger's enabled state is not read | `test_a_ledger_left_unprotected_fails_the_drill` |
| A disabled trigger passes when the source had it disabled too | the same, and its unit counterpart |
| A client older than the server is let through | `test_a_client_older_than_the_server_is_refused_in_words` |

The first run of the eighth mutation survived. The drill only compared
trigger states with the source, and a guard disabled on the source is
disabled in the copy too. The drill now also fails on any disabled trigger.

## Not verified here

- **Nothing ran on PostgreSQL 17 or in Docker locally**: this machine has
  neither. The CI job and the backend job's integration tests are that
  evidence, on the PR.
- **No production server has been backed up or restored.** The real restore
  procedure in the runbook uses the drill's `pg_restore` flags, but has not
  been rehearsed end to end on a server.
- **Nothing is scheduled, and no copy leaves the server.** Five owner
  decisions — RPO, RTO, retention, off-server destination and key custody,
  alerting — are listed in the runbook rather than guessed.

## Changed files

- `backend/scripts/{postgres_tools,backup_database,restore_drill}.py` — new.
- `backend/tests/integration/test_backup_restore_drill.py` — new, 9.
- `backend/tests/unit/test_backup_tools.py` — new, 20.
- `backend/Dockerfile` — `ops` target, and an explicit final `api` stage so a
  plain build still produces the API.
- `infra/docker-compose.yml` — the `ops` service under a profile.
- `.github/workflows/ci.yml` — PostgreSQL 17 client tools in the backend job,
  and the `restore-drill` job.
- `.gitignore` — `*.dump` and `infra/backups/`: backups hold every sale and
  every customer order.
- The runbook, this report, the milestone status and the risk register.
