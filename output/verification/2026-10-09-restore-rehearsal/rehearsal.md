# Rehearsal: restoring for real

Commit b213ef3; started 2026-10-09 19:16:42 EEST. Test secrets made for this run; the bot token is the tests' fake one.

## The owner's key (backup runbook, setting it up, step 1)

`age-keygen -o birka-backup-key.txt`, run in the ops image (age is not installed on this Mac; the owner's computer has it). Public key `age14jw64977…`.

## The old server (server runbook, steps 3, 4 and 6; backup runbook, step 2)

**Database up** — held (exit 0, 5.8 s)

```sh
docker compose up -d --wait db
```

```
Network birka-rehearsal-old_default Creating 
 Volume birka-rehearsal-old_db_data Creating 
 Volume birka-rehearsal-old_db_data Creating 
 Network birka-rehearsal-old_default Creating 
 Volume birka-rehearsal-old_db_data Created 
 Volume birka-rehearsal-old_db_data Created 
 Network birka-rehearsal-old_default Created 
 Network birka-rehearsal-old_default Created 
 Container birka-rehearsal-old-db-1 Creating 
 Container birka-rehearsal-old-db-1 Created 
 Container birka-rehearsal-old-db-1 Starting 
 Container birka-rehearsal-old-db-1 Started 
 Container birka-rehearsal-old-db-1 Waiting 
 Container birka-rehearsal-old-db-1 Healthy
```

**Migrate** — held (exit 0, 1.2 s)

```sh
docker compose run --rm --no-deps api alembic upgrade head
```

```
INFO  [alembic.runtime.migration] Running upgrade 0013_catalog_knowledge -> 0014_alias_feedback_identity, One evidence event per decision and alias, without rewriting history.
INFO  [alembic.runtime.migration] Running upgrade 0014_alias_feedback_identity -> 0015_snapshot_import, Legacy snapshot import: who acts, a safe retry, several sizes per line, a frozen record. M1-023.
INFO  [alembic.runtime.migration] Running upgrade 0015_snapshot_import -> 0016_goods_receipt, A goods receipt becomes a business operation, not just its side effects.
INFO  [alembic.runtime.migration] Running upgrade 0016_goods_receipt -> 0017_stock_adjustment, A stock adjustment becomes a business operation. ADR-0007.
INFO  [alembic.runtime.migration] Running upgrade 0017_stock_adjustment -> 0018_backup_alerts, The owner hears about the server's backups. M1-028.
INFO  [alembic.runtime.migration] Running upgrade 0018_backup_alerts -> 0019_till_returns, Returns at the till: intact or damaged, and each store's «Брак». M1-027.
INFO  [alembic.runtime.migration] Running upgrade 0019_till_returns -> 0020_damaged_units, The «Брак» section: one row per unit returned damaged. M1-027.
INFO  [alembic.runtime.migration] Running upgrade 0020_damaged_units -> 0021_suggested_price, Who may set a suggested selling price. M1-028, owner question Q-F.
INFO  [alembic.runtime.migration] Running upgrade 0021_suggested_price -> 0022_shelf_shortage, The empty shelf: a basket nothing of which was there. M1-030, owner question Q-G.
INFO  [alembic.runtime.migration] Running upgrade 0022_shelf_shortage -> 0023_customer_credit, A sale paid in parts: what the customer owes. Owner decisions, 2026-10-01.
INFO  [alembic.runtime.migration] Running upgrade 0023_customer_credit -> 0024_returns_elsewhere, Returns at another store. Owner decisions, 2026-10-01.
INFO  [alembic.runtime.migration] Running upgrade 0024_returns_elsewhere -> 0025_store_states, Store states: trading, blocked, archived. Owner decisions, 2026-10-01.
INFO  [alembic.runtime.migration] Running upgrade 0025_store_states -> 0026_supplier_returns, Returns to a supplier. Owner decisions, 2026-10-01.
INFO  [alembic.runtime.migration] Running upgrade 0026_supplier_returns -> 0027_supplier_invoices, What a store owes its suppliers. Owner decisions, 2026-10-01.
INFO  [alembic.runtime.migration] Running upgrade 0027_supplier_invoices -> 0028_order_shipping, Where an order goes. Owner decisions, 2026-10-01.
INFO  [alembic.runtime.migration] Running upgrade 0028_order_shipping -> 0029_borrowed_goods, Borrowed goods, and goods under consignment. Owner decisions, 2026-10-01.
INFO  [alembic.runtime.migration] Running upgrade 0029_borrowed_goods -> 0030_opening_list_hold, A warehouse waits for its opening list. Owner decision, 2026-10-02.
INFO  [alembic.runtime.migration] Running upgrade 0030_opening_list_hold -> 0031_catalog_correction, Correcting the catalogue. Owner decision, 2026-10-03; ADR-0008.
INFO  [alembic.runtime.migration] Running upgrade 0031_catalog_correction -> 0032_size_spelling, One size, one spelling. Owner decision, 2026-10-03; ADR-0009.
INFO  [alembic.runtime.migration] Running upgrade 0032_size_spelling -> 0033_session_epoch, Ending a person's sign-ins. Owner decision, 2026-10-03.
INFO  [alembic.runtime.migration] Running upgrade 0033_session_epoch -> 0034_server_incidents, Trouble on the server, kept. Owner decision, 2026-10-03.
INFO  [alembic.runtime.migration] Running upgrade 0034_server_incidents -> 0035_cash_and_card, Cash and card, the day's close. Owner decisions, 2026-10-04; ADR-0012.
INFO  [alembic.runtime.migration] Running upgrade 0035_cash_and_card -> 0036_outage_mark, The mark «продано під час збою». Owner decisions, 2026-10-04 and 2026-10-07; ADR-0013.
INFO  [alembic.runtime.migration] Running upgrade 0036_outage_mark -> 0037_stock_list_parts, A stock list filled by parts: a parser's file, or lines typed by hand. Owner decision, 2026-10-08; ADR-0014.
INFO  [alembic.runtime.migration] Running upgrade 0037_stock_list_parts -> 0038_customer_erasure, A customer's name and phone are erased from a debt once it has been closed long enough, or on the owner's word. Owner decision, 2026-10-09; ADR-0015.
```

**alembic check** — held (exit 0, 0.9 s)

```sh
docker compose run --rm --no-deps api alembic check
```

```
No new upgrade operations detected.
 Container birka-rehearsal-old-api-run-5defa785bfab Creating 
 Container birka-rehearsal-old-api-run-5defa785bfab Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.schemas
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.tables
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.types
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.constraints
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.defaults
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.comments
```

**Start it** — held (exit 0, 1.4 s)

```sh
docker compose up -d
```

```
 Volume birka-rehearsal-old_caddy_config Created 
 Volume birka-rehearsal-old_caddy_data Created 
 Volume birka-rehearsal-old_caddy_data Created 
 Volume birka-rehearsal-old_web_dist Created 
 Volume birka-rehearsal-old_web_dist Created 
 Container birka-rehearsal-old-web-1 Creating 
 Container birka-rehearsal-old-api-1 Created 
 Container birka-rehearsal-old-web-1 Created 
 Container birka-rehearsal-old-caddy-1 Creating 
 Container birka-rehearsal-old-backup-watch-1 Created 
 Container birka-rehearsal-old-caddy-1 Created 
 Container birka-rehearsal-old-db-1 Waiting 
 Container birka-rehearsal-old-db-1 Waiting 
 Container birka-rehearsal-old-web-1 Starting 
 Container birka-rehearsal-old-web-1 Started 
 Container birka-rehearsal-old-db-1 Healthy 
 Container birka-rehearsal-old-api-1 Starting 
 Container birka-rehearsal-old-db-1 Healthy 
 Container birka-rehearsal-old-backup-watch-1 Starting 
 Container birka-rehearsal-old-api-1 Started 
 Container birka-rehearsal-old-web-1 Waiting 
 Container birka-rehearsal-old-backup-watch-1 Started 
 Container birka-rehearsal-old-web-1 Exited 
 Container birka-rehearsal-old-caddy-1 Starting 
 Container birka-rehearsal-old-caddy-1 Started
```

`https://localhost:58643/api/v1/ready` answers 200.

**The owner and the shop's places** — held (exit 0, 0.9 s)

```sh
docker compose run --rm --no-deps api python -m scripts.seed_organization --telegram-user-id 700000001 --owner-name "Власниця" --org-name "Репетиція"
```

```
seed complete for organization 7d512dec-f121-423c-82b1-ad3418ffacff
 Container birka-rehearsal-old-api-run-f879f8a0ad28 Creating 
 Container birka-rehearsal-old-api-run-f879f8a0ad28 Created
```

Through the app (Caddy, the owner signed in): a coat model received 10; four sales, three of them in parts (Ганна and Олена paid off, Ірина still owes 1000).

**The watcher's log** — ran (exit 0, 0.1 s)

```sh
docker compose logs backup-watch
```

```
backup-watch-1  | {"logger": "__main__", "every_seconds": 600, "certificate": null, "administrators": 0, "check_in": false, "event": "backup_watch.started", "level": "info", "timestamp": "2026-10-09T16:16:53.370591Z"}
backup-watch-1  | {"logger": "__main__", "error": "ClientConnectorError: Cannot connect to host api:8000 ssl:default [Connect call failed ('172.18.0.3', 8000)]", "event": "backup_watch.api_unanswered", "level": "warning", "timestamp": "2026-10-09T16:16:53.398668Z"}
backup-watch-1  | {"logger": "__main__", "deleted": 0, "event": "backup_watch.idempotency_purged", "level": "info", "timestamp": "2026-10-09T16:16:53.435728Z"}
```

**Ганна's debt closed two years ago (SQL, for the rehearsal only)** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
UPDATE customer_credit SET closed_at = now() - interval '2 years' WHERE id = 'bc4995b3-3b59-47b3-9be9-e2a4aab447d8'
SQL
```

```
UPDATE 1
```

## The first night (backup runbook, step 2)

**The backup directory** — ran (exit 0, 0.0 s)

```sh
ls -ld "$(sed -n 's/^BIRKA_BACKUP_DIR=//p' "$COMPOSE_ENV_FILES")"
```

```
drwxr-xr-x@ 2 nikitahlushak  staff  64 Oct  9 19:16 /Users/nikitahlushak/.cache/birka-runtime/rehearsal/work/old-backups
```

**The first night, by hand** — held (exit 0, 2.9 s)

```sh
docker compose --profile ops run --rm ops
```

```
{"started_at": "2026-10-09T16:17:12.951035+00:00", "ok": true, "problems": [], "archive": "birka-20261009T161712Z.dump.age", "bytes": 346272, "rows": 130, "drill": {"ok": true, "restore_seconds": 0.181, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T16:17:13.448980+00:00"}
 Container birka-rehearsal-old-db-1 Running 
 Container birka-rehearsal-old-db-1 Waiting 
 Container birka-rehearsal-old-db-1 Healthy 
 Container birka-rehearsal-old-ops-run-7f46d143996d Creating 
 Container birka-rehearsal-old-ops-run-7f46d143996d Created
```

**Ганна is still named in the night's copy** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT customer_name FROM customer_credit WHERE id = 'bc4995b3-3b59-47b3-9be9-e2a4aab447d8'
SQL
```

```
Ганна Давня
```

`cat backups/last-run.json`: `"ok": true`.

**The backups' state now** — ran (exit 0, 2.4 s)

```sh
docker compose run --rm backup-watch python -m scripts.backup_watch --status
```

```
{"state": "OK", "checked_at": "2026-10-09T16:17:15.921470+00:00", "latest": {"finished_at": "2026-10-09T16:17:13.448980+00:00", "ok": true, "archive": "birka-20261009T161712Z.dump.age", "problems": []}}
 Container birka-rehearsal-old-db-1 Running 
 Container birka-rehearsal-old-db-1 Waiting 
 Container birka-rehearsal-old-db-1 Healthy 
 Container birka-rehearsal-old-backup-watch-run-f4f973684a77 Creating 
 Container birka-rehearsal-old-backup-watch-run-f4f973684a77 Created
```

## After the night: what a restore of it loses, or brings back

A fifth sale (93f647fc), and Олена asked to be erased: erased 1, network True.

## The owner's computer collects (backup runbook, step 4)

**`sh infra/pull-backups.sh`**, the server's directory as a local path (the SSH leg, step 3, is not rehearsed) — exit 0

```
1 encrypted backups here are whole; 0 damaged or missing
0 nights older than 3 months deleted here
```

## Before the old server goes: who asked since that night (restoring, step 7)

**The runbook's query, on the old database** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT entity_id AS credit_id, created_at FROM audit_log WHERE action = 'credit.customer_erased' AND after->>'by' = 'request' AND created_at > '2026-10-09 16:17:12+00' ORDER BY created_at;
SQL
```

```
c0130d53-3b60-481d-a8b1-181ee018e2f3|2026-10-09 16:17:16.250112+00
```

**The old server is gone** — held (exit 0, 1.1 s)

```sh
docker compose down -v
```

```
 Container birka-rehearsal-old-web-1 Stopping 
 Container birka-rehearsal-old-api-1 Stopping 
 Container birka-rehearsal-old-web-1 Stopped 
 Container birka-rehearsal-old-web-1 Removing 
 Container birka-rehearsal-old-web-1 Removed 
 Container birka-rehearsal-old-backup-watch-1 Stopped 
 Container birka-rehearsal-old-backup-watch-1 Removing 
 Container birka-rehearsal-old-backup-watch-1 Removed 
 Container birka-rehearsal-old-api-1 Stopped 
 Container birka-rehearsal-old-api-1 Removing 
 Container birka-rehearsal-old-api-1 Removed 
 Container birka-rehearsal-old-db-1 Stopping 
 Container birka-rehearsal-old-db-1 Stopped 
 Container birka-rehearsal-old-db-1 Removing 
 Container birka-rehearsal-old-db-1 Removed 
 Volume birka-rehearsal-old_caddy_data Removing 
 Volume birka-rehearsal-old_web_dist Removing 
 Volume birka-rehearsal-old_caddy_config Removing 
 Volume birka-rehearsal-old_db_data Removing 
 Network birka-rehearsal-old_default Removing 
 Volume birka-rehearsal-old_caddy_data Removed 
 Volume birka-rehearsal-old_caddy_config Removed 
 Volume birka-rehearsal-old_db_data Removed 
 Volume birka-rehearsal-old_web_dist Removed 
 Network birka-rehearsal-old_default Removed
```

## Restoring for real (backup runbook), on a new server

**1.** The newest night whose drill held: `birka-20261009T161712Z`.

**2.** `age --decrypt -i birka-backup-key.txt -o birka.dump …` (in the ops image: no age on this Mac), then `shasum -a 256 birka.dump`: equals `archive_sha256`.

**3. The database only** — held (exit 0, 5.7 s)

```sh
docker compose up -d --wait db
```

```
Network birka-rehearsal-new_default Creating 
 Volume birka-rehearsal-new_db_data Creating 
 Volume birka-rehearsal-new_db_data Creating 
 Network birka-rehearsal-new_default Creating 
 Volume birka-rehearsal-new_db_data Created 
 Volume birka-rehearsal-new_db_data Created 
 Network birka-rehearsal-new_default Created 
 Network birka-rehearsal-new_default Created 
 Container birka-rehearsal-new-db-1 Creating 
 Container birka-rehearsal-new-db-1 Created 
 Container birka-rehearsal-new-db-1 Starting 
 Container birka-rehearsal-new-db-1 Started 
 Container birka-rehearsal-new-db-1 Waiting 
 Container birka-rehearsal-new-db-1 Healthy
```

**4. Restore, the runbook's command as written** — ran (exit 1, 0.8 s)

```sh
docker compose --profile ops run --rm \
  -e PGHOST=db -e PGUSER="$POSTGRES_USER" -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE="$POSTGRES_DB" \
  ops sh -c '"$BIRKA_PG_BIN/pg_restore" --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$PGDATABASE" /backups/birka.dump'
```

```
Container birka-rehearsal-new-db-1 Running 
 Container birka-rehearsal-new-db-1 Waiting 
 Container birka-rehearsal-new-db-1 Healthy 
 Container birka-rehearsal-new-ops-run-4d115c7762ee Creating 
 Container birka-rehearsal-new-ops-run-4d115c7762ee Created 
Password: 
pg_restore: error: connection to server at "db" (172.18.0.2), port 5432 failed: fe_sendauth: no password supplied
```

> **Finding:** step 4 as written does not restore: in a shell that has not read `.env` (a fresh SSH session) `$POSTGRES_USER`, `$POSTGRES_PASSWORD` and `$POSTGRES_DB` are empty, so `pg_restore` has no password; on a terminal it asks for one, unattended it waits for ever (the first run here was stopped after 900 s). Fixed: restore through the database container, which holds those values and needs no password for a local connection


**4. Restore, as the runbook now says** — held (exit 0, 0.3 s)

```sh
docker compose exec -T db sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --exit-on-error --single-transaction --no-owner --no-privileges' < backups/birka.dump
```

```

```

**5. Migrate (the code is not newer)** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api alembic upgrade head
```

```
Container birka-rehearsal-new-api-run-13998335dc08 Creating 
 Container birka-rehearsal-new-api-run-13998335dc08 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
```

**6. Start it** — held (exit 0, 1.4 s)

```sh
docker compose up -d
```

```
 Volume birka-rehearsal-new_caddy_data Created 
 Volume birka-rehearsal-new_web_dist Created 
 Volume birka-rehearsal-new_web_dist Created 
 Container birka-rehearsal-new-web-1 Creating 
 Volume birka-rehearsal-new_caddy_config Created 
 Volume birka-rehearsal-new_caddy_config Created 
 Container birka-rehearsal-new-web-1 Created 
 Container birka-rehearsal-new-api-1 Created 
 Container birka-rehearsal-new-caddy-1 Creating 
 Container birka-rehearsal-new-backup-watch-1 Created 
 Container birka-rehearsal-new-caddy-1 Created 
 Container birka-rehearsal-new-db-1 Waiting 
 Container birka-rehearsal-new-web-1 Starting 
 Container birka-rehearsal-new-db-1 Waiting 
 Container birka-rehearsal-new-web-1 Started 
 Container birka-rehearsal-new-db-1 Healthy 
 Container birka-rehearsal-new-db-1 Healthy 
 Container birka-rehearsal-new-api-1 Starting 
 Container birka-rehearsal-new-backup-watch-1 Starting 
 Container birka-rehearsal-new-api-1 Started 
 Container birka-rehearsal-new-web-1 Waiting 
 Container birka-rehearsal-new-backup-watch-1 Started 
 Container birka-rehearsal-new-web-1 Exited 
 Container birka-rehearsal-new-caddy-1 Starting 
 Container birka-rehearsal-new-caddy-1 Started
```

`https://localhost:58644/api/v1/ready` answers 200.

**6. docker compose ps** — ran (exit 0, 0.1 s)

```sh
docker compose ps --format '{{.Service}} {{.State}} {{.Health}}'
```

```
api running starting
backup-watch running 
caddy running 
db running healthy
```

**6.** A stock view: the coat stands at 6 (10 received, 4 sold before the night: 6).

**6.** Signed in as the owner. Sales: 4; the night's four are there, the one after it is not (lost, at most a day by the policy).

Ірина, still owing: `Ірина Винна`.

Олена, erased after the night: `Олена Пізня`.

**7.** Customers erased since that night

Ганна, past her term: erased by the watcher as it started: yes.

**The runbook's query, on the restored server** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT id, customer_name FROM customer_credit WHERE id IN ('c0130d53-3b60-481d-a8b1-181ee018e2f3');
SQL
```

```
c0130d53-3b60-481d-a8b1-181ee018e2f3|Олена Пізня
```

The owner finds «Олена Пізня» in «Борги»: 1 customer(s).

«Стерти дані покупця» again: erased 1.

Олена after step 7: `None`.

**The backups' state on the new server, before step 8** — ran (exit 1, 2.3 s)

```sh
docker compose run --rm backup-watch python -m scripts.backup_watch --status
```

```
{"state": "NOT_SET_UP", "checked_at": "2026-10-09T16:17:31.241049+00:00", "latest": null}
 Container birka-rehearsal-new-db-1 Running 
 Container birka-rehearsal-new-db-1 Waiting 
 Container birka-rehearsal-new-db-1 Healthy 
 Container birka-rehearsal-new-backup-watch-run-b901f9883e83 Creating 
 Container birka-rehearsal-new-backup-watch-run-b901f9883e83 Created
```

**8.** Backups on the new server: the same key, the first night by hand, the owner's computer pointed at it

**8. The new server's first night** — held (exit 0, 2.9 s)

```sh
docker compose --profile ops run --rm ops
```

```
{"started_at": "2026-10-09T16:17:33.588838+00:00", "ok": true, "problems": [], "archive": "birka-20261009T161733Z.dump.age", "bytes": 347188, "rows": 133, "drill": {"ok": true, "restore_seconds": 0.175, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T16:17:34.062119+00:00"}
 Container birka-rehearsal-new-db-1 Running 
 Container birka-rehearsal-new-db-1 Waiting 
 Container birka-rehearsal-new-db-1 Healthy 
 Container birka-rehearsal-new-ops-run-0c3e2747dbe1 Creating 
 Container birka-rehearsal-new-ops-run-0c3e2747dbe1 Created
```

**8. The backups' state now** — held (exit 0, 2.4 s)

```sh
docker compose run --rm backup-watch python -m scripts.backup_watch --status
```

```
{"state": "OK", "checked_at": "2026-10-09T16:17:36.454441+00:00", "latest": {"finished_at": "2026-10-09T16:17:34.062119+00:00", "ok": true, "archive": "birka-20261009T161733Z.dump.age", "problems": []}}
 Container birka-rehearsal-new-db-1 Running 
 Container birka-rehearsal-new-db-1 Waiting 
 Container birka-rehearsal-new-db-1 Healthy 
 Container birka-rehearsal-new-backup-watch-run-6895109f6b15 Creating 
 Container birka-rehearsal-new-backup-watch-run-6895109f6b15 Created
```

**8.** `sh infra/pull-backups.sh` from the new server — exit 0; the owner's computer now holds 2 nights: birka-20261009T161712Z, birka-20261009T161733Z.

```
2 encrypted backups here are whole; 0 damaged or missing
0 nights older than 3 months deleted here
```

**6. The plaintext dump deleted** — held (exit 0, 0.0 s)

```sh
rm -f "$(sed -n 's/^BIRKA_BACKUP_DIR=//p' "$COMPOSE_ENV_FILES")/birka.dump"
```

```

```

The plaintext `birka.dump` on the owner's side deleted too.

**birka-rehearsal-new removed** — ran (exit 0, 1.1 s)

```sh
docker compose down -v
```

```
 Container birka-rehearsal-new-web-1 Stopping 
 Container birka-rehearsal-new-api-1 Stopping 
 Container birka-rehearsal-new-web-1 Stopped 
 Container birka-rehearsal-new-web-1 Removing 
 Container birka-rehearsal-new-web-1 Removed 
 Container birka-rehearsal-new-backup-watch-1 Stopped 
 Container birka-rehearsal-new-backup-watch-1 Removing 
 Container birka-rehearsal-new-backup-watch-1 Removed 
 Container birka-rehearsal-new-api-1 Stopped 
 Container birka-rehearsal-new-api-1 Removing 
 Container birka-rehearsal-new-api-1 Removed 
 Container birka-rehearsal-new-db-1 Stopping 
 Container birka-rehearsal-new-db-1 Stopped 
 Container birka-rehearsal-new-db-1 Removing 
 Container birka-rehearsal-new-db-1 Removed 
 Volume birka-rehearsal-new_caddy_config Removing 
 Volume birka-rehearsal-new_db_data Removing 
 Volume birka-rehearsal-new_caddy_data Removing 
 Volume birka-rehearsal-new_web_dist Removing 
 Network birka-rehearsal-new_default Removing 
 Volume birka-rehearsal-new_caddy_data Removed 
 Volume birka-rehearsal-new_db_data Removed 
 Volume birka-rehearsal-new_caddy_config Removed 
 Volume birka-rehearsal-new_web_dist Removed 
 Network birka-rehearsal-new_default Removed
```

## Findings

- step 4 as written does not restore: in a shell that has not read `.env` (a fresh SSH session) `$POSTGRES_USER`, `$POSTGRES_PASSWORD` and `$POSTGRES_DB` are empty, so `pg_restore` has no password; on a terminal it asks for one, unattended it waits for ever (the first run here was stopped after 900 s). Fixed: restore through the database container, which holds those values and needs no password for a local connection
