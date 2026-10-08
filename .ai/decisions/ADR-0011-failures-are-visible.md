# ADR-0011: Failures are visible

Status: Accepted (2026-10-03)
Owner decisions: business-rules.md, "failures are visible" (2026-10-03).
Builds on: ADR-0010 (what may leave the server), the backup alerts
(m1-028-backup-alerts-report.md).

## Context

Before the app goes on a server, nobody heard when something failed. A
read-only mapping of the code (four readers and a critic) found:
- **A broken screen went blank.** There was no error boundary, so a render
  error in Telegram's WebView unmounted the app and left an empty page with
  no text and no button. Nothing reported it.
- **A crash had no number.** An unhandled error left the API as Starlette's
  bare-text 500, outside the middleware that adds `X-Request-ID`, so the
  seller had nothing to quote.
- **Nothing watched the server.**
  - `/health` never touches the database.
  - Only the database had a healthcheck.
  - Nothing measured the disk.
  - A database that stopped, an API restarting in a loop on a bad setting,
    a migration not run, a revoked bot token or a server clock gone wrong
    were seen by nobody until the sellers phoned.
- **The watcher could not report its own server.**
  - `backup-watch` runs on the server it watches.
  - It reads whom to tell from the database.
  - It gave a message up after five attempts, about 40 minutes of Telegram
    being unreachable.
  - Nothing noticed when the watcher itself hung.
- **Things that grow or hang:**
  - idempotency records never expired, though the plan promised seven days;
  - a nightly step could hang with no timeout;
  - two nights could overlap;
  - a killed drill left its scratch database behind.
- **Sentry:** `backup-watch` was given the DSN but never started Sentry, and
  no build named its version.

The owner decided who hears, how and how often; the rest is technical.

## Decision

### 1. Three kinds of trouble, watched from inside

`backup-watch` now also watches the server. Every minute it:
- asks the API about itself (`GET /internal/status`, on the compose network
  only);
- measures the disk.

Each kind of trouble is an incident: it starts, it is reminded daily, and it
ends.

| Kind | Starts | Ends |
|---|---|---|
| `NOT_ANSWERING` | the API, its database, or the schema it needs has not answered for 5 minutes in a row | the first look at which all three answer |
| `DISK_LOW` | less than 15 % or less than 3 GiB free on the backups' disk or Docker's own | at least 17 % and 4 GiB free on both, so a disk near the line does not flap |
| `SIGN_IN_FAILING` | for 10 minutes no sign-in succeeded while people kept trying (below) | a sign-in succeeds; an API restart alone ends nothing |

- **Why a sign-in was refused** is kept, so the message can say which it
  probably is:
  - the server's clock: launch data expired, or dated in the future;
  - a bot token that does not match the bot: a bad signature.
- **"While people kept trying" counts people, not strangers.**
  - The sign-in endpoint is open to anyone. A review showed that three junk
    sign-ins would have raised the alarm, with a sound, blaming the bot
    token. So would one phone reloading launch data more than an hour old.
  - So a refusal counts only with a sender:
    - expired or future-dated launch data passed its signature, so its
      Telegram user is known;
    - a refused signature counts only when the user it claims is an active
      person of the shop (one lookup);
    - malformed data never counts.
  - The alarm needs all of these:
    - the first counted refusal at least 10 minutes old, and at least 3 of
      them;
    - the last one within 5 minutes;
    - at least two people refused. One is enough when the commonest reason
      is launch data dated in the future, which only a wrong clock gives.
  - The API reports only counts (`senders`, never the ids).
- **The API counts outcomes in its own memory.** On the server one uvicorn
  process serves everything, so the count is complete.
  - A sign-in that passes the signature check but finds no access is not a
    failure.
  - Neither is a sign-in the address limit refuses.
- **"The schema" is the code's migration head.**
  - A database behind the head means a migration was not run, and every
    request would fail.
  - A database ahead of the head is allowed: going back to the previous code
    alone is a documented step.

### 2. Who is told, how loudly, how often

- **Who:** the people who hear about backups, plus every Telegram id in
  `BIRKA_ADMIN_TELEGRAM_IDS`, each chat once. The administrator is not an
  account in the app: they press «Start» in the bot, and their id goes into
  `.env`.
- **How loudly:** with a sound from 9:00 to 20:00, Kyiv time, and silently
  outside those hours. This applies to the start, the reminder and "works
  again" alike. Backup messages stay silent at any hour.
- **How often:** once when it starts, then every 24 hours while it lasts,
  then once when it works again.
- **The database may be down exactly then.**
  - The owners' chats are cached from the last good read, and messages go
    out from an outbox in memory, retried every minute for up to 24 hours.
  - Incidents are written to the database whenever it answers. One open
    incident per kind is enforced by a unique index (migration `0034`).
  - A watcher restarted while the database is down knows only the
    administrators, and holds the incidents in memory until the database
    answers.
- **Shown in the app:** the «Резервні копії» section shows when the watcher
  last looked, the open troubles, and those that ended in the last week.

### 3. A server that dies whole is noticed from outside

A dead server cannot say so.
- **The check-in.** Every 10 minutes the watcher checks in at
  `BIRKA_HEARTBEAT_URL`, a plain GET to an outside service, but only when
  all of these hold:
  - its last look completed;
  - the bot works (Telegram's `getMe`);
  - someone can be told.
- **What the check-ins cover.** The service writes to the owner when they
  stop, whether:
  - the server is dead;
  - the watcher hangs;
  - the bot token is revoked;
  - there is nobody to tell.
- **The site itself.** The same service checks the site
  (`/api/v1/ready`).
- **What it learns:** the site's address and that the server is alive, and
  nothing of the shop's.
- **The service is not chosen in code.** Any service with check-in ("cron
  job") monitoring works. The runbook names two, and the owner holds the
  account.

### 4. Readiness and a wedged API

- **`GET /api/v1/ready`** answers 200 only when the database answers within
  3 seconds and its schema is not behind. Otherwise it answers 503 with
  `database` or `schema`. `/health` stays as it was.
- **Compose checks the API's health** through `/ready`. Caddy still waits
  only for the API to start: a schema not yet migrated must not take the
  page down with it.
- **The database cancels** a statement after 30 seconds, and ends a
  transaction idle for 60.
- **The pool gives up** after 10 seconds, before the phone's own 20, so one
  stuck request cannot hold a connection or a lock for good.

### 5. A broken screen

- **The crash screen.** An error boundary at the root shows:
  - «Щось пішло не так»;
  - what is kept;
  - «Перезапустити», which reloads with Telegram's launch data;
  - the version.
- **What the screen says is kept** depends on the phone. It reads storage
  key names only, never their values:
  - when a command was sent and its answer is unknown (`birka:…pending:…`),
    it says that the command is kept and is checked after the restart;
  - otherwise it says to check before repeating an operation just made,
    and that a basket not yet sent is filled again.

  A basket lives only on the screen (business rules, "carried out"). The
  screen rechecks every second, because an answer arriving after the crash
  clears its command. It never clears the phone's storage.
- **A bundle that never loads** shows a fixed sentence after 8 seconds,
  instead of nothing.
- **The note.** The app sends `POST /api/v1/client-errors`, at most 5 per
  page load.
  - It holds which screen, which error, the version and the request's
    number.
  - It never holds the address, the launch data, storage, form values, or
    who the seller is.
  - The API writes one log line and keeps nothing. It does not forward the
    note to Sentry or the bot: owner, "the server's log only".
  - The note works before sign-in. It is limited per address and to 4 KB.
- **Unhandled errors and rejected promises** are noted, but leave the
  screen as it is.

### 6. Every answer has a number

An unhandled error now answers JSON `INTERNAL_ERROR` with `X-Request-ID`,
and is re-raised, so uvicorn still logs it and Sentry, when on, still
captures it. The app shows the first eight characters: «Номер запиту: …».
- 502, 503, 504 and no answer say that the server is unreachable right now.
- Every other refusal reads as before.

### 7. Sentry, prepared and off

- `app/core/sentry.py` starts Sentry the same way for the API and the
  watcher.
- **Without the aiohttp integration.** The watcher calls
  `api.telegram.org/bot<token>/…`, and Sentry's aiohttp breadcrumbs would
  have carried that path, token included, and the check-in address. A
  breadcrumb's address keeps only its scheme and host. A bot token is cut
  from every text Sentry or the log gets.
- Every event names:
  - the build (`BIRKA_RELEASE`, its git commit, given at build time);
  - the process.
- The watcher captures what its catch-all used to only log.
- **It stays off until `BIRKA_SENTRY_DSN` is set** (owner: not yet). The
  crash screen and error reports show the same `BIRKA_RELEASE`.

### 8. What grows or hangs

- **Expired idempotency records** are deleted once an hour by the watcher,
  in batches. A retry after that takes each command's durable path, which
  answers as before.
- **A nightly step:**
  - has a timeout;
  - a night that finds the previous one still running records a failed
    night, `still_running`, and the owner hears of it;
  - a drill's leftover scratch databases are dropped under the same lock.
- **Backup messages** are retried for 24 hours instead of five times, so a
  Telegram outage no longer loses a failed night. A revoked bot token never
  counts as an attempt.

### 9. The hot path's release reading

Every case gates the release, six sellers included (owner, 2026-10-03). The
harness gains the sale paid in parts. The release reading is taken on the
laptop, as before. CI still gates one seller, in every run. A breach under
concurrency is now also an annotation and a line in the run's summary,
where before it was only in the artifact.

## Rejected

- **The owner's computer as the outside watcher:** it works only while
  that computer is on (owner chose the outside service).
- **An autoheal container that restarts an unhealthy API:** it needs the
  Docker socket, which is root on the host. A wedged API is told, not
  restarted.
- **Client error reports to Sentry or the bot:** the owner chose the
  server's log only.
- **Storing client error notes:** a log line is enough to find them, and
  there is nothing to keep, to delete or to protect.

## Consequences

- An administrator needs their Telegram id in `.env`, and must press
  «Start» in the bot.
- The outside service needs an account in the owner's name, set up from the
  runbook; until then, a server that dies whole is still noticed only by
  the sellers.
- `backup-watch` now reads the API and the backups' disk, and deletes
  expired idempotency records; its name stays, for the runbooks.
