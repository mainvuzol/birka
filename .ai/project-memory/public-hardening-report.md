# Before the public domain — 2026-10-03

Baseline: `89eb844` (one size, one spelling, merged as PR #65).
Status: implemented and verified locally; the edge is first proven by CI.
Migration `0033`.
Branch: `feat/public-hardening`.
Design: [ADR-0010](../decisions/ADR-0010-before-the-public-domain.md).

## Why this was next

Asked what came next, the owner chose to make the app safe before it goes on
a public domain (release row 16). Several risks had been accepted "until
public exposure" (R1–R4). A read-only mapping of the code, by four readers
and a critic, found more than forty gaps; nearly all were technical. Four
were about how the shops work, and the owner decided them on 2026-10-03
(business-rules.md, "before the public domain"):
- **a seller stays signed in 12 hours**, as now;
- **a lost phone:** on the owner's word, the administrator ends every
  sign-in of that person on the server; they keep their access;
- **the server is updated while the shops are closed,** an urgent security
  fix aside;
- **the bot tells the owner a week before the certificate runs out.**

## What exists now

**Personal data stays on the server:**
- The API's access log is written without query strings, so a debt search
  by name or phone never reaches it.
- Sentry gets no query string, no Referer query, and none of the values a
  refused database row repeats. Each event carries its request id.
- Database errors hide their bound parameters. PostgreSQL's own DETAIL
  values are hidden to the end of the DETAIL, and PostgreSQL logs tersely.
- Caddy's own log drops the query string and the Referer.
- A customer's name and phone are kept on one line.

**Limits on what anyone may send:**
- A body over 1 MB is refused at the edge (413).
- The API takes 30 sign-ins a minute from one address. The app then says
  «Забагато спроб входу. Зачекайте хвилину й спробуйте ще раз.»
- The API sees the real address. A client cannot choose the request id that
  the audit log keeps.
- API answers are never stored.

**Sessions:**
- `scripts.people sign-out` ends every sign-in of a person on the owner's
  word, and keeps their stores. It reminds the administrator to end the lost
  phone's Telegram session too.
- Turning someone off ends their sign-ins, and a later grant does not bring
  the old ones back.
- The app sends its launch data once. Before, a session older than an hour
  was thrown out by any refresh, though its token had hours left.

**Updates:**
- The page is never cached. The bundle's files are kept for a year, and a
  missing one is an honest 404.
- The replaced bundle stays for 30 days. No source maps are shipped.
- 443/udp is published for HTTP/3.
- The API starts as `production` by default.

**Dependencies:**
- The image installs exactly `backend/requirements.lock` (43 runtime pins),
  with `pip check`, on a pinned Python.
- CI installs with the locks and runs `pip-audit`.

**The certificate:** `backup-watch` asks Caddy for it on every look. In its
last week, the owners hear about it from the bot once a day, silently.

**CI:**
- The workflow's token is read-only.
- A new `edge` job validates the Caddyfile, builds and starts the stack,
  and checks:
  - the headers, the limits and the request id;
  - Caddy's log with the API down;
  - that a republish keeps the bundle it replaced.

## Evidence

**Backend: 1707 passed, 1 skipped** (the `age` test, which CI runs); 1594
before. New test files:
- `test_log_privacy.py` (unit) and `test_log_privacy_database.py`
  (integration): the access line through uvicorn's own protocols, and
  tracebacks with a refused row (PostgreSQL's real wording included);
- `test_sentry_privacy.py`: a debt search that ends in a 500, through the
  real app with Sentry's integrations on, leaves no customer anywhere;
- `test_rate_limit.py`, `test_session_token.py`,
  `test_session_epoch.py`, `test_session_epoch_migration.py`, and
  additions to `test_people.py`;
- `test_certificate_watch.py` and `test_certificate_alerts.py`;
- `test_dependency_lock.py`, `test_server_image.py`, `test_credit_terms.py`.

The five parts were built by five agents in parallel, each on its own files,
then joined: the sign-in limit's settings, a site address with a scheme, and
PostgreSQL's terse errors.

**An adversarial review of the code** (three lenses, each finding checked by
a skeptic) confirmed seven more, all fixed:
- **Caddy's error log** kept a debt search's query string while the API was
  down. It is now filtered, and CI checks it.
- **A name or phone with a line break** slipped past the redaction. Both are
  now kept on one line, and the redaction runs to the end of the DETAIL.
- **With an `AAAA` record,** every IPv6 client would share one sign-in limit.
  The runbook now asks for no `AAAA` record, and for a check that the API
  logs the phone's own address.
- **Nothing failed if the API stopped believing Caddy's address.** A test
  now guards the flag, and CI signs in 31 times with made-up addresses.
- **The documented local E2E command** ran into the sign-in limit.
- **The replaced bundle was pruned at once** when releases were more than
  30 days apart. Its files are now dated when they are replaced.
- **A comment overstated the sign-out:** a reload within the launch data's
  hour signs in again.

**Mutation testing: 36 mutants, all caught** (backend 33, frontend 3): each
protection removed or weakened alone, from the access-log filter to the
week before the certificate runs out. The first run's survivor was a gap,
now tested: a warning on day six and a half.

**Gates:**
- ruff, format and mypy are clean;
- 29 import contracts are kept;
- `alembic check` is clean;
- migrations round-trip on an empty database.

**E2E: 152 → 156, all passing on a fresh database.** `e2e/session.spec.ts`
(4 journeys):
- an owner whose launch data has expired changes a store's state and keeps
  working;
- a seller at a blocked store refreshes, and reads `/me` without signing in
  again;
- an ended session says so;
- too many sign-ins says so.

The live E2E log holds no query string at all.

## Not covered here

- **The edge has never run locally:** no Caddy or Docker. The `edge` job is
  its first run, and the first build of `python:3.12.14-slim` and
  `alpine:3.22`.
- **What stays open is in the risk register,** "before the public domain":
  - launch data replayed within its hour;
  - the lost phone's Telegram session;
  - no per-person limit once signed in;
  - the API as the database's owner (closed on 2026-10-09: ADR-0016);
  - container defaults (closed on 2026-10-09: ADR-0017);
  - a strict content security policy;
  - floating images;
  - lock hashes.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/app/core/rate_limit.py`, `backend/app/modules/backups/certificate.py`;
  - `backend/migrations/versions/0033_session_epoch.py`;
  - `backend/requirements.lock`, `backend/requirements-dev.lock`;
  - `frontend/.dockerignore`, `frontend/e2e/session.spec.ts`;
  - the tests above.
- Backend:
  - `core/`: logging, db, correlation, config, errors;
  - `main.py`, `api/deps.py`, `api/v1/router.py`;
  - `identity/` (session, service, people, models), `scripts/people.py`;
  - `backups/service.py`, `scripts/backup_watch.py`, `credit/service.py`;
  - `Dockerfile`.
- Frontend:
  - `src/App.tsx` and `shared/api.ts`;
  - `Dockerfile` and `vite.config.ts`.
- Infra and CI: `infra/Caddyfile`, `infra/docker-compose.yml`,
  `infra/.env.example`, `.github/workflows/ci.yml`.
- Docs:
  - ADR-0010, business rules, the server runbook, the risk register;
  - the milestone plan (R1–R4), the release checklist (row 11a), the README;
  - the E2E command in `order-ui-report.md`.
