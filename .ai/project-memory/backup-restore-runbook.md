# Backup and restore — runbook

Status: tooling built and verified on 2026-09-30 (M1-028), see the
[report](m1-028-backup-restore-report.md). **Not yet scheduled on a
production server, and no copy leaves the server**: both wait on the owner's
answers at the end of this page.

## What a backup is here

`python -m scripts.backup_database --out <dir>` writes two files:

- `birka-<UTC time>.dump` — the whole database, `pg_dump --format=custom`.
- `birka-<UTC time>.json` — its manifest:
  - the archive's SHA-256;
  - the migration revision;
  - the database's locale;
  - every trigger and its state;
  - the row count of every table, read in the same snapshot `pg_dump`
    copies.

It only reads the database, and it never deletes or overwrites a file.

**Not in the backup:**

- `.env`: `POSTGRES_PASSWORD`, the bot token, the session secret. Keep them
  in a password manager. A lost session secret only signs everybody out; a
  lost bot token is reissued by @BotFather.
- Caddy's certificates. Caddy reissues them.

## Running it on the server

The `ops` service in `infra/docker-compose.yml` is the API's image plus the
PostgreSQL 17 client tools. It receives the database URL and nothing else.

```sh
cd infra
mkdir -p backups && sudo chown 10001 backups        # once; the image's user
docker compose --profile ops build ops              # after each deploy
docker compose --profile ops run --rm ops           # take a backup
```

`BIRKA_BACKUP_DIR` moves the directory, for example onto another disk.

## The restore drill

A backup that has never been restored is not a backup. Run a drill on a
new backup at least once, and after every deploy that adds a migration.

```sh
docker compose --profile ops run --rm ops \
  python -m scripts.restore_drill /backups/birka-<time>.dump --report /backups/drill-<time>.json
```

What the drill does:

1. Checks the archive's SHA-256 before anything else.
2. Creates `birka_restore_drill_<time>_<random>` on the same server, with the
   source's locale.
3. Restores into it in one transaction, stopping at the first error.
4. Compares the copy with the manifest:
   - the migration;
   - every table and its row count;
   - the triggers, which must all be enabled;
   - the locale, and whether `lower('ОЛЯ')` gives `'оля'`.
5. Reconciles the stock ledger for every organization (invariant I3).
6. Drops the scratch database.

It writes to no other database. Exit status 0 means every check passed. The
report's `restore_seconds` is the evidence for how long a real restore takes.

## Restoring for real

Not rehearsed on a production server yet. The drill uses the same
`pg_restore` flags, so a file that passes a drill restores with them.

1. Pick the newest backup whose drill passed. If none has been drilled, drill
   it first.
2. On the new server, bring up `db` only:
   ```sh
   docker compose up -d --wait db
   ```
   The image creates an empty `POSTGRES_DB`, with the production locale from
   `POSTGRES_INITDB_ARGS`.
3. Restore into it:
   ```sh
   docker compose --profile ops run --rm \
     -e PGHOST=db -e PGUSER="$POSTGRES_USER" -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE="$POSTGRES_DB" \
     ops sh -c '"$BIRKA_PG_BIN/pg_restore" --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$PGDATABASE" /backups/birka-<time>.dump'
   ```
4. If the code is newer than the backup (the drill report's `note` says so),
   run:
   ```sh
   docker compose run --rm --no-deps api alembic upgrade head
   ```
5. `docker compose up -d`, then sign in and open a stock view.

Anything written after the backup was taken is lost. That window is the RPO
below.

## Owner decisions this waits on

None of these is guessed in code. Until they are answered, backups are taken
by hand and stay on the server that holds the database — the one place a
disk failure takes both.

1. **RPO — how much can be lost?** That is, how many hours of sales may a
   restore lose? This sets how often a backup runs. For example, every 6
   hours:
   ```
   0 */6 * * * cd /srv/birka/infra && docker compose --profile ops run --rm ops
   ```
   A window of minutes needs continuous WAL archiving, which is not built.
2. **RTO — how long may the shop be without the app?** The drill measures
   the restore time; the answer says whether that is fast enough.
3. **Retention — how many backups, for how long?** Nothing deletes a backup
   today.
4. **Where copies go off the server, and who holds the key.** For example,
   an encrypted copy to a cloud bucket or to a second machine. A backup on
   the same disk as the database protects against mistakes, not against
   losing the server.
5. **Who is told when a backup or a drill fails, and how often a drill
   runs.**
