# Failures are visible — 2026-10-03

Baseline: `e10f0fd` (before the public domain, merged as PR #66).
Status: implemented and verified locally, the edge included: CI's `edge`
job ran on a local Docker on 2026-10-03.
Migration `0034`.
Branch: `feat/failures-visible`.
Design: [ADR-0011](../decisions/ADR-0011-failures-are-visible.md).

## Why this was next

Asked what came next, the owner chose to make failures visible before the
app goes on a server. Until now nobody heard when something failed:
- a seller's screen that broke went blank;
- the server, its database or its disk could stop with nobody told.

A read-only mapping of the code (four readers and a critic) found where.
Most of it was technical. Who hears, how and how often is the owner's, and
the owner decided it on 2026-10-03 (business rules, "failures are
visible"):
- **trouble on the server** goes to the owner and an administrator, by the
  bot, and shows in «Резервні копії»;
- **with a sound** from 9:00 to 20:00, Kyiv time, and silently otherwise;
- **once when it starts, once a day, and once when it works again**;
- **an outside service** notices a server that dies whole;
- **no Sentry yet**, but it is prepared;
- **a broken screen** notes the server's log only;
- **the hot path's release reading** gates every case.

## What exists now

**Trouble on the server is told.** `backup-watch` looks every minute. It:
- asks the API about itself (`/internal/status`, on the compose network
  only, answered 404 by Caddy);
- measures the backups' disk and Docker's own.

The bot tells the owner and every id in `BIRKA_ADMIN_TELEGRAM_IDS`:
- **the app has not answered for 5 minutes,** because the API, its database
  or its schema is down or behind, and the message says which;
- **less than 15 % or 3 GB of a disk is free,** and it clears only at 17 %
  and 4 GB;
- **for 10 minutes no sign-in has succeeded while people kept trying,** with
  the probable cause: the server's clock, or maybe the bot token.

Each message is sent once when the trouble starts, then daily, then once
when it works again.

**It still speaks when the database is down.**
- It remembers the owners' chats.
- Its messages go out from memory, retried for a day.
- Troubles are written to the database whenever it answers, with their true
  start. A restart does not announce them again.

**A server that dies whole is noticed from outside.** Every 10 minutes the
watcher checks in at `BIRKA_HEARTBEAT_URL`, but only while all of these
hold:
- it is looking;
- the bot works;
- someone can be told.

So the outside service also hears of a hung watcher, a revoked bot token,
or nobody to tell.

**Readiness:**
- `GET /api/v1/ready` answers only when the database answers within 3
  seconds and its schema is not behind the code.
- Compose checks the API's health with it.
- The database cancels a statement after 30 seconds and ends a transaction
  idle for 60. The pool gives up after 10, before the phone does.

**A broken screen:**
- «Щось пішло не так» and «Перезапустити» instead of a blank page.
- It says a command is kept only when one was sent without an answer.
  Otherwise it says to check before repeating. It reads storage key names
  only, and never clears storage.
- A short note, `client.error`, goes to the API's log: which screen, which
  error, the version and the request's number. It is limited per address
  and to 4 KB.
- A bundle that never loads says so after 8 seconds.

**Every answer has a number.** An unhandled error answers JSON
`INTERNAL_ERROR` with `X-Request-ID`, and is still logged and captured. The
app shows «Номер запиту: …» for a server error, and says a 502, 503 or 504
means the server is out of reach.

**The log is what was configured.** Every module's logger is bound when it
writes, not when its module is imported.
- **Found while building this:** every module-level logger had kept
  structlog's defaults.
- **What that meant:** its lines ignored the level, were not JSON, and
  carried no request id.
- **Why it mattered most:** a traceback printed a refused row's values (a
  customer's name and phone) and its locals.

**Sentry is prepared and off.**
- `app/core/sentry.py` starts it for the API and the watcher alike. Each
  event names its build (`BIRKA_RELEASE`) and its process.
- The aiohttp integration is off.
- A breadcrumb's address keeps only its scheme and host.
- A bot token is cut from every text Sentry or the log gets.

**What grew or hung no longer does:**
- expired idempotency records are deleted hourly;
- every nightly step has a time limit;
- a night that finds the previous one running records a failed night,
  `still_running`;
- a drill's leftover scratch databases are dropped;
- a backup message is retried for a day, not five times, and a revoked
  token does not count as an attempt;
- each message is locked and committed on its own.

**The build has a version.** `BIRKA_RELEASE`, the commit, is given when the
images are built. It shows on the crash screen, in error reports and in
`/internal/status`.

## Evidence

**Backend: 2022 passed, 1 skipped** (the `age` test, which CI runs); 1707
before. New test files:
- `test_unhandled_errors.py`, `test_client_errors.py`,
  `test_sign_in_outcomes.py` (unit and integration);
- `test_readiness.py`, `test_database_timeouts.py`,
  `test_idempotency_purge.py`;
- `test_server_incidents.py` (unit and integration), `test_server_watch.py`;
- `test_backup_limits.py`, `test_measure_hot_path.py`.

Additions to:
- `test_log_privacy.py`, `test_sentry_privacy.py`, `test_backup_alerts.py`;
- `test_backup_restore_drill.py`, `test_server_image.py`, `test_config.py`;
- `test_telegram_messages.py`, `test_backup_status.py`.

**E2E: 156 → 168, all passing on a fresh database.**
`e2e/failures.spec.ts` (12 journeys) covers:
- the crash screen, with and without a command kept, with a sale answered
  after the crash, and with storage it cannot read;
- the note, which carries nobody;
- a note that cannot be sent;
- the bundle that never loads;
- the request's number, and a server out of reach;
- the «Резервні копії» section's server block.

Any uncaught error in a page now fails its journey (`e2e/fixtures.ts`). No
existing journey had one. The live E2E log holds no query string.

**The hot path's release reading** (checklist row 22). Every case was gated,
three runs on fresh databases, and all 8 cases passed every run. This
includes the sale paid in parts, measured for the first time. The worst p95
was 192 ms against 500. See the
[hot path report](hot-path-budget-report.md#update--2026-10-03-the-release-reading-every-case-gated).

**The edge, on Docker** (Docker Desktop 29.8.1, Compose v5.5.1, an
isolated compose project with Caddy on other ports). CI's `edge` job's
steps ran as written, and every step passed:
- the Caddyfile validated;
- only Caddy publishes a port;
- the images built: `python:3.12.14-slim`, `alpine:3.22` and the bundle;
- `/api/v1/ready` through Caddy;
- `/internal/status` answered 404 by Caddy, and naming the build inside;
- the note's 204;
- the API healthy to Docker;
- the headers and limits, and the sign-in limit with made-up addresses;
- Caddy's log with the API down;
- a republish.

Evidence: [`output/verification/2026-10-03-edge/`](../../output/verification/2026-10-03-edge/).

**The watcher beside the real API**, in the same stack. The API was stopped
for six minutes:
- the watcher noted the first failed look at 16:01:14 UTC;
- it started `NOT_ANSWERING`, «Сервер застосунку не відповідає.», exactly
  five minutes later;
- it ended the trouble at the first look after the API came back, as
  lasting 6 minutes.

With nobody to tell, it said so in its log and sent nothing. Its log lines
were JSON, as configured.

**Built by five agents in parallel,** each on its own files and its own test
database, then joined. The build found an existing defect in how loggers
were bound, and a transaction the new idle limit would have cut; both are
fixed and tested.

**An adversarial review** (three lenses, each finding checked by a skeptic)
confirmed 13 findings, all fixed:
- **Sentry's aiohttp breadcrumbs would have carried the bot token** and the
  check-in address (high, once a DSN is set).
- **Three junk sign-ins from anyone,** or one phone reloading hour-old
  launch data, would have raised the sign-in alarm. Refusals now count only
  from people, and the alarm needs people to keep trying (business rules,
  "carried out").
- **The crash screen promised a kept operation** when nothing was kept, which
  could have led to a sale rung twice.
- **The check-in address** reached the log on a non-2xx answer.
- **The check-in counted chats** that refused for good.
- **An API restart ended the sign-in alarm** with a false "works again".
- **Whole-second times** could keep the sign-in alarm from starting.
- **A retried write** could insert an ended trouble twice.
- **With migration 0034 missing,** the watcher never learned whom to tell.
- **A typo in the administrators' ids** would have stopped the watcher
  altogether.
- **The rollback steps** forgot the build's version.

A fourteenth claim was refuted.

**Mutation testing:**
- 129 mutants by the builders, all caught.
- 20 by an independent pass over the key protections, all caught. They
  covered the logger, the token cut, Sentry's integrations and addresses,
  the note's digits, the 500's body, readiness, the purge, the statement
  timeout, every threshold and the sound window, who counts toward the
  sign-in alarm, the check-in, the one-day retry, and the nightly lock.
- Each review fix was reverted once to see its test fail.

**Gates:**
- ruff, format and mypy are clean;
- 29 import contracts are kept;
- `alembic check` is clean;
- migration `0034` round-trips, with `0033` frozen;
- the frontend typechecks, lints, builds and is formatted.

## Not covered here

- **Telegram itself was not reached.** The watcher's messages, its
  check-in, and `getMe` are tested against Telegram's answers played back,
  and on Docker it had nobody to tell.
- **Nobody is set up to hear yet.** No administrator is named and no outside
  service exists, so a dead server is noticed only by the sellers until
  then (runbook, step 8a).
- **Confirmed by the owner the same day** (business rules, "carried
  out"):
  - a basket still being filled is lost when a screen breaks, which is fine
    for now;
  - "works again" sounds by the same hours as the trouble;
  - the administrator hears of the server, not of backups, for now.
- **Who hears is set up at publication or a test,** when the owner says so.
- **What stays open is in the risk register,** "failures are visible":
  - the sign-in alarm faked with two staff ids;
  - the watcher on the server it watches;
  - a wedged API told, not restarted;
  - the disk measured as the containers see it;
  - one narrow duplicate row.
- **Nothing has run in production, or reached a real Telegram.**

## Changed files

- New, backend:
  - `app/core/sentry.py`, `app/api/internal.py`, `app/api/v1/client_errors.py`;
  - `app/modules/identity/sign_ins.py`;
  - `app/modules/backups/incidents.py`, `app/modules/backups/server.py`;
  - `migrations/versions/0034_server_incidents.py`;
  - the tests above.
- New, frontend: `src/shared/CrashScreen.tsx`, `src/shared/report.ts`,
  `src/release.d.ts`, `e2e/failures.spec.ts`.
- Backend:
  - `core/`: config, correlation, db, errors, idempotency, logging,
    rate_limit;
  - `main.py`, `api/v1/router.py`, `api/v1/backups.py`, `models_registry.py`;
  - `identity/` (service, telegram_init_data);
  - `backups/` (models, service, status), `telegram/messages.py`;
  - `scripts/` (backup_watch, nightly_backup, postgres_tools, restore_drill,
    measure_hot_path);
  - `Dockerfile`.
- Frontend:
  - `src/main.tsx`, `App.tsx`, `shared/api.ts`;
  - `backups/`, `styles.css`, `index.html`, `vite.config.ts`;
  - `e2e/fixtures.ts`, `Dockerfile`.
- Infra and CI: `infra/docker-compose.yml`, `infra/Caddyfile`,
  `infra/.env.example`, `.github/workflows/ci.yml`.
- Docs:
  - ADR-0011, business rules, the server and backup runbooks, the risk
    register;
  - the release checklist (rows 3, 11b, 16, 19, 22), the hot path report,
    the README, the current milestone.
- Evidence: `output/verification/2026-10-03-hot-path/`.
