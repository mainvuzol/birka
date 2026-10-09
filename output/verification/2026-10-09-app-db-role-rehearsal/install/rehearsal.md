# Rehearsal: the first install, with the app's own database role

Commit 2701706, images of `2701706`; started 2026-10-09 22:09:58 EEST. Test secrets, the tests' fake bot token; the containers have no way out of their network.

## Steps 3, 4 and 6: the database, the start, the owner and the shop's places

**3. Database, migration, check, the app's role** — held (exit 0, 8.2 s)

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
 Container birka-rehearsal-role-install-ops-run-8fee5066a8ef Creating 
 Container birka-rehearsal-role-install-ops-run-8fee5066a8ef Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.schemas
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.tables
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.types
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.constraints
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.defaults
INFO  [alembic.runtime.plugins] setting up autogenerate plugin alembic.autogenerate.comments
 Container birka-rehearsal-role-install-ops-run-37c701b32db1 Creating 
 Container birka-rehearsal-role-install-ops-run-37c701b32db1 Created
```

**4. Start** — held (exit 0, 1.4 s)

```sh
docker compose up -d
```

```
 Volume birka-rehearsal-role-install_caddy_data Creating 
 Volume birka-rehearsal-role-install_caddy_data Creating 
 Volume birka-rehearsal-role-install_caddy_config Created 
 Volume birka-rehearsal-role-install_caddy_config Created 
 Volume birka-rehearsal-role-install_web_dist Created 
 Volume birka-rehearsal-role-install_web_dist Created 
 Container birka-rehearsal-role-install-web-1 Creating 
 Volume birka-rehearsal-role-install_caddy_data Created 
 Volume birka-rehearsal-role-install_caddy_data Created 
 Network birka-rehearsal-role-install_edge Created 
 Network birka-rehearsal-role-install_edge Created 
 Container birka-rehearsal-role-install-web-1 Created 
 Container birka-rehearsal-role-install-api-1 Created 
 Container birka-rehearsal-role-install-caddy-1 Creating 
 Container birka-rehearsal-role-install-backup-watch-1 Created 
 Container birka-rehearsal-role-install-caddy-1 Created 
 Container birka-rehearsal-role-install-web-1 Starting 
 Container birka-rehearsal-role-install-db-1 Waiting 
 Container birka-rehearsal-role-install-db-1 Waiting 
 Container birka-rehearsal-role-install-web-1 Started 
 Container birka-rehearsal-role-install-db-1 Healthy 
 Container birka-rehearsal-role-install-db-1 Healthy 
 Container birka-rehearsal-role-install-backup-watch-1 Starting 
 Container birka-rehearsal-role-install-api-1 Starting 
 Container birka-rehearsal-role-install-backup-watch-1 Started 
 Container birka-rehearsal-role-install-api-1 Started 
 Container birka-rehearsal-role-install-web-1 Waiting 
 Container birka-rehearsal-role-install-web-1 Exited 
 Container birka-rehearsal-role-install-caddy-1 Starting 
 Container birka-rehearsal-role-install-caddy-1 Started
```

**4. Health and readiness (-k: the local certificate)** — held (exit 0, 2.2 s)

```sh
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:59043/api/v1/health
curl -kfsS https://localhost:59043/api/v1/ready
```

```
{"status":"ok","environment":"production"}{"status":"ready"}curl: (35) LibreSSL/3.3.6: error:1404B438:SSL routines:ST_CONNECT:tlsv1 alert internal error
```

**Who api is to the database** — held (exit 0, 0.4 s)

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

**Who backup-watch is to the database** — held (exit 0, 0.4 s)

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
seed complete for organization 613ad284-d8c4-498f-971b-9d52a4a01b4a
 Container birka-rehearsal-role-install-api-run-466beb94f82e Creating 
 Container birka-rehearsal-role-install-api-run-466beb94f82e Created
```

- held: the owner signs in and sees both stores by their names: ['Магазин на Ринку', 'Магазин у ТЦ']

**6. A name changed on the owner's word** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api python -m scripts.stores rename \
  --approved-by 700000201 --store MAIN --name "Магазин на Ринку, ряд 5"
```

```
renamed: MAIN is «Магазин на Ринку, ряд 5»
 Container birka-rehearsal-role-install-api-run-d1a59f8665e7 Creating 
 Container birka-rehearsal-role-install-api-run-d1a59f8665e7 Created
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
 Container birka-rehearsal-role-install-api-run-79e6033e1d3f Creating 
 Container birka-rehearsal-role-install-api-run-79e6033e1d3f Created 
2026-10-09 19:10:14 [info     ] people.granted                 [app.modules.identity.people] membership_id=7b0d04cd-4e5d-44c4-8c77-9b57f68fa73c role=SELLER
 Container birka-rehearsal-role-install-api-run-5e0ef41841f7 Creating 
 Container birka-rehearsal-role-install-api-run-5e0ef41841f7 Created
```

- held: the seller signs in and works in MAIN alone: ['MAIN']

**7. A lost phone: every sign-in ended** — held (exit 0, 0.8 s)

```sh
docker compose run --rm --no-deps api python -m scripts.people sign-out \
  --approved-by 700000201 --telegram-user-id 700000202
```

```
signed out: 700000202, every sign-in ended, 1 role(s) kept; for a lost phone, also end its Telegram session (Telegram > Settings > Devices)
 Container birka-rehearsal-role-install-api-run-64b4b75a0263 Creating 
 Container birka-rehearsal-role-install-api-run-64b4b75a0263 Created 
2026-10-09 19:10:16 [info     ] people.signed_out              [app.modules.identity.people] session_epoch=1 user_id=d17d1715-2d7c-4da2-b161-4873dea038ee
```

- held: the lost phone's sign-in is refused (401); the seller opens the app again (200)

## Step 8: backups; 8a: being told

**8. The first night by hand, and its state** — held (exit 0, 5.2 s)

```sh
docker compose --profile ops run --rm ops
docker compose run --rm backup-watch python -m scripts.backup_watch --status
```

```
{"started_at": "2026-10-09T19:10:18.259081+00:00", "ok": true, "problems": [], "archive": "birka-20261009T191018Z.dump.age", "bytes": 339082, "rows": 93, "drill": {"ok": true, "restore_seconds": 0.185, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T19:10:18.762514+00:00"}
{"state": "OK", "checked_at": "2026-10-09T19:10:21.104950+00:00", "latest": {"finished_at": "2026-10-09T19:10:18.762514+00:00", "ok": true, "archive": "birka-20261009T191018Z.dump.age", "problems": []}}
 Container birka-rehearsal-role-install-db-1 Running 
 Container birka-rehearsal-role-install-db-1 Waiting 
 Container birka-rehearsal-role-install-db-1 Healthy 
 Container birka-rehearsal-role-install-ops-run-bb9f2477ffee Creating 
 Container birka-rehearsal-role-install-ops-run-bb9f2477ffee Created 
 Container birka-rehearsal-role-install-db-1 Running 
 Container birka-rehearsal-role-install-db-1 Waiting 
 Container birka-rehearsal-role-install-db-1 Healthy 
 Container birka-rehearsal-role-install-backup-watch-run-25bb4183b420 Creating 
 Container birka-rehearsal-role-install-backup-watch-run-25bb4183b420 Created
```

**8a.1. An administrator in .env, a part of it not a number** — held (exit 0, 6.2 s)

```sh
docker compose up -d backup-watch
sleep 5
docker compose logs backup-watch | grep backup_watch.started | tail -1
```

```
backup-watch-1  | {"logger": "__main__", "every_seconds": 600, "certificate": null, "administrators": 1, "check_in": false, "event": "backup_watch.started", "level": "info", "timestamp": "2026-10-09T19:10:23.769227Z"}
 Container birka-rehearsal-role-install-db-1 Running 
 Container birka-rehearsal-role-install-backup-watch-1 Recreate 
 Container birka-rehearsal-role-install-backup-watch-1 Recreated 
 Container birka-rehearsal-role-install-db-1 Waiting 
 Container birka-rehearsal-role-install-db-1 Healthy 
 Container birka-rehearsal-role-install-backup-watch-1 Starting 
 Container birka-rehearsal-role-install-backup-watch-1 Started
```

**The watcher's start** — ran (exit 0, 0.1 s)

```sh
docker compose logs backup-watch | grep backup_watch.started | tail -1
```

```
backup-watch-1  | {"logger": "__main__", "every_seconds": 600, "certificate": null, "administrators": 1, "check_in": false, "event": "backup_watch.started", "level": "info", "timestamp": "2026-10-09T19:10:23.769227Z"}
```

- held: the watcher has one administrator; the part not a number is dropped

8a.3. Try it: the app stopped for 6 minutes, then started again.

**8a.3. docker compose stop api** — held (exit 0, 0.7 s)

```sh
docker compose stop api
```

```
Container birka-rehearsal-role-install-api-1 Stopping 
 Container birka-rehearsal-role-install-api-1 Stopped
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
Container birka-rehearsal-role-install-db-1 Waiting 
 Container birka-rehearsal-role-install-db-1 Healthy 
 Container birka-rehearsal-role-install-api-1 Starting 
 Container birka-rehearsal-role-install-api-1 Started
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
OK: /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-install/zoshyt-1.json: 3 рядки, 1 фото
```

- held: the reference validator passes the parser's file

9.3. The catalogue: «Лоран шоколад» (M) and «Лоран бежевий» (S, M, L), created by the owner.

9.4. «Новий список» for the shared warehouse with the file: IN_REVIEW, .

- held: while the list waits, a delivery into its warehouse is refused (409: {"code":"OPENING_LIST_PENDING","message":"An opening list waits for this warehouse; approve or reject it first","details":{"location_ids":["1f84e63b-5d08-4fca-a43d-117a1e5b3ce7"],"recorded":false}})

9.5. Line 1 answered: 200.

9.5. Line 2 answered: 200.

9.5. Line 3 answered: 200.

- held: 9.6. the owner approves the list (200)

- held: «Залишки» hold what the list said, 7 coats: {'Лоран бежевий бежевий M': 2, 'Лоран бежевий бежевий L': 1, 'Лоран бежевий бежевий S': 1, 'Лоран шоколад шоколад M': 3}

- held: 9.7. a paper sale typed at the till by the seller after the approval (201)

- held: 9.8. then a delivery is received (201)

A second list started for the same warehouse, now with history: 201, IN_REVIEW.

- held: it holds nothing back: a delivery is still received (201)

- held: its approval is refused: the warehouse takes one opening list (409: {"code":"OPENING_BALANCE_CONFLICT","message":"This warehouse already has stock history; an opening balance cannot be added to it","details":{"location_id":"1f84e63b-5d08-4fca-a43d-117a1e5b3ce7"}})

The second list rejected: 200.

## Step 10: check it

- held: «Залишки»: the list's 7, less the paper sale, plus deliveries of 2 and 1: {'Лоран бежевий бежевий M': 1, 'Лоран бежевий бежевий L': 1, 'Лоран бежевий бежевий S': 1, 'Лоран шоколад шоколад M': 6}

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
172.18.0.5 172.19.0.2
```

- held: the API logs the client's address, not Caddy's (172.18.0.5 172.19.0.2); on Docker Desktop the client is the VM's gateway

**Removed** — ran (exit 0, 1.1 s)

```sh
docker compose down -v
```

```
 Container birka-rehearsal-role-install-caddy-1 Stopped 
 Container birka-rehearsal-role-install-caddy-1 Removing 
 Container birka-rehearsal-role-install-caddy-1 Removed 
 Container birka-rehearsal-role-install-web-1 Stopping 
 Container birka-rehearsal-role-install-api-1 Stopping 
 Container birka-rehearsal-role-install-web-1 Stopped 
 Container birka-rehearsal-role-install-web-1 Removing 
 Container birka-rehearsal-role-install-web-1 Removed 
 Container birka-rehearsal-role-install-backup-watch-1 Stopped 
 Container birka-rehearsal-role-install-backup-watch-1 Removing 
 Container birka-rehearsal-role-install-backup-watch-1 Removed 
 Container birka-rehearsal-role-install-api-1 Stopped 
 Container birka-rehearsal-role-install-api-1 Removing 
 Container birka-rehearsal-role-install-api-1 Removed 
 Container birka-rehearsal-role-install-db-1 Stopping 
 Container birka-rehearsal-role-install-db-1 Stopped 
 Container birka-rehearsal-role-install-db-1 Removing 
 Container birka-rehearsal-role-install-db-1 Removed 
 Network birka-rehearsal-role-install_default Removing 
 Network birka-rehearsal-role-install_edge Removing 
 Volume birka-rehearsal-role-install_db_data Removing 
 Volume birka-rehearsal-role-install_caddy_data Removing 
 Volume birka-rehearsal-role-install_caddy_config Removing 
 Volume birka-rehearsal-role-install_web_dist Removing 
 Volume birka-rehearsal-role-install_caddy_data Removed 
 Volume birka-rehearsal-role-install_web_dist Removed 
 Volume birka-rehearsal-role-install_caddy_config Removed 
 Volume birka-rehearsal-role-install_db_data Removed 
 Network birka-rehearsal-role-install_default Removed 
 Network birka-rehearsal-role-install_edge Removed
```

## Findings

None.
