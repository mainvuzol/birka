# Backup and restore — runbook

Status: tooling built and verified on 2026-09-30 (M1-028), see the
[report](m1-028-backup-restore-report.md). The owner decided the schedule,
retention, off-server copies and alerting the same day (business-rules.md,
"backups").

**Not done yet:** the steps below have not been carried out on a production
server.
The server itself is set up by the [server runbook](server-runbook.md), which
sends you here at its step 8.

The owner hears of every failed or missing night in the app and in Telegram
since the same day; see [how the owner hears of it](#how-the-owner-hears-of-it)
and the [alerts report](m1-028-backup-alerts-report.md).

## The policy

| | |
|---|---|
| How often | every day, at night |
| Kept on the server | every daily backup for 7 days; the first backup of each month for 3 months (about ten files) |
| Leaves the server | encrypted to the owner's age public key; the owner's own computer or NAS collects it, and deletes its nights older than 3 months (owner, 2026-10-09) |
| Private key | only the owner: password manager plus paper or a USB stick; never on the server or the NAS |
| At most lost in a restore | one day |
| Restore time | no fixed target; the same day. The restore itself takes seconds |

## What a night does

`docker compose --profile ops run --rm ops` runs `scripts.nightly_backup`:

1. **Back up.** `pg_dump` archive plus a manifest: SHA-256, migration,
   locale, triggers, and every table's row count, read in the snapshot
   `pg_dump` copies.
2. **Drill.** Restore the fresh archive into a scratch database with the
   source's locale, then check it:
   - every table's row count;
   - the triggers, which must all be enabled;
   - the locale, including `lower('ОЛЯ') = 'оля'`;
   - that the stock ledger reconciles in every organization.

   Then drop the scratch database. The result is written to
   `birka-<time>.drill.json`.
3. **Encrypt** the archive to the owner's key as `birka-<time>.dump.age`, and
   delete the plaintext. The server can make a copy it can never read back.
4. **Keep what the policy keeps**, and delete the rest. Only files this
   script named; never the newest; **never on a night that failed**.
5. **Write `last-run.json`, and the night's row in `backup_run`** — the one
   thing the job writes to the database, and what the owner's section and
   the Telegram message read. A night that cannot write its row has not
   held. Exit 0 only if every step held.

A night fails without the owner's public key. A night whose drill fails still
keeps its backup: a drill that fails on the data has found a problem in the
data, and the copy is still the best one there is.

**Not in any backup:**
- `.env` (`POSTGRES_PASSWORD`, the bot token, the session secret). Keep it in
  the password manager too. A lost session secret only signs everybody out; a
  lost bot token is reissued by @BotFather.
- Caddy's certificates, which it reissues.

## How the owner hears of it

The `backup-watch` service runs beside the app, restarted by Docker. Every 10
minutes it reads the nights in `backup_run` and decides:

| State | When | Telegram |
|---|---|---|
| OK | the newest night held, and ended less than 26 hours ago | nothing; after a warning, one «✅ знову працює» |
| FAILED | the newest night did not hold | once for that night, with what failed |
| OVERDUE | no night at all for 26 hours: cron, the ops image, or the database is broken | once, then once a day while it lasts |
| NOT_SET_UP | no night was ever recorded | once a day until the first one |

- **Who is told:** everyone holding `backup:view` organization-wide — the
  owner's role by default. A grant for one store is not enough: a backup is
  of the whole server.
- **Where:** the person's private chat with the shop's bot, **silently** —
  no sound, whatever the hour (owner decision, 2026-10-01): the owner reads
  the section. Telegram lets a bot write only to someone who has pressed
  «Start» in its chat. If Telegram
  refuses, the section says so and how to fix it.
- **The section** «Резервні копії» shows the state, what failed in words,
  the last good copy, the last 14 nights, and whether the last message
  reached the person reading.
- **Each message is recorded before it is sent**, once per person, so it
  goes out once however often the watcher looks. One that fails to send is
  tried five times, then given up and shown as failed in the section.

From the server, the state now:

```sh
docker compose run --rm backup-watch python -m scripts.backup_watch --status   # exit 0 only if OK
```

## Setting it up

### 1. The owner's key, on the owner's computer

```sh
brew install age            # macOS; on Linux: apt install age
age-keygen -o birka-backup-key.txt
```

- Keep the key file in the password manager, and print it or copy it to a
  USB stick kept somewhere else. Without it no backup can ever be read.
- Delete it from the disk afterwards.
- The public key (`age1…`, printed by `age-keygen`) is not secret.

### 2. The server

In `infra/.env`:

```
BIRKA_BACKUP_AGE_RECIPIENTS=age1…the owner's public key…
```

Then:

```sh
cd /srv/birka/infra
mkdir -p backups && sudo chown 10001 backups       # the image's user
docker compose --profile ops build ops             # again after every deploy
docker compose --profile ops run --rm ops          # the first night, by hand
cat backups/last-run.json                          # "ok": true
docker compose up -d backup-watch                  # with the app; `up -d` starts it too
docker compose run --rm backup-watch python -m scripts.backup_watch --status
```

The owner then opens the shop's bot in Telegram and presses «Start» once, so
the bot may write to them. The «Резервні копії» section shows whether the
last message got through.

Schedule it, in root's crontab:

```
15 3 * * * cd /srv/birka/infra && docker compose --profile ops run --rm ops >> /var/log/birka-backup.log 2>&1
```

That log grows by a few kilobytes a night, forever, unless it is rotated.
Rotate it monthly, keeping a year, in `/etc/logrotate.d/birka-backup`:

```
/var/log/birka-backup.log {
    monthly
    rotate 12
    compress
    missingok
    notifempty
}
```

A night that finds the previous one still running does not start a second
copy beside it: it records a failed night, `still_running`, and the owner
hears of it as of any failed night. Every step has a time limit, so a
night that hangs ends as a failed night too.

### 3. Read-only access for the owner's computer

On the server, a user that can do nothing but read the backup directory.
`rrsync` ships with rsync 3.2.4 and later:

```sh
sudo adduser --disabled-password --gecos "" birka-backup
sudo -u birka-backup mkdir -p ~birka-backup/.ssh
# One line in ~birka-backup/.ssh/authorized_keys, with the owner machine's public key:
command="rrsync -ro /srv/birka/infra/backups",restrict ssh-ed25519 AAAA… owner-nas
```

The files are world-readable (0644) inside a 0755 directory, so
`birka-backup` can read them without owning them.

### 4. The owner's computer or NAS collects them

```sh
ssh-keygen -t ed25519 -f ~/.ssh/birka_backup -N ""      # its public half goes in step 3
BIRKA_BACKUP_SOURCE=birka-backup@shop.example.com: \
BIRKA_BACKUP_DEST="$HOME/birka-backups" \
sh infra/pull-backups.sh
```

It collects only encrypted archives with their manifests and drill reports,
never a plaintext archive, and never overwrites a copy. It checks every
archive against the checksum the server recorded, and fails if one arrived
damaged.

Then it deletes the nights older than 3 months, as the server counts them
(owner, 2026-10-09; [ADR-0015](../decisions/ADR-0015-customer-data-retention.md)):
a customer's name erased in the app leaves every copy within 3 months. It
keeps the newest night whose archive is whole, whatever its age, and
touches only files named by a night's stamp. It deletes by date on every
run, also one that failed, and a failed run says why:
- `NOT COLLECTED: rsync exited …`: the server could not be reached. The
  copies here are checked and old nights deleted as usual; the next run
  collects what was missed.
- `DAMAGED OR MISSING: …dump.age`: that archive does not match its manifest,
  and is never collected again on its own. Delete that night's files here
  (`birka-<time>.*`) and run again: it is collected again while the server
  still has it.

A copy moved elsewhere by hand is the owner's to delete.

Run it daily, some hours after the server's night:
- on macOS, a launchd job or the Shortcuts app;
- on a NAS, its task scheduler;
- on Linux, cron.

## Restoring for real

Rehearsed end to end on a laptop, in Docker, on 2026-10-09: an old server
set up and backed up, destroyed, and a new one restored from the owner's
copy with these commands as written
([evidence](../../output/verification/2026-10-09-restore-rehearsal/rehearsal.md),
[report](restore-rehearsal-report.md)). That rehearsal fixed step 4 and
added step 8. Not yet on a production server (release checklist, row 20).
The nightly drill uses the same `pg_restore` flags, so a copy whose drill
passed restores with them.

1. Pick the newest night whose `birka-<time>.drill.json` says `"ok": true`.
2. On the owner's computer, open it with the key and check it is the archive
   that was drilled:
   ```sh
   age --decrypt -i birka-backup-key.txt -o birka.dump birka-<time>.dump.age
   shasum -a 256 birka.dump        # equals "archive_sha256" in birka-<time>.json
   ```
3. Copy `birka.dump` to the new server's `infra/backups/` (or the
   `BIRKA_BACKUP_DIR` its `.env` names), with the new server's `.env` from
   the password manager in `infra/`, then bring up `db` only:
   ```sh
   docker compose up -d --wait db
   ```
4. Restore into the empty database, from `infra/`, through the database's
   own container:
   ```sh
   docker compose exec -T db sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --exit-on-error --single-transaction --no-owner --no-privileges' < backups/birka.dump
   ```
   The container holds the user, the password and the database from `.env`,
   and takes a local connection without a password; the single quotes keep
   those names for its shell. The server's own shell has not read `.env`:
   `$POSTGRES_PASSWORD` typed there is empty, and `pg_restore` would ask for
   a password, or wait for ever unattended (rehearsal, 2026-10-09). No output
   means it held.
5. If the code is newer than the backup:
   ```sh
   docker compose run --rm --no-deps api alembic upgrade head
   ```
6. `docker compose up -d`, then sign in and open a stock view. Delete the
   plaintext `birka.dump` once the shop is running.
7. **Customers erased since that night** (owner, 2026-10-09;
   [ADR-0015](../decisions/ADR-0015-customer-data-retention.md)). The
   `backup-watch` service erases again, within the hour of starting, every
   customer whose term has run out. A customer erased on request after that
   night is back. If the old server's database can still be read, list
   those erasures there before it goes, in
   `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'`:
   ```sql
   SELECT entity_id AS credit_id, created_at FROM audit_log
   WHERE action = 'credit.customer_erased' AND after->>'by' = 'request'
     AND created_at > '<the night restored>'
   ORDER BY created_at;
   ```
   On the restored server, where those names are back, read them for the
   owner, in the same `psql`:
   ```sql
   SELECT id, customer_name FROM customer_credit WHERE id IN ('<credit_id>', …);
   ```
   The owner finds each in «Борги» by the name and presses «Стерти дані
   покупця» again. If the old database is gone, the owner repeats the ones
   they remember: from the newest night, at most a day of them.
8. **Backups on the new server.** The restored database holds no night of
   its own, so until one runs there the owner's section and the bot say the
   backups are not set up, or overdue, and nothing is copied. As in
   [setting it up](#setting-it-up), with the same key (`.env` already names
   it):
   ```sh
   mkdir -p backups && sudo chown 10001 backups
   docker compose --profile ops run --rm ops         # the new server's first night
   docker compose run --rm backup-watch python -m scripts.backup_watch --status   # "OK", exit 0
   ```
   Then cron and its log rotation (step 2), the read-only user (step 3), and
   the owner's computer pointed at the new server: its
   `BIRKA_BACKUP_SOURCE` (step 4). The old server's nights stay on the
   owner's computer beside the new ones, and go by date.

Anything written after that night is lost: at most one day, by the policy.
