# Rehearsal: the first install

Commit 1903cfe; started 2026-10-09 20:33:21 EEST. Test secrets, the tests' fake bot token; the containers have no way out of their network.

## Steps 3, 4 and 6: the database, the start, the owner and the shop's places

**3–4. Database, migration, check, start** — held (exit 0, 9.0 s)

```sh
docker compose up -d --wait db
docker compose run --rm --no-deps api alembic upgrade head
docker compose run --rm --no-deps api alembic check
docker compose up -d
```

```
 Volume birka-rehearsal-install_caddy_data Creating 
 Volume birka-rehearsal-install_caddy_data Creating 
 Volume birka-rehearsal-install_caddy_config Created 
 Volume birka-rehearsal-install_caddy_config Created 
 Volume birka-rehearsal-install_web_dist Created 
 Volume birka-rehearsal-install_web_dist Created 
 Container birka-rehearsal-install-web-1 Creating 
 Volume birka-rehearsal-install_caddy_data Created 
 Volume birka-rehearsal-install_caddy_data Created 
 Network birka-rehearsal-install_edge Created 
 Network birka-rehearsal-install_edge Created 
 Container birka-rehearsal-install-web-1 Created 
 Container birka-rehearsal-install-api-1 Created 
 Container birka-rehearsal-install-caddy-1 Creating 
 Container birka-rehearsal-install-backup-watch-1 Created 
 Container birka-rehearsal-install-caddy-1 Created 
 Container birka-rehearsal-install-web-1 Starting 
 Container birka-rehearsal-install-db-1 Waiting 
 Container birka-rehearsal-install-db-1 Waiting 
 Container birka-rehearsal-install-web-1 Started 
 Container birka-rehearsal-install-db-1 Healthy 
 Container birka-rehearsal-install-api-1 Starting 
 Container birka-rehearsal-install-db-1 Healthy 
 Container birka-rehearsal-install-backup-watch-1 Starting 
 Container birka-rehearsal-install-api-1 Started 
 Container birka-rehearsal-install-web-1 Waiting 
 Container birka-rehearsal-install-backup-watch-1 Started 
 Container birka-rehearsal-install-web-1 Exited 
 Container birka-rehearsal-install-caddy-1 Starting 
 Container birka-rehearsal-install-caddy-1 Started
```

**4. Health and readiness (-k: the local certificate)** — held (exit 0, 2.2 s)

```sh
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58843/api/v1/health
curl -kfsS https://localhost:58843/api/v1/ready
```

```
{"status":"ok","environment":"production"}{"status":"ready"}curl: (35) LibreSSL/3.3.6: error:1404B438:SSL routines:ST_CONNECT:tlsv1 alert internal error
```

**6. The owner, and the shop's places** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api python -m scripts.seed_organization \
  --telegram-user-id 700000201 --owner-name "Власниця" --org-name "Перший день" \
  --main-name "Магазин на Ринку" --second-name "Магазин у ТЦ"
```

```
seed complete for organization f5df3232-5108-4efc-ba5b-063a22a74add
 Container birka-rehearsal-install-api-run-2533435f7484 Creating 
 Container birka-rehearsal-install-api-run-2533435f7484 Created
```

- held: the owner signs in and sees both stores by their names: ['Магазин на Ринку', 'Магазин у ТЦ']

**6. A name changed on the owner's word** — held (exit 0, 0.7 s)

```sh
docker compose run --rm --no-deps api python -m scripts.stores rename \
  --approved-by 700000201 --store MAIN --name "Магазин на Ринку, ряд 5"
```

```
renamed: MAIN is «Магазин на Ринку, ряд 5»
 Container birka-rehearsal-install-api-run-dd6f11e2c332 Creating 
 Container birka-rehearsal-install-api-run-dd6f11e2c332 Created
```

- held: the owner's app shows the new name: «Магазин на Ринку, ряд 5»

## Step 7: the people

The seller opens the app before being added: sign-in 401, stores [] («Доступу ще немає»).

**7. A seller added on the owner's word** — held (exit 0, 1.5 s)

```sh
docker compose run --rm --no-deps api python -m scripts.people grant \
  --approved-by 700000201 --telegram-user-id 700000202 \
  --store MAIN --role SELLER
docker compose run --rm --no-deps api python -m scripts.people list
```

```
granted: 700000202 is SELLER in MAIN
700000201  Власниця  [Перший день]
    OWNER    every store
700000202  Telegram 700000202  [Перший день]
    SELLER   MAIN
 Container birka-rehearsal-install-api-run-d98f6a615697 Creating 
 Container birka-rehearsal-install-api-run-d98f6a615697 Created 
2026-10-09 17:33:35 [info     ] people.granted                 [app.modules.identity.people] membership_id=18715adf-c1e4-4b89-9adc-6102710bb54a role=SELLER
 Container birka-rehearsal-install-api-run-6bb56f3a508e Creating 
 Container birka-rehearsal-install-api-run-6bb56f3a508e Created
```

- held: the seller signs in and works in MAIN alone: ['MAIN']

**7. A lost phone: every sign-in ended** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api python -m scripts.people sign-out \
  --approved-by 700000201 --telegram-user-id 700000202
```

```
signed out: 700000202, every sign-in ended, 1 role(s) kept; for a lost phone, also end its Telegram session (Telegram > Settings > Devices)
 Container birka-rehearsal-install-api-run-f404569c7f44 Creating 
 Container birka-rehearsal-install-api-run-f404569c7f44 Created 
2026-10-09 17:33:36 [info     ] people.signed_out              [app.modules.identity.people] session_epoch=1 user_id=9783d258-a779-4c26-a42a-ca3405b31cb3
```

- held: the lost phone's sign-in is refused (401); the seller opens the app again (200)

## Step 8: backups; 8a: being told

**8. The first night by hand, and its state** — held (exit 0, 5.1 s)

```sh
docker compose --profile ops run --rm ops
docker compose run --rm backup-watch python -m scripts.backup_watch --status
```

```
{"started_at": "2026-10-09T17:33:38.818929+00:00", "ok": true, "problems": [], "archive": "birka-20261009T173338Z.dump.age", "bytes": 339080, "rows": 93, "drill": {"ok": true, "restore_seconds": 0.184, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T17:33:39.303842+00:00"}
{"state": "OK", "checked_at": "2026-10-09T17:33:41.619941+00:00", "latest": {"finished_at": "2026-10-09T17:33:39.303842+00:00", "ok": true, "archive": "birka-20261009T173338Z.dump.age", "problems": []}}
 Container birka-rehearsal-install-db-1 Running 
 Container birka-rehearsal-install-db-1 Waiting 
 Container birka-rehearsal-install-db-1 Healthy 
 Container birka-rehearsal-install-ops-run-deaf1c36fdba Creating 
 Container birka-rehearsal-install-ops-run-deaf1c36fdba Created 
 Container birka-rehearsal-install-db-1 Running 
 Container birka-rehearsal-install-db-1 Waiting 
 Container birka-rehearsal-install-db-1 Healthy 
 Container birka-rehearsal-install-backup-watch-run-415b72289340 Creating 
 Container birka-rehearsal-install-backup-watch-run-415b72289340 Created
```

**8a.1. An administrator in .env, a part of it not a number** — held (exit 0, 6.1 s)

```sh
docker compose up -d backup-watch
sleep 5
docker compose logs backup-watch | grep backup_watch.started | tail -1
```

```
backup-watch-1  | {"logger": "__main__", "every_seconds": 600, "certificate": null, "administrators": 1, "check_in": false, "event": "backup_watch.started", "level": "info", "timestamp": "2026-10-09T17:33:44.195372Z"}
 Container birka-rehearsal-install-db-1 Running 
 Container birka-rehearsal-install-backup-watch-1 Recreate 
 Container birka-rehearsal-install-backup-watch-1 Recreated 
 Container birka-rehearsal-install-db-1 Waiting 
 Container birka-rehearsal-install-db-1 Healthy 
 Container birka-rehearsal-install-backup-watch-1 Starting 
 Container birka-rehearsal-install-backup-watch-1 Started
```

**The watcher's start** — ran (exit 0, 0.1 s)

```sh
docker compose logs backup-watch | grep backup_watch.started | tail -1
```

```
backup-watch-1  | {"logger": "__main__", "every_seconds": 600, "certificate": null, "administrators": 1, "check_in": false, "event": "backup_watch.started", "level": "info", "timestamp": "2026-10-09T17:33:44.195372Z"}
```

- held: the watcher has one administrator; the part not a number is dropped

8a.3. Try it: the app stopped for 6 minutes, then started again.

**8a.3. docker compose stop api** — held (exit 0, 0.6 s)

```sh
docker compose stop api
```

```
Container birka-rehearsal-install-api-1 Stopping 
 Container birka-rehearsal-install-api-1 Stopped
```

**What the watcher recorded while the app did not answer** — held (exit 0, 0.2 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT kind, reason FROM server_incident WHERE ended_at IS NULL;
SQL
```

```
NOT_ANSWERING|Сервер застосунку не відповідає.
```

- held: an incident is open while the app does not answer: `NOT_ANSWERING|Сервер застосунку не відповідає.`

**8a.3. docker compose start api** — held (exit 0, 0.7 s)

```sh
docker compose start api
```

```
Container birka-rehearsal-install-db-1 Waiting 
 Container birka-rehearsal-install-db-1 Healthy 
 Container birka-rehearsal-install-api-1 Starting 
 Container birka-rehearsal-install-api-1 Started
```

The owner's «Резервні копії», the server: open [], recent [('NOT_ANSWERING', 'Сервер застосунку не відповідає.')].

- held: within a minute or two of the start the incident is closed, and the owner's section shows it

**The watcher's attempts to tell (none can leave)** — ran (exit 0, 0.2 s)

```sh
docker compose logs backup-watch | grep -c -i 'send\|deliver\|telegram' || true
```

```
3
```

Lines about telling in the watcher's log: 3. Nothing left the network.

## Step 9: the shops' existing stock, before anything moves

**9.2. The validator** — exit 0

```sh
python -m scripts.check_stock_file zoshyt-1.json
```

```
OK: /Users/nikitahlushak/.cache/birka-runtime/install-rehearsal/work/zoshyt-1.json: 3 рядки, 1 фото
```

- held: the reference validator passes the parser's file

9.3. The catalogue: «Лоран шоколад» (M) and «Лоран бежевий» (S, M, L), created by the owner.

9.4. «Новий список» for the shared warehouse with the file: IN_REVIEW, .

- held: while the list waits, a delivery into its warehouse is refused (409: {"code":"OPENING_LIST_PENDING","message":"An opening list waits for this warehouse; approve or reject it first","details":{"location_ids":["f00eb311-9d24-4992-bc4c-21b9bf7fb548"],"recorded":false}})

9.5. Line 1 answered: 200.

9.5. Line 2 answered: 200.

9.5. Line 3 answered: 200.

- held: 9.6. the owner approves the list (200)

- held: «Залишки» hold what the list said, 7 coats: {'Лоран шоколад шоколад M': 3, 'Лоран бежевий бежевий S': 1, 'Лоран бежевий бежевий L': 1, 'Лоран бежевий бежевий M': 2}

- held: 9.7. a paper sale typed at the till by the seller after the approval (201)

- held: 9.8. then a delivery is received (201)

A second list started for the same warehouse, now with history: 201, IN_REVIEW.

- held: it holds nothing back: a delivery is still received (201)

- held: its approval is refused: the warehouse takes one opening list (409: {"code":"OPENING_BALANCE_CONFLICT","message":"This warehouse already has stock history; an opening balance cannot be added to it","details":{"location_id":"f00eb311-9d24-4992-bc4c-21b9bf7fb548"}})

The second list rejected: 200.

## Step 10: check it

- held: «Залишки»: the list's 7, less the paper sale, plus deliveries of 2 and 1: {'Лоран шоколад шоколад M': 6, 'Лоран бежевий бежевий S': 1, 'Лоран бежевий бежевий L': 1, 'Лоран бежевий бежевий M': 1}

**10. The sign-in's address in the API's log** — ran (exit 0, 0.1 s)

```sh
docker compose logs api | grep -i 'auth/telegram' | tail -2
```

```
api-1  | 172.19.0.1:0 - "POST /api/v1/auth/telegram HTTP/1.1" 200
api-1  | 172.19.0.1:0 - "POST /api/v1/auth/telegram HTTP/1.1" 200
```

**Caddy's own address** — ran (exit 0, 0.1 s)

```sh
docker compose exec -T caddy hostname -i
```

```
172.19.0.2 172.18.0.5
```

- held: the API logs the client's address, not Caddy's (172.19.0.2 172.18.0.5); on Docker Desktop the client is the VM's gateway

**Removed** — ran (exit 0, 1.0 s)

```sh
docker compose down -v
```

```
 Container birka-rehearsal-install-caddy-1 Stopped 
 Container birka-rehearsal-install-caddy-1 Removing 
 Container birka-rehearsal-install-caddy-1 Removed 
 Container birka-rehearsal-install-web-1 Stopping 
 Container birka-rehearsal-install-api-1 Stopping 
 Container birka-rehearsal-install-web-1 Stopped 
 Container birka-rehearsal-install-web-1 Removing 
 Container birka-rehearsal-install-web-1 Removed 
 Container birka-rehearsal-install-backup-watch-1 Stopped 
 Container birka-rehearsal-install-backup-watch-1 Removing 
 Container birka-rehearsal-install-backup-watch-1 Removed 
 Container birka-rehearsal-install-api-1 Stopped 
 Container birka-rehearsal-install-api-1 Removing 
 Container birka-rehearsal-install-api-1 Removed 
 Container birka-rehearsal-install-db-1 Stopping 
 Container birka-rehearsal-install-db-1 Stopped 
 Container birka-rehearsal-install-db-1 Removing 
 Container birka-rehearsal-install-db-1 Removed 
 Network birka-rehearsal-install_edge Removing 
 Volume birka-rehearsal-install_caddy_config Removing 
 Volume birka-rehearsal-install_db_data Removing 
 Volume birka-rehearsal-install_web_dist Removing 
 Network birka-rehearsal-install_default Removing 
 Volume birka-rehearsal-install_caddy_data Removing 
 Volume birka-rehearsal-install_web_dist Removed 
 Volume birka-rehearsal-install_db_data Removed 
 Volume birka-rehearsal-install_caddy_config Removed 
 Volume birka-rehearsal-install_caddy_data Removed 
 Network birka-rehearsal-install_default Removed 
 Network birka-rehearsal-install_edge Removed
```

## Findings

None.
