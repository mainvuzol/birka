# Rehearsal: the app's own database role, through an update and a restore

From `65546f6` (main, the API as the database's owner) to `2701706` (the role), on one server whose checkout is a local clone; then a restore on a new server. Started 2026-10-09 22:18:43 EEST. Passwords are base64 as the runbook makes them; test secrets, the tests' fake bot token; no way out of the compose network.

## Installed at 65546f6, as its runbook said

**Build (stand-in), database, migration, start** — held (exit 0, 9.2 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka/backend
docker compose up -d --wait db
docker compose run --rm --no-deps api alembic upgrade head
docker compose up -d
```

```
 Volume birka-rehearsal-role_caddy_config Creating 
 Container birka-rehearsal-role-backup-watch-1 Creating 
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
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Starting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Started 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-api-1 Starting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-backup-watch-1 Starting 
 Container birka-rehearsal-role-api-1 Started 
 Container birka-rehearsal-role-web-1 Waiting 
 Container birka-rehearsal-role-backup-watch-1 Started 
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
seed complete for organization c293ed9c-94bb-40f2-8e8a-52324c35a713
 Container birka-rehearsal-role-api-run-e6cb02f2dac5 Creating 
 Container birka-rehearsal-role-api-run-e6cb02f2dac5 Created
```

**Who api is to the database** — held (exit 0, 0.4 s)

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

**The runbook's block** — held (exit 0, 9.0 s)

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
 Container birka-rehearsal-role-ops-run-79d801b860f8 Creating 
 Container birka-rehearsal-role-ops-run-79d801b860f8 Created 
Previous HEAD position was 65546f6 docs(server): the first install rehearsed — steps 3 to 10 held, Caddy's first refusal and a second opening list now described (#78)
HEAD is now at 2701706 feat(server): the API and the watcher connect as birka_app — rows only, no superuser, so the ledger's triggers hold against the API
 Container birka-rehearsal-role-ops-run-850699586b3e Creating 
 Container birka-rehearsal-role-ops-run-850699586b3e Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
 Container birka-rehearsal-role-ops-run-40b956311423 Creating 
 Container birka-rehearsal-role-ops-run-40b956311423 Created 
 Container birka-rehearsal-role-caddy-1 Running 
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-api-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreated 
 Container birka-rehearsal-role-api-1 Recreated 
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

**Who backup-watch is to the database** — held (exit 0, 0.4 s)

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

- DID NOT HOLD: a sale, a payment, and Марія erased on request, through the app

> **Finding:** a sale, a payment, and Марія erased on request, through the app


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
 Container birka-rehearsal-role-api-run-2c67850dba7d Creating 
 Container birka-rehearsal-role-api-run-2c67850dba7d Created 
 Container birka-rehearsal-role-api-run-578a6acd60d4 Creating 
 Container birka-rehearsal-role-api-run-578a6acd60d4 Created
```

**The API's own connection tries to turn off the ledger's triggers** — ran (exit 1, 0.4 s)

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

**The night's backup, by the owner's role, after it all** — held (exit 0, 5.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops
docker compose run --rm backup-watch python -m scripts.backup_watch --status   # as birka_app
```

```
{"started_at": "2026-10-09T19:19:12.073955+00:00", "ok": true, "problems": [], "archive": "birka-20261009T191912Z.dump.age", "bytes": 346133, "rows": 130, "drill": {"ok": true, "restore_seconds": 0.176, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T19:19:12.520786+00:00"}
{"state": "OK", "checked_at": "2026-10-09T19:19:14.819459+00:00", "latest": {"finished_at": "2026-10-09T19:19:12.520786+00:00", "ok": true, "archive": "birka-20261009T191912Z.dump.age", "problems": []}}
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-ops-run-b67e075a79f7 Creating 
 Container birka-rehearsal-role-ops-run-b67e075a79f7 Created 
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-backup-watch-run-f69d59d83ba6 Creating 
 Container birka-rehearsal-role-backup-watch-run-f69d59d83ba6 Created
```

The night: `birka-20261009T191912Z`; stock and sales then: {'on_hand': 6, 'sales': 4}.

## 3. Going back, 1: the code alone, to 65546f6

**The old code** — held (exit 0, 2.6 s)

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
 Container birka-rehearsal-role-web-1 Starting 
 Container birka-rehearsal-role-db-1 Waiting 
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

**Forward again: the runbook's block** — held (exit 0, 8.7 s)

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
 Container birka-rehearsal-role-ops-run-a51b17a7669f Creating 
 Container birka-rehearsal-role-ops-run-a51b17a7669f Created 
Previous HEAD position was 65546f6 docs(server): the first install rehearsed — steps 3 to 10 held, Caddy's first refusal and a second opening list now described (#78)
HEAD is now at 2701706 feat(server): the API and the watcher connect as birka_app — rows only, no superuser, so the ledger's triggers hold against the API
 Container birka-rehearsal-role-ops-run-f61dd67fcb4a Creating 
 Container birka-rehearsal-role-ops-run-f61dd67fcb4a Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
 Container birka-rehearsal-role-ops-run-0aa011fc717e Creating 
 Container birka-rehearsal-role-ops-run-0aa011fc717e Created 
 Container birka-rehearsal-role-db-1 Running 
 Container birka-rehearsal-role-caddy-1 Running 
 Container birka-rehearsal-role-backup-watch-1 Recreate 
 Container birka-rehearsal-role-api-1 Recreate 
 Container birka-rehearsal-role-backup-watch-1 Recreated 
 Container birka-rehearsal-role-api-1 Recreated 
 Container birka-rehearsal-role-web-1 Starting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-db-1 Waiting 
 Container birka-rehearsal-role-web-1 Started 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-db-1 Healthy 
 Container birka-rehearsal-role-api-1 Starting 
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

- held: the API is birka_app again

## 4. Restoring for real, on a new server, from the night `birka-20261009T191912Z`

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
 Network birka-rehearsal-role-new_default Creating 
 Volume birka-rehearsal-role-new_db_data Creating 
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
Container birka-rehearsal-role-new-ops-run-beacec06bb88 Creating 
 Container birka-rehearsal-role-new-ops-run-beacec06bb88 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
```

Before step 5's second line: what the API does without the rights.

**The API started too early** — held (exit 0, 0.7 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose up -d api
```

```
Container birka-rehearsal-role-new-db-1 Running 
 Container birka-rehearsal-role-new-api-1 Creating 
 Container birka-rehearsal-role-new-api-1 Created 
 Container birka-rehearsal-role-new-db-1 Waiting 
 Container birka-rehearsal-role-new-db-1 Healthy 
 Container birka-rehearsal-role-new-api-1 Starting 
 Container birka-rehearsal-role-new-api-1 Started
```

**Removed: birka-rehearsal-role** — ran (exit 0, 1.2 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/srv-birka rev-parse --short HEAD)
docker compose --profile ops down -v --remove-orphans
```

```
 Container birka-rehearsal-role-caddy-1 Stopped 
 Container birka-rehearsal-role-caddy-1 Removing 
 Container birka-rehearsal-role-caddy-1 Removed 
 Container birka-rehearsal-role-web-1 Stopping 
 Container birka-rehearsal-role-api-1 Stopping 
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
 Volume birka-rehearsal-role_web_dist Removing 
 Volume birka-rehearsal-role_caddy_data Removing 
 Volume birka-rehearsal-role_db_data Removing 
 Network birka-rehearsal-role_default Removing 
 Volume birka-rehearsal-role_caddy_config Removing 
 Network birka-rehearsal-role_edge Removing 
 Volume birka-rehearsal-role_caddy_data Removed 
 Volume birka-rehearsal-role_db_data Removed 
 Volume birka-rehearsal-role_web_dist Removed 
 Volume birka-rehearsal-role_caddy_config Removed 
 Network birka-rehearsal-role_default Removed 
 Network birka-rehearsal-role_edge Removed
```

**Removed: birka-rehearsal-role-new** — ran (exit 0, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/role-rehearsal/work-role/new-server/srv-birka rev-parse --short HEAD)
docker compose --profile ops down -v --remove-orphans
```

```
Container birka-rehearsal-role-new-api-1 Stopping 
 Container birka-rehearsal-role-new-api-1 Stopped 
 Container birka-rehearsal-role-new-api-1 Removing 
 Container birka-rehearsal-role-new-api-1 Removed 
 Container birka-rehearsal-role-new-db-1 Stopping 
 Container birka-rehearsal-role-new-db-1 Stopped 
 Container birka-rehearsal-role-new-db-1 Removing 
 Container birka-rehearsal-role-new-db-1 Removed 
 Volume birka-rehearsal-role-new_db_data Removing 
 Network birka-rehearsal-role-new_default Removing 
 Volume birka-rehearsal-role-new_db_data Removed 
 Network birka-rehearsal-role-new_default Removed
```

## Findings

- a sale, a payment, and Марія erased on request, through the app
