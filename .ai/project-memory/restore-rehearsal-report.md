# Restoring for real, rehearsed — 2026-10-09

Baseline: `b213ef3` (customers' data, merged as PR #75).
Status: rehearsed end to end on a laptop, in Docker; two findings, both fixed
in the runbook; verified by the rehearsal run again after the fixes
([evidence](../../output/verification/2026-10-09-restore-rehearsal/rehearsal.md)).
Branch: `docs/restore-rehearsal`.

## Why this was next

With PR #75 merged, the owner chose it on 2026-10-09 from the candidates.
The nightly drill restores every copy into a scratch database, but the
runbook's "restoring for real" (backup runbook) had never run: the
sequence an administrator follows on the day a server is lost, from the
owner's encrypted copy to a working shop (release checklist, row 20). A
mistake in it is found on the worst day otherwise.

## How

A driver (`rehearse_restore.py`, kept beside the evidence) runs both
runbooks' commands as written, each in `/bin/sh` from `infra/`, in a shell
that has not read `.env`, as a fresh SSH session would be; `docker compose`
reads `.env` itself, as on the server.

- **The old server** (Compose project `birka-rehearsal-old`): the owner's
  key (`age-keygen`), the server runbook's steps 3, 4 and 6 (database,
  migration, `alembic check`, start, the owner and the shop's places), the
  shop used through Caddy and the real API (a model received 10; four
  sales, three in parts: one paid off and backdated two years, one paid off,
  one still owed), the first night by hand and its state (backup runbook,
  step 2). After that night: a fifth sale, and one customer erased on
  request. The owner's computer collects (`infra/pull-backups.sh`), the
  runbook's step 7 query is run on the old database, and the old server is
  destroyed with its volumes.
- **The new server** (`birka-rehearsal-new`): "restoring for real", steps
  1 to 8, with the owner's copy, the key and the same `.env`.

Isolation: its own Compose projects and volumes, Caddy on 127.0.0.1 only,
working files under `~/.cache/birka-runtime/rehearsal`, the images built
here the same day from the merged tree (nothing pulled or built), test
secrets made for the run and the tests' fake bot token. Everything it
started was removed; Docker was stopped as it was found.

## What held

- The old server set up by the runbook, the API ready, the first night
  `"ok": true` with its drill, `backup_watch --status` OK.
- The owner's computer collected the night whole.
- **1–3.** The newest drilled night chosen; decrypted with the owner's key;
  its SHA-256 equals the drilled archive's; the new database up.
- **5–6.** The migration a no-op (the code is not newer); the app started,
  ready, the owner signed in. The coat stands at 6 (10 received, 4 sold
  before the night); the night's four sales are there, the fifth, made
  after it, is not: at most a day lost, as the policy says.
- **7.** The customer past her term (closed two years before) was erased by
  the watcher within seconds of its start. The customer erased on request
  after the night was back; the runbook's query on the old database listed
  her debt, the query on the new one gave her name, the owner found her in
  «Борги» and erased her again.
- **8.** The new server's first night held, its state OK, and the owner's
  computer collected it beside the old server's night.

## Findings, and what changed

| Finding | Fixed |
|---|---|
| **Step 4 could not restore.** It passed `$POSTGRES_USER`, `$POSTGRES_PASSWORD` and `$POSTGRES_DB` from the administrator's shell, which has not read `.env`: empty there. `pg_restore` then had no password: on a terminal it asks for one, unattended it waited for ever (the first run was stopped after 900 s). Reading `.env` into the shell was rejected: a value with `&`, such as the heartbeat URL, breaks a shell that sources it. | **The restore goes through the database's own container** (`docker compose exec -T db sh -c 'pg_restore …' < backups/birka.dump`), which holds those values and takes a local connection without a password; the same `pg_restore` flags as the drill. Step 7's `psql` the same way. |
| **After a restore nothing is backed up.** The restored database holds no night of its own: the watcher says `NOT_SET_UP` (or overdue, with older nights), the owner is told daily, and no copy is made until backups are set up on the new server, which the runbook did not say. | **Step 8:** the backup directory, the first night by hand, `--status` OK, then cron, the read-only user and the owner's computer pointed at the new server. Rehearsed. |
| `pull-backups.sh` stopped with "HOME: unbound variable" when run without `HOME`, as a NAS's task scheduler may run it. | It names what to set: `HOME`, or `BIRKA_BACKUP_SSH_KEY`; test. |

## Not rehearsed

- **The SSH leg** to the owner's computer (backup runbook, step 3, `rrsync`):
  the collector read the server's directory as a local path.
- **`age` on the owner's computer:** it ran in the ops image (no installs on
  this Mac); the commands are the runbook's.
- **A real domain, its certificate, a server's disk, cron and logrotate,
  `sudo chown 10001`** (Docker Desktop's file sharing needs none).
- **A copy older than the newest night, and a dump with years of data.**
  The rehearsal restored one night of a small shop.

## CI, run locally

The change touches the docs, one shell script and its tests, so CI's backend
job ran on `146d035` (GitHub Actions is held by billing): passed with its
declared gap, 3 286 passed on PostgreSQL 17, 19 skipped (the backup tests:
no PostgreSQL 17 tools on this Mac); on 16.2, 18 of those passed, 1 skipped
(`age`) ([evidence](../../output/verification/2026-10-09-restore-rehearsal-ci-local/summary.md)).
The collector also ran under `/bin/dash`, with and without `HOME`, and a
mutant of its `HOME` check was caught.

Row 20 stays open: the sequence is to run once on the real server.
