# CI, run locally

**Exit status 2: every job passed; at least one only with its declared gaps.**

GitHub Actions cannot run this repository's jobs (the account's minutes are used up), so `/Users/nikitahlushak/.cache/birka-runtime/ci/ci_local_tree.py` runs `/Users/nikitahlushak/birka/.claude/worktrees/friendly-williamson-c70f68/.github/workflows/ci.yml` on this Mac. This file and every log beside it come from one run (the directory is emptied when a run starts).

- Commit: a66c3be (claude/practical-bohr-54d0e1-rebased), clean
- Runner: `/Users/nikitahlushak/.cache/birka-runtime/ci/ci_local_tree.py` sha256 `266f4258b20eb605c68a720f088f5f4224f408a77178e502fcf54ce04457f794`
- Run: 2026-10-25 11:42:26 EET → 12:00:03; jobs asked: backend
- Environment of every job: TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8, as the ubuntu runner
- Docker Desktop: not running when the run started: this run started it (open -a Docker) and stopped it at the end (docker desktop stop); engine and background services down, verified
- Machine: macOS 26.7.1 arm64, Apple M5, 10 cores, 32 GB RAM; Docker Engine 29.8.2 (Docker Desktop VM aarch64, 10 CPUs, 7.7 GB)

| job | result | counts | duration | deviations (short; all in the log) |
|---|---|---|---|---|
| [backend](backend.txt) | **passed with declared gaps** | PG17 Tests: 3467 passed, 0 failed, 19 skipped (19 declared tool gaps); assertion's integration run: 1490 passed, 0 failed, 19 skipped; PG16.2 run of those 19: 18 passed, 1 skipped (age) | 17m23s | PG17 in Docker on 127.0.0.1:55417; no install (venv checked against the lock); declared gap: no PG17 client or age here, so the backup tests skip on PG17 and run on PG16.2 |

## Network used from Docker's VM (BuildKit, containers), per job

From Docker Desktop's own log, read when the run ended. A registry-1.docker.io connection during a build is BuildKit looking up the pinned base images' manifests: no layer is downloaded (every layer comes from the cache).

- backend: none

## Declared gaps, and what covers them

- **backend**: DECLARED (owner decision 2026-10-08): no PostgreSQL 17 client tools and no age on this Mac. The 19 backup tests of test_backup_restore_drill.py skip on PostgreSQL 17, so CI's assertion fails, on its skip check alone (verified). On PostgreSQL 16.2 with its 16.2 client: 18 passed (test_a_backup_is_never_overwritten, test_a_backup_restores_and_proves_it_is_the_same_data, test_a_copy_missing_rows_fails_and_names_the_table, test_a_damaged_archive_is_refused_before_anything_is_created, test_a_dump_that_hangs_is_stopped_and_the_night_says_so, test_a_good_night_backs_up_proves_and_keeps_what_the_owner_keeps, test_a_ledger_left_unprotected_fails_the_drill, test_a_ledger_that_does_not_reconcile_fails_the_drill, test_a_night_finding_the_last_one_still_running_starts_nothing, test_a_night_first_drops_what_a_stopped_drill_left, test_a_night_that_cannot_back_up_says_so, test_a_night_whose_drill_fails_keeps_its_backup_and_deletes_nothing, test_a_night_without_the_owners_key_fails_and_deletes_nothing, test_a_restore_that_hangs_fails_the_drill_and_drops_its_copy, test_a_sale_during_the_backup_is_in_neither_the_counts_nor_the_archive, test_kept_copies_stay_for_inspection_and_are_never_the_source, test_stock_left_under_a_merged_model_fails_the_drill, test_the_counts_are_the_snapshot_the_archive_holds); 1 skipped there too, needing age (test_an_encrypted_night_can_only_be_read_with_the_owners_key). Covered by restore-drill: pg_dump/pg_restore 17 and age in the ops image, against PostgreSQL 17 with CI's locale: the night's backup (scripts.nightly_backup), its restore drill, encryption to the owner's key, the watcher reading the night as OK, and decryption back to exactly the drilled archive (sha256). Not run anywhere here on PostgreSQL 17 with pg_dump 17: the failure paths of those tests (damaged archive, missing rows, a ledger that does not reconcile, hangs, locks, leftovers).
  - restore-drill in this run: NOT RUN in this run, so the gap is not covered by it

## Every deviation, by job

All jobs:

- The runner is a copy of ci_local.py pointed at /Users/nikitahlushak/birka/.claude/worktrees/friendly-williamson-c70f68 (CI_LOCAL_REPO), not the main checkout; its edge job's compose project is birka-ci-local-edge (not birka-edge-check), with BIRKA_BACKUP_DIR in its work directory; the isolated E2E API it pauses is given back from /Users/nikitahlushak/birka/backend, as it was found.
- Runs on this Mac (macOS 26.7.1 arm64, BSD userland, /bin/bash 3.2.57(1)-release) instead of GitHub's ubuntu-24.04 runner (x86_64, GNU userland, bash 5). Each `run` is executed as GitHub does it: `bash -e <script>` by default, `bash --noprofile --norc -eo pipefail` for shell: bash, `sh -e` for shell: sh, `python <script>` for shell: python; the step's shell, else the job's, else the workflow's defaults.run.shell.
- Every job runs with TZ=UTC, LANG=C.UTF-8 and LC_ALL=C.UTF-8, as on the ubuntu runner (this Mac's own zone is Europe/Kyiv); every tool the job starts inherits them, Playwright's Chromium included.
- The working tree as it is, not a fresh checkout (the header says clean or dirty).
- CI=true; GITHUB_ENV and GITHUB_STEP_SUMMARY point into the runner's work directory; upload-artifact copies into the evidence directory. uv's and npm's caches are in the runner's work directory.
- Nothing is installed and no image is pulled; builds use only the local build cache. The network is used only where CI's own steps use it: `npm audit` and pip-audit's queries.
- Nothing is re-run: a failing step or test fails the job, as in CI.

### backend
- images: postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 @ sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 (PG_VERSION=17.11), local image store, never pulled
- PostgreSQL 17: postgres:17-alpine (same env, initdb args and health check) in Docker Desktop's Linux VM, published on 127.0.0.1:55417 instead of localhost:5432; the database URLs say so.
- `PostgreSQL 17 client tools and age, for the backup tests` (apt in CI): NOT RUN, the declared gap (see GAPS).
- Tests and the assertion run CI's commands unchanged; the runner adds, in their environment only, PYTEST_ADDOPTS='--junitxml=<work>/… -o cache_dir=<work>/pytest-cache' to list each skip (from the junit file, not from -rs, so the text CI's assertion greps is CI's own) and to start from an empty pytest cache, as CI does (the repository's .pytest_cache is left alone).
- ruff and mypy start without a cache, as in CI (RUFF_CACHE_DIR/MYPY_CACHE_DIR in the work directory); `lint-imports` gets `--cache-dir <work>/import-linter-cache` so it too starts empty (the repository's backend/.import_linter_cache is left alone).
- /tmp paths moved to the runner's work directory; the catalogue evaluation report is in the evidence directory (CI uploads it as an artifact).
- `Install`: nothing installed; /Users/nikitahlushak/.cache/birka-runtime/python checked against requirements-dev.lock (71 pins at their versions), `uv pip check` for `pip check`; the backend is imported from backend/, not `pip install -e`'d. The venv also holds 3 package(s) requirements-dev.lock does not pin, which CI's install would not have: fasteners 0.20, pgserver 0.1.4, psutil 7.2.2. The lock's hashes are not checked here (nothing is downloaded); the images built in restore-drill and edge install it with --require-hashes.
- The 19 backup tests that skip on PostgreSQL 17 run again on the project's PostgreSQL 16 cluster pg-unit (127.0.0.1:55446, /Users/nikitahlushak/.cache/birka-runtime/pg-unit): PostgreSQL 16.2, timezone Europe/Kiev (CI's server: UTC), template1 locale libc collate C.UTF-8 ctype C.UTF-8 (CI: ICU uk-UA, --locale=C.UTF-8). The runner's scratch database birka_ci_local_backup16 (dropped after) and the databases the tests create inherit that timezone and locale. BIRKA_PG_BIN=/Users/nikitahlushak/.cache/birka-runtime/python/lib/python3.12/site-packages/pgserver/pginstall/bin (pg_dump 16.2).
