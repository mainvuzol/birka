# Rehearsal: the first install, every container held

Commit 98afbd8, images of `98afbd8`; started 2026-10-09 23:38:29 EEST. Test secrets, the tests' fake bot token; the containers have no way out of their network.

## Steps 3, 4 and 6: the database, the start, the owner and the shop's places

**3. Database, migration, check, the app's role** — held (exit 0, 8.4 s)

```sh
docker compose up -d --wait db
docker compose --profile ops run --rm --no-deps ops alembic upgrade head
docker compose --profile ops run --rm --no-deps ops alembic check
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role
```

```
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
 Container birka-rehearsal-limits-install-ops-run-83a4e5bd38c6 Creating 
 Container birka-rehearsal-limits-install-ops-run-83a4e5bd38c6 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.schemas
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.tables
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.types
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.constraints
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.defaults
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.comments
 Container birka-rehearsal-limits-install-ops-run-24c624c28135 Creating 
 Container birka-rehearsal-limits-install-ops-run-24c624c28135 Created
```

**4. Start** — held (exit 0, 1.3 s)

```sh
docker compose up -d
```

```
 Volume birka-rehearsal-limits-install_caddy_data Creating 
 Container birka-rehearsal-limits-install-backup-watch-1 Creating 
 Volume birka-rehearsal-limits-install_web_dist Created 
 Volume birka-rehearsal-limits-install_web_dist Created 
 Container birka-rehearsal-limits-install-web-1 Creating 
 Volume birka-rehearsal-limits-install_caddy_data Created 
 Volume birka-rehearsal-limits-install_caddy_data Created 
 Volume birka-rehearsal-limits-install_caddy_config Created 
 Volume birka-rehearsal-limits-install_caddy_config Created 
 Network birka-rehearsal-limits-install_edge Created 
 Network birka-rehearsal-limits-install_edge Created 
 Container birka-rehearsal-limits-install-web-1 Created 
 Container birka-rehearsal-limits-install-api-1 Created 
 Container birka-rehearsal-limits-install-caddy-1 Creating 
 Container birka-rehearsal-limits-install-backup-watch-1 Created 
 Container birka-rehearsal-limits-install-caddy-1 Created 
 Container birka-rehearsal-limits-install-web-1 Starting 
 Container birka-rehearsal-limits-install-db-1 Waiting 
 Container birka-rehearsal-limits-install-db-1 Waiting 
 Container birka-rehearsal-limits-install-web-1 Started 
 Container birka-rehearsal-limits-install-db-1 Healthy 
 Container birka-rehearsal-limits-install-api-1 Starting 
 Container birka-rehearsal-limits-install-db-1 Healthy 
 Container birka-rehearsal-limits-install-backup-watch-1 Starting 
 Container birka-rehearsal-limits-install-api-1 Started 
 Container birka-rehearsal-limits-install-web-1 Waiting 
 Container birka-rehearsal-limits-install-backup-watch-1 Started 
 Container birka-rehearsal-limits-install-web-1 Exited 
 Container birka-rehearsal-limits-install-caddy-1 Starting 
 Container birka-rehearsal-limits-install-caddy-1 Started
```

**4. Health and readiness (-k: the local certificate)** — held (exit 0, 2.2 s)

```sh
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:59045/api/v1/health
curl -kfsS https://localhost:59045/api/v1/ready
```

```
{"status":"ok","environment":"production"}{"status":"ready"}curl: (35) LibreSSL/3.3.6: error:1404B438:SSL routines:ST_CONNECT:tlsv1 alert internal error
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
docker compose exec -T api python -c 'import asyncio
from sqlalchemy import text
from app.core.config import get_settings
from app.core.db import create_engine
async def main():
    engine = create_engine(get_settings())
    async with engine.connect() as connection:
        row = (await connection.execute(text("SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user"))).one()
    await engine.dispose()
    print(*row)
asyncio.run(main())'
```

```
birka_app False
```

- held: api connects as birka_app, no superuser: `birka_app False`

**Who backup-watch is to the database** — held (exit 0, 0.5 s)

```sh
docker compose exec -T backup-watch python -c 'import asyncio
from sqlalchemy import text
from app.core.config import get_settings
from app.core.db import create_engine
async def main():
    engine = create_engine(get_settings())
    async with engine.connect() as connection:
        row = (await connection.execute(text("SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user"))).one()
    await engine.dispose()
    print(*row)
asyncio.run(main())'
```

```
birka_app False
```

- held: backup-watch connects as birka_app, no superuser: `birka_app False`

**Each container as Docker runs it** — held (exit 0, 0.4 s)

```sh
for s in db api backup-watch caddy web; do for id in $(docker compose ps -a -q $s); do printf '%s ' $s; docker inspect -f '{{.HostConfig.Privileged}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' $id; done; done
```

```
db false true [ALL] [CAP_CHOWN CAP_DAC_READ_SEARCH CAP_FOWNER CAP_SETGID CAP_SETUID] 1073741824 1073741824
api false true [ALL] [] 805306368 805306368
backup-watch false true [ALL] [] 536870912 536870912
caddy false true [ALL] [CAP_NET_BIND_SERVICE] 268435456 268435456
web false true [ALL] [] 134217728 134217728
```

- held: every container: not privileged, read-only, every privilege dropped but its own, a memory limit and no swap beyond it

**A write into the API's image** — ran (exit 1, 0.1 s)

```sh
docker compose exec -T api sh -c 'touch /app/probe'
```

```
touch: cannot touch '/app/probe': Read-only file system
```

- held: refused: Read-only file system

**The old command, from api: a migration's downgrade** — ran (exit 1, 0.8 s)

```sh
docker compose run --rm --no-deps api alembic downgrade -1
```

```
    ret = self._execute_context(
          ^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/engine/base.py", line 1848, in _execute_context
    return self._exec_single_context(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/engine/base.py", line 1988, in _exec_single_context
    self._handle_dbapi_exception(
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/engine/base.py", line 2365, in _handle_dbapi_exception
    raise sqlalchemy_exception.with_traceback(exc_info[2]) from e
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/engine/base.py", line 1969, in _exec_single_context
    self.dialect.do_execute(
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/engine/default.py", line 952, in do_execute
    cursor.execute(statement, parameters)
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 585, in execute
    self._adapt_connection.await_(
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 132, in await_only
    return current.parent.switch(awaitable)  # type: ignore[no-any-return,attr-defined] # noqa: E501
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 196, in greenlet_spawn
    value = await result
            ^^^^^^^^^^^^
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 563, in _prepare_and_execute
    self._handle_exception(error)
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 513, in _handle_exception
    self._adapt_connection._handle_exception(error)
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 797, in _handle_exception
    raise translated_error from error
sqlalchemy.exc.ProgrammingError: (sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError) <class 'asyncpg.exceptions.InsufficientPrivilegeError'>: must be owner of relation credit_entry
[SQL: DROP TRIGGER credit_entry_guard ON credit_entry]
(Background on this error at: https://sqlalche.me/e/20/f405)
```

**The schema after it** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"'
```

```
0038_customer_erasure
```

- held: from api, as birka_app, the schema cannot be changed: refused, and it stays `0038_customer_erasure`

**6. The owner, and the shop's places** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api python -m scripts.seed_organization \
  --telegram-user-id 700000201 --owner-name "Власниця" --org-name "Перший день" \
  --main-name "Магазин на Ринку" --second-name "Магазин у ТЦ"
```

```
seed complete for organization dbc09acc-01ec-4e78-8f45-73abee65ba71
 Container birka-rehearsal-limits-install-api-run-584bf2e9759b Creating 
 Container birka-rehearsal-limits-install-api-run-584bf2e9759b Created
```

- held: the owner signs in and sees both stores by their names: ['Магазин на Ринку', 'Магазин у ТЦ']

**6. A name changed on the owner's word** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api python -m scripts.stores rename \
  --approved-by 700000201 --store MAIN --name "Магазин на Ринку, ряд 5"
```

```
renamed: MAIN is «Магазин на Ринку, ряд 5»
 Container birka-rehearsal-limits-install-api-run-493ebc3744c6 Creating 
 Container birka-rehearsal-limits-install-api-run-493ebc3744c6 Created
```

- held: the owner's app shows the new name: «Магазин на Ринку, ряд 5»

## Step 7: the people

The seller opens the app before being added: sign-in 401, stores [] («Доступу ще немає»).

**7. A seller added on the owner's word** — held (exit 0, 1.6 s)

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
 Container birka-rehearsal-limits-install-api-run-61c7bacf28e6 Creating 
 Container birka-rehearsal-limits-install-api-run-61c7bacf28e6 Created 
2026-10-09 20:38:45 [info     ] people.granted                 [app.modules.identity.people] membership_id=a655a67b-13fb-4a01-8169-8846727695c1 role=SELLER
 Container birka-rehearsal-limits-install-api-run-10cb15f3e733 Creating 
 Container birka-rehearsal-limits-install-api-run-10cb15f3e733 Created
```

- held: the seller signs in and works in MAIN alone: ['MAIN']

**7. A lost phone: every sign-in ended** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api python -m scripts.people sign-out \
  --approved-by 700000201 --telegram-user-id 700000202
```

```
signed out: 700000202, every sign-in ended, 1 role(s) kept; for a lost phone, also end its Telegram session (Telegram > Settings > Devices)
 Container birka-rehearsal-limits-install-api-run-8028fa7b3fa4 Creating 
 Container birka-rehearsal-limits-install-api-run-8028fa7b3fa4 Created 
2026-10-09 20:38:47 [info     ] people.signed_out              [app.modules.identity.people] session_epoch=1 user_id=f5a686bf-c0a9-42f9-bd46-90ae12612fe6
```

- held: the lost phone's sign-in is refused (401); the seller opens the app again (200)

## Step 8: backups; 8a: being told

**8. The first night by hand, and its state** — held (exit 0, 5.2 s)

```sh
docker compose --profile ops run --rm ops
docker compose run --rm backup-watch python -m scripts.backup_watch --status
```

```
{"started_at": "2026-10-09T20:38:49.628424+00:00", "ok": true, "problems": [], "archive": "birka-20261009T203849Z.dump.age", "bytes": 339082, "rows": 93, "drill": {"ok": true, "restore_seconds": 0.194, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T20:38:50.135719+00:00"}
{"state": "OK", "checked_at": "2026-10-09T20:38:52.513973+00:00", "latest": {"finished_at": "2026-10-09T20:38:50.135719+00:00", "ok": true, "archive": "birka-20261009T203849Z.dump.age", "problems": []}}
 Container birka-rehearsal-limits-install-db-1 Running 
 Container birka-rehearsal-limits-install-db-1 Waiting 
 Container birka-rehearsal-limits-install-db-1 Healthy 
 Container birka-rehearsal-limits-install-ops-run-a0c9e5eff31c Creating 
 Container birka-rehearsal-limits-install-ops-run-a0c9e5eff31c Created 
 Container birka-rehearsal-limits-install-db-1 Running 
 Container birka-rehearsal-limits-install-db-1 Waiting 
 Container birka-rehearsal-limits-install-db-1 Healthy 
 Container birka-rehearsal-limits-install-backup-watch-run-464ad5482e22 Creating 
 Container birka-rehearsal-limits-install-backup-watch-run-464ad5482e22 Created
```

**8a.1. An administrator in .env, a part of it not a number** — held (exit 0, 6.1 s)

```sh
docker compose up -d backup-watch
sleep 5
docker compose logs backup-watch | grep backup_watch.started | tail -1
```

```
backup-watch-1  | {"logger": "__main__", "every_seconds": 600, "certificate": null, "administrators": 1, "check_in": false, "event": "backup_watch.started", "level": "info", "timestamp": "2026-10-09T20:38:55.114342Z"}
 Container birka-rehearsal-limits-install-db-1 Running 
 Container birka-rehearsal-limits-install-backup-watch-1 Recreate 
 Container birka-rehearsal-limits-install-backup-watch-1 Recreated 
 Container birka-rehearsal-limits-install-db-1 Waiting 
 Container birka-rehearsal-limits-install-db-1 Healthy 
 Container birka-rehearsal-limits-install-backup-watch-1 Starting 
 Container birka-rehearsal-limits-install-backup-watch-1 Started
```

**The watcher's start** — ran (exit 0, 0.1 s)

```sh
docker compose logs backup-watch | grep backup_watch.started | tail -1
```

```
backup-watch-1  | {"logger": "__main__", "every_seconds": 600, "certificate": null, "administrators": 1, "check_in": false, "event": "backup_watch.started", "level": "info", "timestamp": "2026-10-09T20:38:55.114342Z"}
```

- held: the watcher has one administrator; the part not a number is dropped

8a.3. Try it: the app stopped for 6 minutes, then started again.

**8a.3. docker compose stop api** — held (exit 0, 0.6 s)

```sh
docker compose stop api
```

```
Container birka-rehearsal-limits-install-api-1 Stopping 
 Container birka-rehearsal-limits-install-api-1 Stopped
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
Container birka-rehearsal-limits-install-db-1 Waiting 
 Container birka-rehearsal-limits-install-db-1 Healthy 
 Container birka-rehearsal-limits-install-api-1 Starting 
 Container birka-rehearsal-limits-install-api-1 Started
```

The owner's «Резервні копії», the server: open [], recent [('NOT_ANSWERING', 'Сервер застосунку не відповідає.')].

- held: within a minute or two of the start the incident is closed, and the owner's section shows it

**The watcher's attempts to tell (none can leave)** — ran (exit 0, 0.1 s)

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
OK: /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-install/zoshyt-1.json: 3 рядки, 1 фото
```

- held: the reference validator passes the parser's file

9.3. The catalogue: «Лоран шоколад» (M) and «Лоран бежевий» (S, M, L), created by the owner.

9.4. «Новий список» for the shared warehouse with the file: IN_REVIEW, .

- held: while the list waits, a delivery into its warehouse is refused (409: {"code":"OPENING_LIST_PENDING","message":"An opening list waits for this warehouse; approve or reject it first","details":{"location_ids":["7a2f8faa-4ae1-48f9-a2b6-cfc68b9cd474"],"recorded":false}})

9.5. Line 1 answered: 200.

9.5. Line 2 answered: 200.

9.5. Line 3 answered: 200.

- held: 9.6. the owner approves the list (200)

- held: «Залишки» hold what the list said, 7 coats: {'Лоран бежевий бежевий S': 1, 'Лоран бежевий бежевий M': 2, 'Лоран бежевий бежевий L': 1, 'Лоран шоколад шоколад M': 3}

- held: 9.7. a paper sale typed at the till by the seller after the approval (201)

- held: 9.8. then a delivery is received (201)

A second list started for the same warehouse, now with history: 201, IN_REVIEW.

- held: it holds nothing back: a delivery is still received (201)

- held: its approval is refused: the warehouse takes one opening list (409: {"code":"OPENING_BALANCE_CONFLICT","message":"This warehouse already has stock history; an opening balance cannot be added to it","details":{"location_id":"7a2f8faa-4ae1-48f9-a2b6-cfc68b9cd474"}})

The second list rejected: 200.

## Step 10: check it

- held: «Залишки»: the list's 7, less the paper sale, plus deliveries of 2 and 1: {'Лоран бежевий бежевий S': 1, 'Лоран бежевий бежевий M': 1, 'Лоран бежевий бежевий L': 1, 'Лоран шоколад шоколад M': 6}

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

**Removed** — ran (exit 0, 1.1 s)

```sh
docker compose down -v
```

```
 Container birka-rehearsal-limits-install-caddy-1 Stopped 
 Container birka-rehearsal-limits-install-caddy-1 Removing 
 Container birka-rehearsal-limits-install-caddy-1 Removed 
 Container birka-rehearsal-limits-install-api-1 Stopping 
 Container birka-rehearsal-limits-install-web-1 Stopping 
 Container birka-rehearsal-limits-install-web-1 Stopped 
 Container birka-rehearsal-limits-install-web-1 Removing 
 Container birka-rehearsal-limits-install-backup-watch-1 Stopped 
 Container birka-rehearsal-limits-install-backup-watch-1 Removing 
 Container birka-rehearsal-limits-install-web-1 Removed 
 Container birka-rehearsal-limits-install-backup-watch-1 Removed 
 Container birka-rehearsal-limits-install-api-1 Stopped 
 Container birka-rehearsal-limits-install-api-1 Removing 
 Container birka-rehearsal-limits-install-api-1 Removed 
 Container birka-rehearsal-limits-install-db-1 Stopping 
 Container birka-rehearsal-limits-install-db-1 Stopped 
 Container birka-rehearsal-limits-install-db-1 Removing 
 Container birka-rehearsal-limits-install-db-1 Removed 
 Network birka-rehearsal-limits-install_default Removing 
 Network birka-rehearsal-limits-install_edge Removing 
 Volume birka-rehearsal-limits-install_db_data Removing 
 Volume birka-rehearsal-limits-install_web_dist Removing 
 Volume birka-rehearsal-limits-install_caddy_data Removing 
 Volume birka-rehearsal-limits-install_caddy_config Removing 
 Volume birka-rehearsal-limits-install_caddy_data Removed 
 Volume birka-rehearsal-limits-install_db_data Removed 
 Volume birka-rehearsal-limits-install_web_dist Removed 
 Volume birka-rehearsal-limits-install_caddy_config Removed 
 Network birka-rehearsal-limits-install_edge Removed 
 Network birka-rehearsal-limits-install_default Removed
```

## Findings

None.
