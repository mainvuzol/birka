# CI, run locally

**Exit status 0: every job passed.**

GitHub Actions cannot run this repository's jobs (the account's minutes are used up), so `/Users/nikitahlushak/.cache/birka-runtime/ci/ci_local.sh` runs `/Users/nikitahlushak/birka/.github/workflows/ci.yml` on this Mac. This file and every log beside it come from one run (the directory is emptied when a run starts).

- Commit: d990fc5 (feat/navigation-customers), dirty: ?? output/verification/2026-10-26-navigation-customers-ci-local/artifacts/restore-drill/restore-drill-report/birka-20261026T180228Z.drill.json; ?? output/verification/2026-10-26-navigation-customers-ci-local/artifacts/restore-drill/restore-drill-report/last-run.json; ?? output/verification/2026-10-26-navigation-customers-ci-local/backend-catalog-evaluation.json; ?? output/verification/2026-10-26-navigation-customers-ci-local/backend.result.json; ?? output/verification/2026-10-26-navigation-customers-ci-local/backend.txt; ?? output/verification/2026-10-26-navigation-customers-ci-local/e2e.result.json; ?? output/verification/2026-10-26-navigation-customers-ci-local/e2e.txt; ?? output/verification/2026-10-26-navigation-customers-ci-local/edge.result.json; ?? output/verification/2026-10-26-navigation-customers-ci-local/edge.txt; ?? output/verification/2026-10-26-navigation-customers-ci-local/frontend.result.json
- Runner: `/Users/nikitahlushak/.cache/birka-runtime/ci/ci_local.py` sha256 `3e1564d8fa8f012077b980d4bfc42f1c6b440049499decf4939a22587b9ff8da`
- Run: 2026-10-26 20:13:52 EET → 20:14:12; jobs asked: frontend python-audit
- Environment of every job: TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8, as the ubuntu runner
- Docker Desktop: not running when the run started, and no job needed it: not started
- Machine: macOS 26.7.1 arm64, Apple M5, 10 cores, 32 GB RAM; Docker not running

| job | result | counts | duration | deviations (short; all in the log) |
|---|---|---|---|---|
| [frontend](frontend.txt) | **passed** | eslint 0 problems (exit 0); tsc --noEmit 0 errors (exit 0); npm audit: found 0 vulnerabilities; vite 161 modules, built in 102ms | 0m15s | node v24.18.0 for 24; npm ci replaced by a check that node_modules is exactly the lock |
| [python-audit](python-audit.txt) | **passed** | pip-audit audited 43 packages: 0 known vulnerabilities ("No known vulnerabilities found") | 0m03s | pip-audit 2.9.0 from its own venv (Python 3.12.14); its report as JSON, counted from pip-audit's own output |

## Network used from Docker's VM (BuildKit, containers), per job

From Docker Desktop's own log, read when the run ended. A registry-1.docker.io connection during a build is BuildKit looking up the pinned base images' manifests: no layer is downloaded (every layer comes from the cache).

- frontend: none
- python-audit: none

## Declared gaps, and what covers them

- none

## Every deviation, by job

All jobs:

- Runs on this Mac (macOS 26.7.1 arm64, BSD userland, /bin/bash 3.2.57(1)-release) instead of GitHub's ubuntu-24.04 runner (x86_64, GNU userland, bash 5). Each `run` is executed as GitHub does it: `bash -e <script>` by default, `bash --noprofile --norc -eo pipefail` for shell: bash, `sh -e` for shell: sh, `python <script>` for shell: python; the step's shell, else the job's, else the workflow's defaults.run.shell.
- Every job runs with TZ=UTC, LANG=C.UTF-8 and LC_ALL=C.UTF-8, as on the ubuntu runner (this Mac's own zone is Europe/Kyiv); every tool the job starts inherits them, Playwright's Chromium included.
- The working tree as it is, not a fresh checkout (the header says clean or dirty).
- CI=true; GITHUB_ENV and GITHUB_STEP_SUMMARY point into the runner's work directory; upload-artifact copies into the evidence directory. uv's and npm's caches are in the runner's work directory.
- Nothing is installed and no image is pulled; builds use only the local build cache. The network is used only where CI's own steps use it: `npm audit` and pip-audit's queries.
- Nothing is re-run: a failing step or test fails the job, as in CI.

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
