# Backup and restore — runbook

Status: tooling built and verified on 2026-09-30 (M1-028), see the
[report](m1-028-backup-restore-report.md). The owner decided the schedule,
retention, off-server copies and alerting the same day (business-rules.md,
"backups").

**Not done yet:** the steps below have not been carried out on a production
server.

The owner hears of every failed or missing night in the app and in Telegram
since the same day; see [how the owner hears of it](#how-the-owner-hears-of-it)
and the [alerts report](m1-028-backup-alerts-report.md).

## The policy

| | |
|---|---|
| How often | every day, at night |
| Kept on the server | every daily backup for 7 days; the first backup of each month for 3 months (about ten files) |
| Leaves the server | encrypted to the owner's age public key; the owner's own computer or NAS collects it |
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
never a plaintext archive. It deletes nothing, so this copy outlives the
server's retention. It checks every archive against the checksum the server
recorded, and fails if one arrived damaged.

Run it daily, some hours after the server's night:
- on macOS, a launchd job or the Shortcuts app;
- on a NAS, its task scheduler;
- on Linux, cron.

## Restoring for real

Not yet rehearsed on a production server. The nightly drill uses the same
`pg_restore` flags, so a copy whose drill passed restores with them.

1. Pick the newest night whose `birka-<time>.drill.json` says `"ok": true`.
2. On the owner's computer, open it with the key and check it is the archive
   that was drilled:
   ```sh
   age --decrypt -i birka-backup-key.txt -o birka.dump birka-<time>.dump.age
   shasum -a 256 birka.dump        # equals "archive_sha256" in birka-<time>.json
   ```
3. Copy `birka.dump` to the new server's `infra/backups/`, then bring up `db`
   only:
   ```sh
   docker compose up -d --wait db
   ```
4. Restore into the empty database:
   ```sh
   docker compose --profile ops run --rm \
     -e PGHOST=db -e PGUSER="$POSTGRES_USER" -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE="$POSTGRES_DB" \
     ops sh -c '"$BIRKA_PG_BIN/pg_restore" --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$PGDATABASE" /backups/birka.dump'
   ```
5. If the code is newer than the backup:
   ```sh
   docker compose run --rm --no-deps api alembic upgrade head
   ```
6. `docker compose up -d`, then sign in and open a stock view. Delete the
   plaintext `birka.dump` once the shop is running.

Anything written after that night is lost: at most one day, by the policy.
