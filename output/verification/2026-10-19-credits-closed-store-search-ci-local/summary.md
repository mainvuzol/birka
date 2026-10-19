# CI, run locally

**Exit status 2: every job passed; at least one only with its declared gaps.**

GitHub Actions cannot run this repository's jobs (the account's minutes are used up), so `/Users/nikitahlushak/.cache/birka-runtime/ci/ci_local.sh` runs `/Users/nikitahlushak/birka/.github/workflows/ci.yml` on this Mac. This file and every log beside it come from one run (the directory is emptied when a run starts).

- Commit: 4b88442 (feat/credits-closed-store-search), dirty: ?? .ai/project-memory/credits-redesign-5-report.md; ?? output/verification/2026-10-19-credits-closed-store-search/mutants.py; ?? output/verification/2026-10-19-credits-closed-store-search/mutants.txt; ?? output/verification/2026-10-19-credits-closed-store-search/search-plan.txt
- Runner: `/Users/nikitahlushak/.cache/birka-runtime/ci/ci_local.py` sha256 `3e1564d8fa8f012077b980d4bfc42f1c6b440049499decf4939a22587b9ff8da`
- Run: 2026-10-19 00:38:34 EEST → 01:02:52; jobs asked: backend restore-drill e2e frontend python-audit edge hot-path
- Environment of every job: TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8, as the ubuntu runner
- Docker Desktop: not running when the run started: this run started it (open -a Docker) and stopped it at the end (docker desktop stop); engine and background services down, verified
- Machine: macOS 26.7.1 arm64, Apple M5, 10 cores, 32 GB RAM; Docker Engine 29.8.2 (Docker Desktop VM aarch64, 10 CPUs, 7.7 GB)

| job | result | counts | duration | deviations (short; all in the log) |
|---|---|---|---|---|
| [backend](backend.txt) | **passed with declared gaps** | PG17 Tests: 3457 passed, 0 failed, 19 skipped (19 declared tool gaps); assertion's integration run: 1480 passed, 0 failed, 19 skipped; PG16.2 run of those 19: 18 passed, 1 skipped (age) | 16m18s | PG17 in Docker on 127.0.0.1:55417; no install (venv checked against the lock); declared gap: no PG17 client or age here, so the backup tests skip on PG17 and run on PG16.2 |
| [restore-drill](restore-drill.txt) | **passed** | 7 of CI's 7 run steps passed; ops image tools: age 1.2.1-1+b5 / libpq5:arm64 18.6-1.pgdg13+2 / postgresql-client-17 17.11-1.pgdg13+2 / postgresql-common 278 / pg_dump (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2) / age 1.2.1 | 0m25s | images built from the local cache only (pinned bases, dead proxy) as birka-ci-local-*; a user network instead of host networking; backups/keys outside the repo |
| [e2e](e2e.txt) | **passed** | 450 passed | 5m38s | PG17 in Docker on 127.0.0.1:55442 (the local PG16 E2E cluster paused); node v24.18.0 for 24; npm ci and playwright install replaced by checks of what is installed |
| [frontend](frontend.txt) | **passed** | eslint 0 problems (exit 0); tsc --noEmit 0 errors (exit 0); npm audit: found 0 vulnerabilities; vite 144 modules, built in 75ms | 0m13s | node v24.18.0 for 24; npm ci replaced by a check that node_modules is exactly the lock |
| [python-audit](python-audit.txt) | **passed** | pip-audit audited 43 packages: 0 known vulnerabilities ("No known vulnerabilities found") | 0m05s | pip-audit 2.9.0 from its own venv (Python 3.12.14); its report as JSON, counted from pip-audit's own output |
| [edge](edge.txt) | **passed** | 9/9 steps passed | 0m23s | run_edge.py's way: project birka-edge-check, Caddy on :58080; images never pulled, builds from the local cache only (pinned bases, dead proxy); stack removed after |
| [hot-path](hot-path.txt) | **passed** | 12 cases, 5 gated; 0 gated over budget, 0 not gated over budget; worst p95 catalogue read 94.6 ms of 300 (GET /catalog/stock-options · search (6 sellers)), POST /sales 108.8 ms of 500 (POST /sales · same coat, 6 sellers) | 0m56s | PG17 in Docker on 127.0.0.1:55417, reached through Docker Desktop's port forwarding; a 10-core Mac, not a 2-vCPU runner; gate one-seller as CI; run last, alone |

## Network used from Docker's VM (BuildKit, containers), per job

From Docker Desktop's own log, read when the run ended. A registry-1.docker.io connection during a build is BuildKit looking up the pinned base images' manifests: no layer is downloaded (every layer comes from the cache).

- backend: none
- restore-drill: registry-1.docker.io:443 x1 (10997 bytes)
- e2e: none
- frontend: none
- python-audit: none
- edge: registry-1.docker.io:443 x2 (21984 bytes)
- hot-path: none

## Declared gaps, and what covers them

- **backend**: DECLARED (owner decision 2026-10-08): no PostgreSQL 17 client tools and no age on this Mac. The 19 backup tests of test_backup_restore_drill.py skip on PostgreSQL 17, so CI's assertion fails, on its skip check alone (verified). On PostgreSQL 16.2 with its 16.2 client: 18 passed (test_a_backup_is_never_overwritten, test_a_backup_restores_and_proves_it_is_the_same_data, test_a_copy_missing_rows_fails_and_names_the_table, test_a_damaged_archive_is_refused_before_anything_is_created, test_a_dump_that_hangs_is_stopped_and_the_night_says_so, test_a_good_night_backs_up_proves_and_keeps_what_the_owner_keeps, test_a_ledger_left_unprotected_fails_the_drill, test_a_ledger_that_does_not_reconcile_fails_the_drill, test_a_night_finding_the_last_one_still_running_starts_nothing, test_a_night_first_drops_what_a_stopped_drill_left, test_a_night_that_cannot_back_up_says_so, test_a_night_whose_drill_fails_keeps_its_backup_and_deletes_nothing, test_a_night_without_the_owners_key_fails_and_deletes_nothing, test_a_restore_that_hangs_fails_the_drill_and_drops_its_copy, test_a_sale_during_the_backup_is_in_neither_the_counts_nor_the_archive, test_kept_copies_stay_for_inspection_and_are_never_the_source, test_stock_left_under_a_merged_model_fails_the_drill, test_the_counts_are_the_snapshot_the_archive_holds); 1 skipped there too, needing age (test_an_encrypted_night_can_only_be_read_with_the_owners_key). Covered by restore-drill: pg_dump/pg_restore 17 and age in the ops image, against PostgreSQL 17 with CI's locale: the night's backup (scripts.nightly_backup), its restore drill, encryption to the owner's key, the watcher reading the night as OK, and decryption back to exactly the drilled archive (sha256). Not run anywhere here on PostgreSQL 17 with pg_dump 17: the failure paths of those tests (damaged archive, missing rows, a ledger that does not reconcile, hangs, locks, leftovers).
  - restore-drill in this run: **passed** (7 of CI's 7 run steps passed; ops image tools: age 1.2.1-1+b5 / libpq5:arm64 18.6-1.pgdg13+2 / postgresql-client-17 17.11-1.pgdg13+2 / postgresql-common 278 / pg_dump (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2) / age 1.2.1)

## Every deviation, by job

All jobs:

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

### restore-drill
- images: postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 @ sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 (PG_VERSION=17.11), local image store, never pulled
- images: python:3.12.14-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f, named by digest in its Dockerfile, in the local build cache
- images: birka-ci-local-ops @ sha256:e55fc62e4548b415986f5e26d9dba470e07e4e49b973df527d1d5e6100167e07, built here from the cache
- images: birka-ci-local-api @ sha256:4ab0c0ae5e5e7cebfe6dc844203726014f7a6ea098caaa2ee09ffc0b13916523, built here from the cache
- Images are tagged birka-ci-local-ops / birka-ci-local-api (not birka-ops / birka-api) and built from the local build cache only: every base image pinned to the digest in the cache (no pull, no tag lookup), and a dead HTTP(S) proxy for every RUN, so any download fails (`--network=none` changes BuildKit's cache key). The ops image's package layer was fetched once, by the owner's decision (2026-10-08), with network: docker build --progress=plain --build-context python:3.12.14-slim=<the runner's cached pin> --target ops -t birka-ci-local-ops backend   (from the repository, network allowed); log in /Users/nikitahlushak/.cache/birka-runtime/ci/runs/2026-10-08-ops-image-fetch.txt. A build that fails here fails the job; only before that one fetch is a blocked download of the ops image "incomplete" (still exit 1).
- `docker run --pull never` everywhere.
- `--network host` with localhost:5432 becomes the user network birka-ci-local with birka-ci-local-pg:5432 (Docker Desktop on macOS has no host networking unless it is switched on in its settings).
- PostgreSQL 17: postgres:17-alpine (same env, initdb args, health check), container birka-ci-local-pg, published on 127.0.0.1:55417.
- The watcher container is birka-ci-local-watch (not `watch`); backups/ and keys/ live in the runner's work directory, not in the repository; the drill report is copied to the evidence directory.

### e2e
- images: postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 @ sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 (PG_VERSION=17.11), local image store, never pulled
- PostgreSQL 17: postgres:17-alpine (same env, initdb args, health check) in Docker Desktop's Linux VM, published on 127.0.0.1:55442 exactly as CI, which the seed's guard demands. The local PostgreSQL 16 E2E cluster (pg-e2e) listens there, so it is stopped for this job and started again when the whole run ends; an idle E2E API left on 58042 by fresh_e2e.sh is stopped and started again likewise.
- Node v24.18.0, the host's, instead of node 24; `npm ci` replaced by a check that the installed node_modules is exactly package-lock.json (the step fails otherwise); `npx playwright install --with-deps chromium` replaced by the Chromium headless shell already in the runtime (PLAYWRIGHT_BROWSERS_PATH), the revision this Playwright expects; no OS packages (macOS). Chromium gets TZ=UTC and LANG/LC_ALL=C.UTF-8 like every tool of the job (it reports timeZone UTC, language en-US).
- The fixture and the API log live in the runner's work directory instead of /tmp; on failure the traces and the API log are copied to the evidence directory (CI uploads them).
- `Install the API`: nothing installed; /Users/nikitahlushak/.cache/birka-runtime/python checked against requirements.lock (43 pins at their versions), `uv pip check` for `pip check`; the backend is imported from backend/, not `pip install -e`'d. The venv also holds 31 package(s) requirements.lock does not pin, which CI's install would not have: Pygments 2.21.0, ast_serialize 0.11.2, cfgv 3.5.0, distlib 0.4.3, fasteners 0.20, filelock 4.0.8, grimp 3.17, httpcore 1.0.9, httpx 0.28.1, identify 2.6.20, import-linter 2.15, iniconfig 2.3.0, librt 0.16.0, markdown-it-py 4.2.0, mdurl 0.1.2, mypy 2.3.1, mypy_extensions 1.1.0, nodeenv 1.11.0, packaging 26.3, pathspec 1.1.1, pgserver 0.1.4, platformdirs 4.12.2, pluggy 1.6.0, pre_commit 4.6.2, psutil 7.2.2, pytest 9.1.1, pytest-asyncio 1.4.0, python-discovery 1.6.1, rich 15.0.0, ruff 0.16.7, virtualenv 21.14.2. The lock's hashes are not checked here (nothing is downloaded); the images built in restore-drill and edge install it with --require-hashes.

### frontend
- images: none (this job starts no container)
- Node v24.18.0 (npm 11.16.0), the host's, instead of node 24.
- `npm ci` replaced by a check that the installed node_modules is exactly package-lock.json, and that package.json agrees with the lock as npm ci checks it; the step fails otherwise (nothing installed, no downloads).
- `npm audit --audit-level=high` runs as in CI: it sends package-lock.json's names and versions to registry.npmjs.org (owner decision 2026-10-08); npm's cache and logs go to the runner's work directory (npm_config_cache), its update check is off.
- `tsc -b` inside `npm run build` reuses the git-ignored frontend/tsconfig.tsbuildinfo where CI starts without one; the separate `npm run typecheck` (tsc --noEmit) still checks every file.

### python-audit
- images: none (this job starts no container)
- pip-audit 2.9.0 lives in its own venv (/Users/nikitahlushak/.cache/birka-runtime/ci/pip-audit-venv, Python 3.12.14), installed once with uv from PyPI (2026-10-08) and never reinstalled; the step's `pip install pip-audit==2.9.0` becomes `pip-audit --version`.
- CI's pip-audit command, with `-f json -o python-audit-report.json` (the report in the evidence directory, so the counts are pip-audit's own) and `--cache-dir <work>/pip-audit-cache` (instead of ~/Library/Caches/pip-audit) added; the verdict line and the exit status are pip-audit's, as in CI. Its advisory queries go to PyPI's vulnerability service, as in CI.

### edge
- images: postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 @ sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 (PG_VERSION=17.11), local image store, never pulled
- images: caddy:2-alpine@sha256:881bbc60f9986d5ab8e7cfd6cf7e4ef3c9c0439fef2429d035d065577882f028 @ sha256:881bbc60f9986d5ab8e7cfd6cf7e4ef3c9c0439fef2429d035d065577882f028 (CADDY_VERSION=v2.11.6), local image store, never pulled
- images: python:3.12.14-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f, named by digest in its Dockerfile, in the local build cache
- images: node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1, named by digest in its Dockerfile, in the local build cache
- images: alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8, named by digest in its Dockerfile, in the local build cache
- images: birka-edge-check-api @ sha256:4417369f63e727e13cb92adf813155f8415b2502a465bbd8fc642cd4846013a9, built here from the cache
- images: birka-edge-check-web @ sha256:5b9fb946ef6c1492d8600015b88e10737a9b272af93a8c2b6a9e7204fc23df4b, built here from the cache
- images: birka-edge-check-ops @ sha256:d71d587c374a640438120a363026637a878a38675b6f2aff98906db45cd15c21, built here from the cache
- As edge/run_edge.py runs it: the isolated compose project birka-edge-check (CI: the file's own `birka`), Caddy published on 58080/58443 instead of 80/443 (edge/override.yml), every http://localhost in the steps becomes http://localhost:58080; BIRKA_DOMAIN stays http://localhost; BIRKA_BACKUP_DIR is edge/backups. The port check reads the config merged with the runner's two files, which touch only caddy's ports and the builds.
- Images: a third compose file (work/edge/edge-offline.yml) sets `pull_policy: never` on every service with an image (postgres:17-alpine, caddy:2-alpine come from the local image store, never pulled; CI pulls them fresh), pins every build's base image to the digest in the local build cache and passes a dead HTTP(S) proxy as build args, so a step that would download fails; `docker run --pull never`.
- BIRKA_RELEASE is the full HEAD commit, as github.sha is in CI.
- Afterwards the stack is removed (`docker compose --profile ops down -v --remove-orphans`, project birka-edge-check only); its images are kept.
- Before it, the image birka-edge-check-ops a previous run kept is removed, so `compose run ops` builds it from this tree, as on a fresh runner that has none.

### hot-path
- images: postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 @ sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 (PG_VERSION=17.11), local image store, never pulled
- PostgreSQL 17: postgres:17-alpine (same env, initdb args, health check) in Docker Desktop's Linux VM, published on 127.0.0.1:55417 instead of localhost:5432. The API (on the Mac) reaches it through Docker Desktop's port forwarding, which CI's service container does not have; and this Mac has 10 cores where CI's runner has 2-4 vCPUs. The figures compare with CI's only roughly.
- BIRKA_PERF_GATE=one-seller, as CI sets it (the release reading is BIRKA_PERF_GATE=all).
- /tmp paths moved: the figures are in the evidence directory (hot-path-figures.txt), the API log is copied there (CI uploads both as an artifact). The step summary CI writes is printed in this log.
- Run last, after every other job, with nothing else of the runner running.
- Load average at the start: { 3.25 3.15 3.03 }.
- `Install`: nothing installed; /Users/nikitahlushak/.cache/birka-runtime/python checked against requirements-dev.lock (71 pins at their versions), `uv pip check` for `pip check`; the backend is imported from backend/, not `pip install -e`'d. The venv also holds 3 package(s) requirements-dev.lock does not pin, which CI's install would not have: fasteners 0.20, pgserver 0.1.4, psutil 7.2.2. The lock's hashes are not checked here (nothing is downloaded); the images built in restore-drill and edge install it with --require-hashes.
