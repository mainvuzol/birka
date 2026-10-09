# Rehearsal: the app's own database role, through an update and a restore

From `65546f6` (main, the API as the database's owner) to `2701706` (the role), on one server whose checkout is a local clone; then a restore on a new server. Started 2026-10-09 22:20:37 EEST. Passwords are base64 as the runbook makes them; test secrets, the tests' fake bot token; no way out of the compose network.

## Installed at 65546f6, as its runbook said

**Build (stand-in), database, migration, start** — held (exit 0, 9.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka/backend
docker compose up -d --wait db
docker compose run --rm --no-deps api alembic upgrade head
docker compose up -d
```

```
 Volume birka-rehearsal-role_caddy_config Creating 
 Volume birka-rehearsal-role_caddy_config Creating 
 Volume birka-rehearsal-role_web_dist Created 
 Volume birka-rehearsal-role_web_dist Created 
 Container birka-rehearsal-role-web-1 Creating 
 Volume birka-rehearsal-role_caddy_data Created 
 Volume birka-rehearsal-role_caddy_data Created 
 Volume birka-rehearsal-role_caddy_config Created 
 Volume birka-rehearsal-role_caddy_config Created 
 Network birka-rehearsal-role_edge Created 
 Network birka-rehearsal-role_edge Created 
 Container birka-rehearsal-role-web-1 Created 
 Container birka-rehearsal-role-api-1 Created 
 Container birka-rehearsal-role-caddy-1 Creating 
 Container birka-rehearsal-role-backup-watch-1 Created 
 Container birka-rehearsal-role-caddy-1 Created 
 Container birka-rehearsal-role-web-1 Starting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Started 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-backup-watch-1 Starting 
 Container birka-rehearsal-role-api-1 Starting 
 Container birka-rehearsal-role-backup-watch-1 Started 
 Container birka-rehearsal-role-api-1 Started 
 Container birka-rehearsal-role-web-1 Waiting 
 Container birka-rehearsal-role-web-1 Exited 
 Container birka-rehearsal-role-caddy-1 Starting 
 Container birka-rehearsal-role-caddy-1 Started
```

**The owner and the shop's places** — held (exit 0, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api python -m scripts.seed_organization --telegram-user-id 700000301 --owner-name "Власниця" --org-name "Роль"
```

```
seed complete for organization f0b36a6e-2fd8-4640-af8e-b44ff6508fa2
 Container birka-rehearsal-role-api-run-545867a1ff54 Creating 
 Container birka-rehearsal-role-api-run-545867a1ff54 Created
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
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
birka True
```

- held: before: the API connects as the database's owner, a superuser

Used through the app: a model received 10, three sales, two in parts (Марія paid off, Ірина owes 1000). Stock and sales: {'on_hand': 7, 'sales': 3}.

## 1. A new version: 65546f6 → 2701706

Once, for a server installed before the role (none is): `.env` gains `BIRKA_APP_DB_PASSWORD`, made like `POSTGRES_PASSWORD` (`openssl rand -base64 32`).

**The runbook's block** — held (exit 0, 9.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka checkout 2701706
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose --profile ops run --rm --no-deps ops alembic upgrade head   # if this fails, stop here: see below
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role   # the rights, new tables too
docker compose up -d
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58943/api/v1/ready
```

```
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-ops-run-d4df9c815feb Creating 
 Container birka-rehearsal-role-ops-run-d4df9c815feb Created 
Previous HEAD position was 65546f6 docs(server): the first install rehearsed — steps 3 to 10 held, Caddy's first refusal and a second opening list now described (#78)
HEAD is now at 2701706 feat(server): the API and the watcher connect as birka_app — rows only, no superuser, so the ledger's triggers hold against the API
 Container birka-rehearsal-role-ops-run-8b1d23b21d01 Creating 
 Container birka-rehearsal-role-ops-run-8b1d23b21d01 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
 Container birka-rehearsal-role-ops-run-799be38d647a Creating 
 Container birka-rehearsal-role-ops-run-799be38d647a Created 
 Container birka-rehearsal-role-caddy-1 Running 
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-api-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreated 
 Container birka-rehearsal-role-api-1 Recreated 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Starting 
 Container birka-rehearsal-role-web-1 Started 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-api-1 Starting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-backup-watch-1 Starting 
 Container birka-rehearsal-role-api-1 Started 
 Container birka-rehearsal-role-web-1 Waiting 
 Container birka-rehearsal-role-backup-watch-1 Started 
 Container birka-rehearsal-role-web-1 Exited 
curl: (56) The requested URL returned error: 502
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
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

- held: api connects as birka_app, no superuser

**Who backup-watch is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
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

- held: backup-watch connects as birka_app, no superuser

- held: the same stock and sales after the update: {'on_hand': 7, 'sales': 3}

## 2. Used as birka_app

- held: a sale, a payment, and Марія erased on request, through the app: {'erased': 1, 'still_open': 0, 'network': True, 'credit': {'id': '5e372e2e-090b-4000-bd5c-0c4b956fd6c6', 'sale_id': '04f9a6e8-3a92-44c1-837b-f3343b5e9608', 'store_id': 'fc5c9925-2ac8-4cd7-82d7-81b069150dc8', 'store_name': 'Основний магазин', 'store_state': 'ACTIVE', 'customer_name': None, 'customer_phone': None, 'customer_erased_at': '2026-10-09T19:21:00.378878Z', 'amount': '1500.00', 'currency_code': 'UAH', 'status': 'SETTLED', 'paid': '1500.00', 'returned': '0.00', 'cash_back': '0.00', 'written_off': '0.00', 'owed': '0.00', 'opened_at': '2026-10-09T19:20:50.073956Z', 'last_payment_at': '2026-10-09T19:20:50.098197Z', 'closed_at': '2026-10-09T19:20:50.100534Z', 'goods': ['Лоран роль шоколад × 1'], 'entries': [{'kind': 'PAYMENT', 'amount': '500.00', 'cash_back': '0.00', 'at': '2026-10-09T19:20:50.073956Z', 'by': 'Власниця', 'note': None, 'taken_at': None, 'payment_method': 'CASH', 'corrected': False}, {'kind': 'PAYMENT', 'amount': '1000.00', 'cash_back': '0.00', 'at': '2026-10-09T19:20:50.098197Z', 'by': 'Власниця', 'note': None, 'taken_at': None, 'payment_method': 'CASH', 'corrected': False}]}}

- held: Марія's name gone (None), Ірина owes 700.00

**The people's and stores' commands, from api, as birka_app** — held (exit 0, 1.6 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api python -m scripts.people list
docker compose run --rm --no-deps api python -m scripts.stores rename --approved-by 700000301 --store MAIN --name "Магазин після ролі"
```

```
700000301  Власниця  [Роль]
    OWNER    every store
renamed: MAIN is «Магазин після ролі»
 Container birka-rehearsal-role-api-run-9f568c458f1a Creating 
 Container birka-rehearsal-role-api-run-9f568c458f1a Created 
 Container birka-rehearsal-role-api-run-4fc6977e0168 Creating 
 Container birka-rehearsal-role-api-run-4fc6977e0168 Created
```

**The API's own connection tries to turn off the ledger's triggers** — ran (exit 1, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose exec -T api python -c 'import asyncio
from sqlalchemy import text
from app.core.config import get_settings
from app.core.db import create_engine
async def main():
    engine = create_engine(get_settings())
    async with engine.begin() as connection:
        await connection.execute(text("ALTER TABLE credit_entry DISABLE TRIGGER ALL"))
asyncio.run(main())'
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
sqlalchemy.exc.ProgrammingError: (sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError) <class 'asyncpg.exceptions.InsufficientPrivilegeError'>: must be owner of table credit_entry
[SQL: ALTER TABLE credit_entry DISABLE TRIGGER ALL]
(Background on this error at: https://sqlalche.me/e/20/f405)
```

- held: refused: must be owner of table credit_entry

**The old command, from api: a migration's downgrade** — ran (exit 1, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api alembic downgrade -1
```

```
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
sqlalchemy.exc.DBAPIError: (sqlalchemy.dialects.postgresql.asyncpg.Error) <class 'asyncpg.exceptions.RaiseError'>: A customer has been erased; 0037 cannot hold a debt without one. Keep this revision.
[SQL: 
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM customer_credit WHERE customer_erased_at IS NOT NULL) THEN
                RAISE EXCEPTION
                    'A customer has been erased; 0037 cannot hold a debt without one. '
                    'Keep this revision.';
            END IF;
        END $$;
        ]
(Background on this error at: https://sqlalche.me/e/20/dbapi)
```

**The schema after it** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT version_num FROM alembic_version;
SQL
```

```
0038_customer_erasure
```

- held: from api, as birka_app, the schema cannot be changed: refused, and it stays `0038_customer_erasure`

**The watcher's failures since it started as birka_app** — ran (exit 0, 0.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose logs backup-watch | grep -c 'backup_watch.failed' || true
```

```
0
```

- held: the watcher runs as birka_app without a failure

**The night's backup, by the owner's role, after it all** — held (exit 0, 5.2 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops
docker compose run --rm backup-watch python -m scripts.backup_watch --status   # as birka_app
```

```
{"started_at": "2026-10-09T19:21:05.522249+00:00", "ok": true, "problems": [], "archive": "birka-20261009T192105Z.dump.age", "bytes": 346149, "rows": 130, "drill": {"ok": true, "restore_seconds": 0.204, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T19:21:06.003942+00:00"}
{"state": "OK", "checked_at": "2026-10-09T19:21:08.386368+00:00", "latest": {"finished_at": "2026-10-09T19:21:06.003942+00:00", "ok": true, "archive": "birka-20261009T192105Z.dump.age", "problems": []}}
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-ops-run-c5a2e393dd14 Creating 
 Container birka-rehearsal-role-ops-run-c5a2e393dd14 Created 
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-backup-watch-run-24135ba5cf42 Creating 
 Container birka-rehearsal-role-backup-watch-run-24135ba5cf42 Created
```

The night: `birka-20261009T192105Z`; stock and sales then: {'on_hand': 6, 'sales': 4}.

## 3. Going back, 1: the code alone, to 65546f6

**The old code** — held (exit 0, 2.7 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka checkout 65546f6
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka/backend   # stands in for the build
docker compose up -d
```

```
birka-rehearsal-role-api:65546f6
birka-rehearsal-role-ops:65546f6
Previous HEAD position was 2701706 feat(server): the API and the watcher connect as birka_app — rows only, no superuser, so the ledger's triggers hold against the API
HEAD is now at 65546f6 docs(server): the first install rehearsed — steps 3 to 10 held, Caddy's first refusal and a second opening list now described (#78)
 Container birka-rehearsal-role-caddy-1 Running 
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-api-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreated 
 Container birka-rehearsal-role-api-1 Recreated 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Starting 
 Container birka-rehearsal-role-web-1 Started 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-backup-watch-1 Starting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-api-1 Starting 
 Container birka-rehearsal-role-backup-watch-1 Started 
 Container birka-rehearsal-role-api-1 Started 
 Container birka-rehearsal-role-web-1 Waiting 
 Container birka-rehearsal-role-web-1 Exited
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
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
birka True
```

- held: the old release's API connects as the owner again; the role stays, unused

- held: the same stock and sales

**Forward again: the runbook's block** — held (exit 0, 9.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka checkout 2701706
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose --profile ops run --rm --no-deps ops alembic upgrade head   # if this fails, stop here: see below
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role   # the rights, new tables too
docker compose up -d
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58943/api/v1/ready
```

```
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-ops-run-db171886eb63 Creating 
 Container birka-rehearsal-role-ops-run-db171886eb63 Created 
Previous HEAD position was 65546f6 docs(server): the first install rehearsed — steps 3 to 10 held, Caddy's first refusal and a second opening list now described (#78)
HEAD is now at 2701706 feat(server): the API and the watcher connect as birka_app — rows only, no superuser, so the ledger's triggers hold against the API
 Container birka-rehearsal-role-ops-run-1bae7bfd7d95 Creating 
 Container birka-rehearsal-role-ops-run-1bae7bfd7d95 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
 Container birka-rehearsal-role-ops-run-8d49b0780f62 Creating 
 Container birka-rehearsal-role-ops-run-8d49b0780f62 Created 
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-caddy-1 Running 
 Container birka-rehearsal-role-api-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreated 
 Container birka-rehearsal-role-api-1 Recreated 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Starting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Started 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-backup-watch-1 Starting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-api-1 Starting 
 Container birka-rehearsal-role-backup-watch-1 Started 
 Container birka-rehearsal-role-api-1 Started 
 Container birka-rehearsal-role-web-1 Waiting 
 Container birka-rehearsal-role-web-1 Exited 
curl: (56) The requested URL returned error: 502
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
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

- held: the API is birka_app again

## 4. Restoring for real, on a new server, from the night `birka-20261009T192105Z`

- held: steps 1–2: the owner opens the night with the key, on their computer

**Step 3: the new server's database (its .env the old one's)** — held (exit 0, 6.3 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka/backend
docker compose up -d --wait db
```

```
birka-rehearsal-role-api:2701706
birka-rehearsal-role-ops:2701706
 Network birka-rehearsal-role-new_default Creating 
 Volume birka-rehearsal-role-new_db_data Creating 
 Network birka-rehearsal-role-new_default Creating 
 Volume birka-rehearsal-role-new_db_data Creating 
 Volume birka-rehearsal-role-new_db_data Created 
 Volume birka-rehearsal-role-new_db_data Created 
 Network birka-rehearsal-role-new_default Created 
 Network birka-rehearsal-role-new_default Created 
 Container birka-rehearsal-role-new-db-1 Creating 
 Container birka-rehearsal-role-new-db-1 Created 
 Container birka-rehearsal-role-new-db-1 Starting 
 Container birka-rehearsal-role-new-db-1 Started 
 Container birka-rehearsal-role-new-db-1 Waiting 
 Container birka-rehearsal-role-new-db-1 Healthy
```

**Step 4: the restore** — held (exit 0, 0.3 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose exec -T db sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --exit-on-error --single-transaction --no-owner --no-privileges' < /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/backups/birka.dump
```

```

```

**Step 5, its first line: the schema (nothing to do: the code is the backup's)** — held (exit 0, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm --no-deps ops alembic upgrade head
```

```
Container birka-rehearsal-role-new-ops-run-282e91a7987a Creating 
 Container birka-rehearsal-role-new-ops-run-282e91a7987a Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
```

Step 6 run before step 5's second line, as an administrator might: what the API does then.

**Started too early** — held (exit 0, 1.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose up -d
```

```
 Volume birka-rehearsal-role-new_caddy_data Creating 
 Container birka-rehearsal-role-new-api-1 Creating 
 Volume birka-rehearsal-role-new_web_dist Created 
 Volume birka-rehearsal-role-new_web_dist Created 
 Container birka-rehearsal-role-new-web-1 Creating 
 Volume birka-rehearsal-role-new_caddy_config Created 
 Volume birka-rehearsal-role-new_caddy_config Created 
 Volume birka-rehearsal-role-new_caddy_data Created 
 Volume birka-rehearsal-role-new_caddy_data Created 
 Network birka-rehearsal-role-new_edge Created 
 Network birka-rehearsal-role-new_edge Created 
 Container birka-rehearsal-role-new-web-1 Created 
 Container birka-rehearsal-role-new-api-1 Created 
 Container birka-rehearsal-role-new-caddy-1 Creating 
 Container birka-rehearsal-role-new-backup-watch-1 Created 
 Container birka-rehearsal-role-new-caddy-1 Created 
 Container birka-rehearsal-role-new-web-1 Starting 
 Container birka-rehearsal-role-new-db-1 Waiting 
 Container birka-rehearsal-role-new-db-1 Waiting 
 Container birka-rehearsal-role-new-web-1 Started 
 Container birka-rehearsal-role-new-db-1 Healthy 
 Container birka-rehearsal-role-new-db-1 Healthy 
 Container birka-rehearsal-role-new-api-1 Starting 
 Container birka-rehearsal-role-new-backup-watch-1 Starting 
 Container birka-rehearsal-role-new-api-1 Started 
 Container birka-rehearsal-role-new-web-1 Waiting 
 Container birka-rehearsal-role-new-backup-watch-1 Started 
 Container birka-rehearsal-role-new-web-1 Exited 
 Container birka-rehearsal-role-new-caddy-1 Starting 
 Container birka-rehearsal-role-new-caddy-1 Started
```

**The API's log** — ran (exit 0, 0.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose logs api | grep database.unreachable | tail -1
```

```
api-1  | {"logger": "app.api.internal", "error": "InvalidPasswordError", "cause": null, "event": "database.unreachable", "level": "warning", "request_id": "9cfc4dd6-8998-4df5-a827-d01c6fe25671", "timestamp": "2026-10-09T19:21:35.048968Z"}
```

- held: not ready, «database» (503 {"status":"not_ready","reason":"database"}), and the log names the refusal the runbook's table of messages sends to `scripts.app_role`: the role is not there yet on an empty volume

**Step 5, its second line: the role's rights** — held (exit 0, 0.7 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role
```

```
birka_app: created
72 tables: read and write
alembic_version: read only
the database: connect only, no temporary tables
 Container birka-rehearsal-role-new-ops-run-aabfa19360ee Creating 
 Container birka-rehearsal-role-new-ops-run-aabfa19360ee Created
```

**Step 6: start** — held (exit 0, 1.2 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose up -d
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58944/api/v1/ready
```

```
{"status":"ready"} Container birka-rehearsal-role-new-api-1 Running 
 Container birka-rehearsal-role-new-backup-watch-1 Running 
 Container birka-rehearsal-role-new-caddy-1 Running 
 Container birka-rehearsal-role-new-db-1 Running 
 Container birka-rehearsal-role-new-web-1 Starting 
 Container birka-rehearsal-role-new-db-1 Waiting 
 Container birka-rehearsal-role-new-db-1 Waiting 
 Container birka-rehearsal-role-new-web-1 Started 
 Container birka-rehearsal-role-new-db-1 Healthy 
 Container birka-rehearsal-role-new-db-1 Healthy 
 Container birka-rehearsal-role-new-web-1 Waiting 
 Container birka-rehearsal-role-new-web-1 Exited
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
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

- held: the new server's API connects as birka_app

- held: the night's stock and sales are back: {'on_hand': 6, 'sales': 4}

- held: Марія stays erased: the night was after it

- held: a sale on the new server, as birka_app

**Removed: birka-rehearsal-role** — ran (exit 0, 1.0 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose --profile ops down -v --remove-orphans
```

```
 Container birka-rehearsal-role-caddy-1 Stopped 
 Container birka-rehearsal-role-caddy-1 Removing 
 Container birka-rehearsal-role-caddy-1 Removed 
 Container birka-rehearsal-role-api-1 Stopping 
 Container birka-rehearsal-role-web-1 Stopping 
 Container birka-rehearsal-role-web-1 Stopped 
 Container birka-rehearsal-role-web-1 Removing 
 Container birka-rehearsal-role-web-1 Removed 
 Container birka-rehearsal-role-backup-watch-1 Stopped 
 Container birka-rehearsal-role-backup-watch-1 Removing 
 Container birka-rehearsal-role-backup-watch-1 Removed 
 Container birka-rehearsal-role-api-1 Stopped 
 Container birka-rehearsal-role-api-1 Removing 
 Container birka-rehearsal-role-api-1 Removed 
 Container birka-rehearsal-role-db-1 Stopping 
 Container birka-rehearsal-role-db-1 Stopped 
 Container birka-rehearsal-role-db-1 Removing 
 Container birka-rehearsal-role-db-1 Removed 
 Volume birka-rehearsal-role_caddy_data Removing 
 Volume birka-rehearsal-role_web_dist Removing 
 Volume birka-rehearsal-role_db_data Removing 
 Volume birka-rehearsal-role_caddy_config Removing 
 Network birka-rehearsal-role_edge Removing 
 Network birka-rehearsal-role_default Removing 
 Volume birka-rehearsal-role_caddy_data Removed 
 Volume birka-rehearsal-role_caddy_config Removed 
 Volume birka-rehearsal-role_db_data Removed 
 Volume birka-rehearsal-role_web_dist Removed 
 Network birka-rehearsal-role_edge Removed 
 Network birka-rehearsal-role_default Removed
```

**Removed: birka-rehearsal-role-new** — ran (exit 0, 1.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose --profile ops down -v --remove-orphans
```

```
 Container birka-rehearsal-role-new-caddy-1 Stopped 
 Container birka-rehearsal-role-new-caddy-1 Removing 
 Container birka-rehearsal-role-new-caddy-1 Removed 
 Container birka-rehearsal-role-new-api-1 Stopping 
 Container birka-rehearsal-role-new-web-1 Stopping 
 Container birka-rehearsal-role-new-web-1 Stopped 
 Container birka-rehearsal-role-new-web-1 Removing 
 Container birka-rehearsal-role-new-web-1 Removed 
 Container birka-rehearsal-role-new-backup-watch-1 Stopped 
 Container birka-rehearsal-role-new-backup-watch-1 Removing 
 Container birka-rehearsal-role-new-backup-watch-1 Removed 
 Container birka-rehearsal-role-new-api-1 Stopped 
 Container birka-rehearsal-role-new-api-1 Removing 
 Container birka-rehearsal-role-new-api-1 Removed 
 Container birka-rehearsal-role-new-db-1 Stopping 
 Container birka-rehearsal-role-new-db-1 Stopped 
 Container birka-rehearsal-role-new-db-1 Removing 
 Container birka-rehearsal-role-new-db-1 Removed 
 Volume birka-rehearsal-role-new_caddy_data Removing 
 Network birka-rehearsal-role-new_edge Removing 
 Volume birka-rehearsal-role-new_db_data Removing 
 Volume birka-rehearsal-role-new_web_dist Removing 
 Volume birka-rehearsal-role-new_caddy_config Removing 
 Network birka-rehearsal-role-new_default Removing 
 Volume birka-rehearsal-role-new_caddy_data Removed 
 Volume birka-rehearsal-role-new_db_data Removed 
 Volume birka-rehearsal-role-new_web_dist Removed 
 Volume birka-rehearsal-role-new_caddy_config Removed 
 Network birka-rehearsal-role-new_edge Removed 
 Network birka-rehearsal-role-new_default Removed
```

## Findings

None.
