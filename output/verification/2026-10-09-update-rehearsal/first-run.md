# Rehearsal: a new version, and going back

From `6867576` (#74, schema 0037) to `fb567b8` (main, 0038), on one server whose checkout is a local clone; started 2026-10-09 20:03:03 EEST. The password is base64 as the runbook makes it; test secrets, the tests' fake bot token.

## Installed at 6867576 (server runbook, steps 3, 4 and 6)

**Build, database, migration, start** — held (exit 0, 9.3 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend
docker compose up -d --wait db
docker compose run --rm --no-deps api alembic upgrade head
docker compose up -d
```

```
 Volume birka-rehearsal-update_web_dist Creating 
 Volume birka-rehearsal-update_web_dist Creating 
 Container birka-rehearsal-update-backup-watch-1 Creating 
 Volume birka-rehearsal-update_caddy_data Creating 
 Volume birka-rehearsal-update_caddy_config Created 
 Volume birka-rehearsal-update_caddy_config Created 
 Volume birka-rehearsal-update_caddy_data Created 
 Volume birka-rehearsal-update_caddy_data Created 
 Volume birka-rehearsal-update_web_dist Created 
 Volume birka-rehearsal-update_web_dist Created 
 Container birka-rehearsal-update-web-1 Creating 
 Container birka-rehearsal-update-web-1 Created 
 Container birka-rehearsal-update-api-1 Created 
 Container birka-rehearsal-update-caddy-1 Creating 
 Container birka-rehearsal-update-backup-watch-1 Created 
 Container birka-rehearsal-update-caddy-1 Created 
 Container birka-rehearsal-update-web-1 Starting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Started 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-backup-watch-1 Starting 
 Container birka-rehearsal-update-api-1 Starting 
 Container birka-rehearsal-update-backup-watch-1 Started 
 Container birka-rehearsal-update-api-1 Started 
 Container birka-rehearsal-update-web-1 Waiting 
 Container birka-rehearsal-update-web-1 Exited 
 Container birka-rehearsal-update-caddy-1 Starting 
 Container birka-rehearsal-update-caddy-1 Started
```

**The owner and the shop's places** — held (exit 0, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api python -m scripts.seed_organization --telegram-user-id 700000101 --owner-name "Власниця" --org-name "Оновлення"
```

```
seed complete for organization bc28c846-4329-4f95-bbb7-d75ec7d23359
 Container birka-rehearsal-update-api-run-8757be83a1d1 Creating 
 Container birka-rehearsal-update-api-run-8757be83a1d1 Created
```

Used through the app: a model received 10, three sales, two in parts (Марія paid off, Ірина owes 1000).

## 1. A new version: 6867576 → fb567b8

**The runbook's block** — DID NOT HOLD (exit 56, 6.7 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka checkout fb567b8
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose run --rm --no-deps api alembic upgrade head   # if this fails, stop here: see below
docker compose up -d
curl -kfsS https://localhost:58743/api/v1/ready   # -k: the rehearsal's local certificate
```

```
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-ops-run-6e086eb4f8fa Creating 
 Container birka-rehearsal-update-ops-run-6e086eb4f8fa Created 
Previous HEAD position was 6867576 feat(stock-import): the shops' existing stock from a parser's JSON file — several files to a warehouse's list, every line reviewed, a split the line shows confirmed by a tap (#74)
HEAD is now at fb567b8 docs(backups): restoring for real rehearsed end to end — its restore command fixed, and backups set up again on the new server (#76)
 Container birka-rehearsal-update-api-run-5f4232a7bab5 Creating 
 Container birka-rehearsal-update-api-run-5f4232a7bab5 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade 0037_stock_list_parts -> 0038_customer_erasure, A customer's name and phone are erased from a debt once it has been closed long enough, or on the owner's word. Owner decision, 2026-10-09; ADR-0015.
 Container birka-rehearsal-update-caddy-1 Running 
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-backup-watch-1 Recreate 
 Container birka-rehearsal-update-api-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreated 
 Container birka-rehearsal-update-api-1 Recreated 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Starting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Started 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-backup-watch-1 Starting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-api-1 Starting 
 Container birka-rehearsal-update-backup-watch-1 Started 
 Container birka-rehearsal-update-api-1 Started 
 Container birka-rehearsal-update-web-1 Waiting 
 Container birka-rehearsal-update-web-1 Exited 
curl: (56) The requested URL returned error: 502
```

**Removed** — ran (exit 0, 3.6 s)

```sh
export BIRKA_RELEASE=x
docker compose down -v
```

```
Container birka-rehearsal-update-caddy-1 Stopping 
 Container birka-rehearsal-update-backup-watch-1 Stopping 
 Container birka-rehearsal-update-caddy-1 Stopped 
 Container birka-rehearsal-update-caddy-1 Removing 
 Container birka-rehearsal-update-caddy-1 Removed 
 Container birka-rehearsal-update-web-1 Stopping 
 Container birka-rehearsal-update-api-1 Stopping 
 Container birka-rehearsal-update-web-1 Stopped 
 Container birka-rehearsal-update-web-1 Removing 
 Container birka-rehearsal-update-web-1 Removed 
 Container birka-rehearsal-update-backup-watch-1 Stopped 
 Container birka-rehearsal-update-backup-watch-1 Removing 
 Container birka-rehearsal-update-backup-watch-1 Removed 
 Container birka-rehearsal-update-api-1 Stopped 
 Container birka-rehearsal-update-api-1 Removing 
 Container birka-rehearsal-update-api-1 Removed 
 Container birka-rehearsal-update-db-1 Stopping 
 Container birka-rehearsal-update-db-1 Stopped 
 Container birka-rehearsal-update-db-1 Removing 
 Container birka-rehearsal-update-db-1 Removed 
 Volume birka-rehearsal-update_caddy_data Removing 
 Volume birka-rehearsal-update_db_data Removing 
 Network birka-rehearsal-update_default Removing 
 Volume birka-rehearsal-update_caddy_config Removing 
 Volume birka-rehearsal-update_web_dist Removing 
 Volume birka-rehearsal-update_caddy_config Removed 
 Volume birka-rehearsal-update_caddy_data Removed 
 Volume birka-rehearsal-update_web_dist Removed 
 Volume birka-rehearsal-update_db_data Removed 
 Network birka-rehearsal-update_default Removed
```

## Findings

None.
Traceback (most recent call last):
  File "/Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/rehearse_update.py", line 462, in <module>
    sys.exit(main())
             ^^^^^^
  File "/Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/rehearse_update.py", line 328, in main
    server.sh("export BIRKA_RELEASE=$(git -C {0} rev-parse --short HEAD)\n".format(SRV) + update_block(new),
  File "/Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/rehearse_update.py", line 139, in sh
    raise RuntimeError(f"{title} exited {done.returncode}")
RuntimeError: The runbook's block exited 56
exit=1
