# A nightly backup, and a restore that proves it (M1-028) — 2026-09-30

Baseline: `614ba35` (PR #42).
Status: implemented and verified locally on PostgreSQL 16.2. Encryption and
PostgreSQL 17 are verified by CI on every push. No migration, no API change.
Branch: `feat/m1-028-backup-restore-drill`.

## Why this was next

M1-025 is complete. Gate M1D's exit criterion ends with "a restore drill has
actually been executed". Nothing in the repository could take a backup, let
alone restore one — the gap that turns a hardware failure into losing every
sale the shop has recorded.

## The owner's decisions (2026-09-30)

Asked, not guessed; recorded in business-rules.md, "backups".

- **A backup every day.** The owner first said once in two weeks. Told that a
  shop using the app daily could then lose two weeks of sales, the owner chose
  daily.
- **Retention.** Every daily backup is kept 7 days, and the first backup of
  each month 3 months.
- **Restore time.** No fixed target; the same day.
- **Copies leave the server encrypted** to the owner's age key, and the
  owner's own computer or NAS collects them.
- **Alerting.** A «Резервні копії» section for the owner, plus a Telegram
  message. The next change.

## What exists now

- **`scripts.backup_database`** writes an archive and a manifest. The row
  counts in the manifest are read in the snapshot `pg_dump` copies
  (`pg_export_snapshot`), so a sale landing mid-backup is in both or in
  neither. It only reads the database, and never deletes or overwrites a
  file.
- **`scripts.restore_drill`** restores into a new scratch database, checks
  the copy (below), and drops it. It writes to no other database.
- **`scripts.nightly_backup`** is what the schedule runs:
  1. back up;
  2. drill;
  3. encrypt with `age` and delete the plaintext;
  4. apply the retention;
  5. write `last-run.json`.

  Without the owner's public key the night fails. A night whose drill fails
  keeps its backup. **A failing night deletes nothing**, so a broken job can
  never eat the copies before it.
- **`infra/pull-backups.sh`** runs on the owner's machine. It takes only
  encrypted archives with their records, over SSH restricted to read-only
  `rrsync`. It never deletes anything, and it checks every archive against
  the recorded checksum.
- **The `ops` image** is the API image plus the PostgreSQL 17 client tools
  and `age`, run as a compose profile. It receives the database URL and the
  owner's *public* key — no bot token, no session secret, never the private
  key.
- **CI:**
  - The backend job installs the PostgreSQL 17 tools and `age`, so every
    backup test runs on PostgreSQL 17 and none may skip.
  - The `restore-drill` job builds the ops image, then on PostgreSQL 17 with
    ICU `uk-UA`:
    1. plays the owner and makes a key pair;
    2. runs the nightly backup exactly as cron would;
    3. asserts no plaintext is left;
    4. decrypts with the owner's key;
    5. checks the result is byte for byte the archive that was drilled.
- **The runbook**, [backup-restore-runbook.md](backup-restore-runbook.md),
  covers:
  - key generation and custody;
  - server setup and the cron line;
  - read-only SSH;
  - collection;
  - restoring for real.

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
    that two reconciliation tests corrupt on purpose (`quantity + 7` and
    `+ 5`), two per suite run.

  That is why CI drills a freshly seeded database rather than the suite's
  own.
- **A seeded organization, drilled through the command-line tools**: all
  eight checks pass, and the scratch database is gone afterwards.
- **A year of nights, simulated.** Retention never holds more than ten
  copies, never loses a night of the last week, and never loses a month's
  first night younger than three months.
- **Backend tests: 993 passed, 1 skipped.** 50 are new: 14 integration and
  36 unit. The skipped one is the encryption test: the owner chose not to
  install `age` on this machine, and CI runs it.
- **Gates:** ruff, format, mypy and import-linter are clean; `alembic check`
  reports no drift.

**Mutation testing — eighteen, eighteen caught:**

| Mutation | Caught by |
|---|---|
| `pg_dump` does not use the counted snapshot | the sale-during-the-backup test |
| The archive is not checked before restoring | the damaged-archive test |
| Row counts are not compared | the missing-rows test, and its unit counterpart |
| The ledger is not reconciled | the ledger test, and the happy path's list of checks |
| The scratch copy is left behind | the happy path |
| The scratch database ignores the source locale | the locale unit test |
| A manifest's locale reaches SQL unchecked | the three injection cases |
| A trigger's enabled state is not read | the unprotected-ledger test |
| A disabled trigger passes when the source had it disabled too | the same, and its unit counterpart |
| A client older than the server is let through | the version unit test |
| A failed night still prunes | the no-key and failing-drill night tests |
| The newest night is not always kept | the newest-night unit test |
| A month keeps its first night even when a later one was proven | the proven-first unit test |
| Six days of dailies instead of seven | the seven-days test and the year simulation |
| A night without the owner's key passes | the no-key night test |
| Retention takes any file named `birka-*` | the only-our-files test |
| The collection takes plaintext too | the collection test |
| The collection does not compare checksums | the damaged-copy test |

The eighth mutation survived its first run. The drill compared trigger states
only with the source, and a guard disabled on the source is disabled in the
copy too. The drill now fails on any disabled trigger.

## Not verified here

- **Encryption, PostgreSQL 17 and Docker were not run on this machine**,
  which has none of the three. The CI jobs are that evidence, on the PR.
- **Nothing has run on a production server.** The steps below are written
  down but none has been carried out:
  - the key;
  - the `.env` line;
  - the cron line;
  - the read-only SSH user;
  - the owner's collection schedule.

  The real restore uses the drill's `pg_restore` flags but has not been
  rehearsed end to end.
- **The owner does not yet hear about a failed night.** The section and the
  Telegram message are the next change. Until then, `last-run.json` and the
  cron log are the only record.

## Changed files

- `backend/scripts/{postgres_tools,backup_database,restore_drill,nightly_backup}.py` — new.
- `backend/tests/integration/test_backup_restore_drill.py` — new.
- `backend/tests/unit/{test_backup_tools,test_backup_retention,test_pull_backups}.py` — new.
- `infra/pull-backups.sh` — new.
- `backend/Dockerfile` — `ops` target with the PostgreSQL 17 client and
  `age`, and an explicit final `api` stage so a plain build still produces
  the API.
- `infra/docker-compose.yml` — the `ops` service under a profile.
- `.github/workflows/ci.yml` — the tools in the backend job, and the
  `restore-drill` job.
- `.gitignore` — `*.dump` and `infra/backups/`.
- The runbook, business rules (the owner's decisions), this report, the
  milestone status, the risk register and the README.
