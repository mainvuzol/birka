# ADR-0010: Before the public domain

Status: Accepted (2026-10-03)
Owner decisions: business-rules.md, "before the public domain" (2026-10-03).
Closes: R1's Python part, R2 and R3 (milestone-1-plan.md §17.5). R4 stays
accepted, narrowed.
Amended by: ADR-0014 (2026-10-08), §2's largest body; ADR-0015
(2026-10-09), how long §1's customer data is kept, and a write-off's reason
no longer copied into the audit log.

## Context

Release row 16 puts the app on a public domain. Until then several risks were
accepted "until public exposure". A read-only mapping of the code found:
- **personal data leaving the server:**
  - the API's access log and Sentry kept a debt search's query string (a
    customer's name or phone);
  - a refused row's values reached tracebacks and Sentry;
- **no limit** on a request's size or on sign-ins, and the API could not see
  the client's address;
- **sessions:** a person's sign-ins could not be ended, and turning someone
  off then on again revived their old tokens;
- **an app open longer than an hour was thrown out:** it re-sent its
  launch data, which the server refuses after an hour;
- **the edge:** no cache headers, so an app could open blank after an
  update; the previous bundle deleted at once; source maps public;
- **dependencies:** the server's image installed whatever PyPI held that
  day, not what CI tested, and nothing audited the Python ones;
- **the certificate:** nothing would warn that it was not being renewed.

The owner decided:
- a seller stays signed in 12 hours, as now;
- on the owner's word the administrator ends every sign-in of a person on the
  server, and the person keeps their access;
- the server is updated while the shops are closed, an urgent security fix
  aside;
- the bot tells the owner a week before the certificate runs out.

## Decision

### 1. Personal data stays on the server

- **The access log** is written without a query string: a filter on
  `uvicorn.access` (`app/core/logging.py`) cuts it before any handler or
  Sentry breadcrumb sees the line. `--no-access-log` is honoured again.
- **Sentry** (`app/main.py`) drops `request.query_string`, cuts the query
  from the URL and the Referer, hides a refused row's values in exception
  values and messages, and strips queries from breadcrumbs. Each event is
  tagged with its request id (`app/core/correlation.py`).
- **The database's own words:**
  - the engine hides bound parameters (`hide_parameters`);
  - a formatter on stdout and a structlog step hide the values in
    PostgreSQL's DETAIL (`Failing row contains (…)`, `Key (…)=(…)`) to the
    end of the DETAIL, line breaks included;
  - PostgreSQL itself logs tersely (`log_error_verbosity=terse`).
- **A customer's name and phone are one line each.** A line break would
  slip past the redaction, and the app's fields cannot type one.
- **Caddy's own log** filters the query string and the Referer.

### 2. What anyone may send

- **A body of at most 1 MB**, refused by Caddy with 413. The largest
  legitimate body, one part of an opening stock list from a file, is under
  0.96 MB (ADR-0014 §11; amended 2026-10-08). `1MB` is 1 000 000 bytes.
- **30 sign-ins a minute from one address**, with a burst of 30, in the API
  (`app/core/rate_limit.py`, one process, in memory, bounded). A shop behind
  one address never reaches it. Refused with 429 `RATE_LIMITED` and
  `Retry-After`; the app says «Забагато спроб входу…».
- **The API sees the client's address:** uvicorn believes X-Forwarded-For
  from any sender, which is safe only because nothing but Caddy reaches its
  port (never published; a test and CI check it), and Caddy writes that
  header itself from the address it was reached from.
- **A client cannot choose the request id** written into the audit log:
  Caddy drops an incoming `X-Request-ID`.
- **API answers are never stored** (`Cache-Control: no-store`).

### 3. Sessions

- **12 hours**, as the owner chose; the defaults are pinned by tests.
- **A per-person epoch** (`app_user.session_epoch`, migration `0033`). A
  token carries `ep`; one lower than the person's is refused as
  `SESSION_EXPIRED`. A token without `ep` counts as 0, so the deploy signs
  nobody out.
  - `scripts.people sign-out` raises it and keeps every membership; it is
    approved as removing the person from all their stores would be, and
    audited.
  - Turning someone off raises it, so a later grant does not revive old
    tokens. Removing them from one store does not, unless it was their
    last: the owner kept the other stores working.
- **The app sends its launch data once.** It keeps the token and reads
  `/me` with it; only with no token yet does it sign in again. This ends
  the one-hour throw-out, and keeps a signed-out app from signing itself
  back in.
- **Rejected:** a server-side table of sessions (a write per sign-in and a
  lookup per request, for two shops); one-time launch data (a reload inside
  Telegram would then need a reopen).

### 4. The edge and the bundle

- **The page is `no-cache`;** the bundle's hashed files are `immutable` for
  a year when they exist, and an honest 404 when they do not.
- **The previous bundle stays** for 30 days after it is replaced. The page is
  published last, by rename; every file is written beside its name and
  renamed into place.
- **No source maps** are built or shipped.
- **HTTP/3:** 443/udp is published, as Caddy advertises it.
- **`BIRKA_APP_ENV` defaults to `production`** in compose, so the start-up
  checks are on unless a laptop says otherwise.

### 5. Dependencies

- **`backend/requirements.lock`** (runtime) and **`requirements-dev.lock`**,
  generated offline from the tested environment. The image installs the
  runtime lock with `--no-deps` and runs `pip check`; CI installs with the
  locks as constraints. A test keeps the locks and pyproject in step.
- **The API image's Python is pinned** (`python:3.12.14-slim`).
- **`pip-audit`** runs in CI on the runtime lock, as `npm audit` does for the
  app.
- **Rejected for now:** hashes (generating them needs the network), and
  Dependabot pull requests (no one is named to act on them yet). Hashes,
  and every image by its digest, came on 2026-10-10
  ([ADR-0019](ADR-0019-what-the-server-is-built-from.md)).

### 6. The certificate

`backup-watch` asks Caddy for the domain's certificate on every look (TLS,
with the domain as SNI). With less than 7 days left, or expired, the owners
who hear about backups hear about it once a day, silently. It is stored in
the backup alert queue as kind `FAILED` with a `certificate:<date>` key, so
no migration was needed, and backup recovery messages ignore it. No domain,
`localhost`, an address or a plain-HTTP site address: nothing is checked.

### 7. CI

- **The workflow's token is read-only** (`permissions: contents: read`).
- **A new `edge` job** validates the Caddyfile, checks that only Caddy
  publishes a port, builds and starts the stack, then checks:
  - the headers, the 404s and the source maps;
  - the body limit and the sign-in limit, with made-up addresses;
  - that the request id is the server's;
  - Caddy's log with the API down;
  - that a republish keeps the replaced bundle.

## Consequences

- R2 and R3 are closed; R1's Python part is closed but for hashes; R4 is
  narrowed. What remains is in the risk register ("before the public
  domain").
- A lost phone needs two steps: `scripts.people sign-out`, and ending that
  phone's Telegram session.
- An update during opening hours is now against the owner's rule. An app
  left open keeps the old code until reopened.
- The edge is proven by CI only: no Caddy or Docker runs locally.
