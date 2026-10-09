# Rehearsal: every container held, through an update and a restore

From `4954b3f` (main, no container held) to `98afbd8` (every container held), on one server whose checkout is a local clone; then a restore on a new server. Started 2026-10-09 23:47:15 EEST. Passwords are base64 as the runbook makes them; test secrets, the tests' fake bot token; no way out of the compose network.

## Installed at 4954b3f, as its runbook said

**Build (stand-in), database, migration, the app's role, start** — held (exit 0, 9.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka/backend
docker compose up -d --wait db
docker compose --profile ops run --rm --no-deps ops alembic upgrade head
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role
docker compose up -d
```

```
 Volume birka-rehearsal-limits_caddy_config Creating 
 Volume birka-rehearsal-limits_caddy_config Creating 
 Volume birka-rehearsal-limits_web_dist Created 
 Volume birka-rehearsal-limits_web_dist Created 
 Container birka-rehearsal-limits-web-1 Creating 
 Volume birka-rehearsal-limits_caddy_data Created 
 Volume birka-rehearsal-limits_caddy_data Created 
 Volume birka-rehearsal-limits_caddy_config Created 
 Volume birka-rehearsal-limits_caddy_config Created 
 Network birka-rehearsal-limits_edge Created 
 Network birka-rehearsal-limits_edge Created 
 Container birka-rehearsal-limits-web-1 Created 
 Container birka-rehearsal-limits-api-1 Created 
 Container birka-rehearsal-limits-caddy-1 Creating 
 Container birka-rehearsal-limits-backup-watch-1 Created 
 Container birka-rehearsal-limits-caddy-1 Created 
 Container birka-rehearsal-limits-web-1 Starting 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-web-1 Started 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-backup-watch-1 Starting 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-api-1 Starting 
 Container birka-rehearsal-limits-backup-watch-1 Started 
 Container birka-rehearsal-limits-api-1 Started 
 Container birka-rehearsal-limits-web-1 Waiting 
 Container birka-rehearsal-limits-web-1 Exited 
 Container birka-rehearsal-limits-caddy-1 Starting 
 Container birka-rehearsal-limits-caddy-1 Started
```

**The owner and the shop's places** — held (exit 0, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api python -m scripts.seed_organization --telegram-user-id 700000301 --owner-name "Власниця" --org-name "Роль"
```

```
seed complete for organization bd2cbb55-27b6-49c0-bf3b-2a002677e145
 Container birka-rehearsal-limits-api-run-52b8c2087c40 Creating 
 Container birka-rehearsal-limits-api-run-52b8c2087c40 Created
```

**Who api is to the database** — held (exit 0, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
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

- held: before: the API connects as birka_app

**A write into the API's image** — ran (exit 0, 0.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose exec -T api sh -c 'touch /app/probe'
```

```

```

**Each container as Docker runs it** — held (exit 0, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
for s in db api backup-watch caddy web; do for id in $(docker compose ps -a -q $s); do printf '%s ' $s; docker inspect -f '{{.HostConfig.Privileged}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' $id; done; done
```

```
db false false [] [] 0 0
api false false [] [] 0 0
backup-watch false false [] [] 0 0
caddy false false [] [] 0 0
web false false [] [] 0 0
```

- held: before: no container held; the API may write its image

Used through the app: a model received 10, three sales, two in parts (Марія paid off, Ірина owes 1000). Stock and sales: {'on_hand': 7, 'sales': 3}.

## 1. A new version: 4954b3f → 98afbd8

**The runbook's block** — held (exit 0, 14.7 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka checkout 98afbd8
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose --profile ops run --rm --no-deps ops alembic upgrade head   # if this fails, stop here: see below
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role   # the rights, new tables too
docker compose up -d
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58947/api/v1/ready
```

```
INFO  [alembic.runtime.migration] Will assume transactional DDL.
 Container birka-rehearsal-limits-ops-run-b9b3f4cb5d84 Creating 
 Container birka-rehearsal-limits-ops-run-b9b3f4cb5d84 Created 
 Container birka-rehearsal-limits-web-1 Recreate 
 Container birka-rehearsal-limits-db-1 Recreate 
 Container birka-rehearsal-limits-web-1 Recreated 
 Container birka-rehearsal-limits-db-1 Recreated 
 Container birka-rehearsal-limits-api-1 Recreate 
 Container birka-rehearsal-limits-backup-watch-1 Recreate 
 Container birka-rehearsal-limits-backup-watch-1 Recreated 
 Container birka-rehearsal-limits-api-1 Recreated 
 Container birka-rehearsal-limits-caddy-1 Recreate 
 Container birka-rehearsal-limits-caddy-1 Recreated 
 Container birka-rehearsal-limits-db-1 Starting 
 Container birka-rehearsal-limits-web-1 Starting 
 Container birka-rehearsal-limits-db-1 Started 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-web-1 Started 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-api-1 Starting 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-backup-watch-1 Starting 
 Container birka-rehearsal-limits-api-1 Started 
 Container birka-rehearsal-limits-web-1 Waiting 
 Container birka-rehearsal-limits-backup-watch-1 Started 
 Container birka-rehearsal-limits-web-1 Exited 
 Container birka-rehearsal-limits-caddy-1 Starting 
 Container birka-rehearsal-limits-caddy-1 Started 
curl: (56) The requested URL returned error: 502
```

**Each container as Docker runs it** — held (exit 0, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
for s in db api backup-watch caddy web; do for id in $(docker compose ps -a -q $s); do printf '%s ' $s; docker inspect -f '{{.HostConfig.Privileged}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' $id; done; done
```

```
db false true [ALL] [CAP_CHOWN CAP_DAC_READ_SEARCH CAP_FOWNER CAP_SETGID CAP_SETUID] 1073741824 1073741824
api false true [ALL] [] 805306368 805306368
backup-watch false true [ALL] [] 536870912 536870912
caddy false true [ALL] [CAP_NET_BIND_SERVICE] 268435456 268435456
web false true [ALL] [] 134217728 134217728
```

- held: after: every container held, on the volumes the old ones left

**A write into the API's image** — ran (exit 1, 0.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose exec -T api sh -c 'touch /app/probe'
```

```
touch: cannot touch '/app/probe': Read-only file system
```

- held: after: a write into the API's image is refused

**Who api is to the database** — held (exit 0, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
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
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
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

- held: a sale, a payment, and Марія erased on request, through the app: {'erased': 1, 'still_open': 0, 'network': True, 'credit': {'id': '88007c8b-fd1e-4ffa-98cd-6108f75e7e2e', 'sale_id': '8ec9785d-1c48-460d-b7a1-0df01dfff22c', 'store_id': '6cba1a54-65de-4b95-a93c-c1ba8b571328', 'store_name': 'Основний магазин', 'store_state': 'ACTIVE', 'customer_name': None, 'customer_phone': None, 'customer_erased_at': '2026-10-09T20:47:45.425404Z', 'amount': '1500.00', 'currency_code': 'UAH', 'status': 'SETTLED', 'paid': '1500.00', 'returned': '0.00', 'cash_back': '0.00', 'written_off': '0.00', 'owed': '0.00', 'opened_at': '2026-10-09T20:47:29.083401Z', 'last_payment_at': '2026-10-09T20:47:29.109421Z', 'closed_at': '2026-10-09T20:47:29.111909Z', 'goods': ['Лоран роль шоколад × 1'], 'entries': [{'kind': 'PAYMENT', 'amount': '500.00', 'cash_back': '0.00', 'at': '2026-10-09T20:47:29.083401Z', 'by': 'Власниця', 'note': None, 'taken_at': None, 'payment_method': 'CASH', 'corrected': False}, {'kind': 'PAYMENT', 'amount': '1000.00', 'cash_back': '0.00', 'at': '2026-10-09T20:47:29.109421Z', 'by': 'Власниця', 'note': None, 'taken_at': None, 'payment_method': 'CASH', 'corrected': False}]}}

- held: Марія's name gone (None), Ірина owes 700.00

**The people's and stores' commands, from api, as birka_app** — held (exit 0, 1.7 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api python -m scripts.people list
docker compose run --rm --no-deps api python -m scripts.stores rename --approved-by 700000301 --store MAIN --name "Магазин після ролі"
```

```
700000301  Власниця  [Роль]
    OWNER    every store
renamed: MAIN is «Магазин після ролі»
 Container birka-rehearsal-limits-api-run-69e1f73a00b9 Creating 
 Container birka-rehearsal-limits-api-run-69e1f73a00b9 Created 
 Container birka-rehearsal-limits-api-run-16ef17a73709 Creating 
 Container birka-rehearsal-limits-api-run-16ef17a73709 Created
```

**The API's own connection tries to turn off the ledger's triggers** — ran (exit 1, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
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
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
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
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose logs backup-watch | grep -c 'backup_watch.failed' || true
```

```
0
```

- held: the watcher runs as birka_app without a failure

**The night's backup, by the owner's role, after it all** — held (exit 0, 5.0 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops
docker compose run --rm backup-watch python -m scripts.backup_watch --status   # as birka_app
```

```
{"started_at": "2026-10-09T20:47:50.514009+00:00", "ok": true, "problems": [], "archive": "birka-20261009T204750Z.dump.age", "bytes": 346135, "rows": 130, "drill": {"ok": true, "restore_seconds": 0.184, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T20:47:50.974791+00:00"}
{"state": "OK", "checked_at": "2026-10-09T20:47:53.289705+00:00", "latest": {"finished_at": "2026-10-09T20:47:50.974791+00:00", "ok": true, "archive": "birka-20261009T204750Z.dump.age", "problems": []}}
 Container birka-rehearsal-limits-db-1 Running 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-ops-run-4f3abf9e4aa7 Creating 
 Container birka-rehearsal-limits-ops-run-4f3abf9e4aa7 Created 
 Container birka-rehearsal-limits-db-1 Running 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-backup-watch-run-ba59edf7d44e Creating 
 Container birka-rehearsal-limits-backup-watch-run-ba59edf7d44e Created
```

The night: `birka-20261009T204750Z`; stock and sales then: {'on_hand': 6, 'sales': 4}.

## 3. Going back, 1: the code alone, to 4954b3f

**The old code** — held (exit 0, 8.2 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka checkout 4954b3f
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka/backend   # stands in for the build
docker compose up -d
```

```
birka-rehearsal-limits-api:4954b3f
birka-rehearsal-limits-ops:4954b3f
Previous HEAD position was 98afbd8 fix(server): the review's gaps closed — the backup and the watcher held in CI, no privileged container, no swap beyond a limit
HEAD is now at 4954b3f feat(server): the API and the watcher connect as birka_app — rows only, no superuser, so the ledger's triggers hold against the API (#79)
 Container birka-rehearsal-limits-db-1 Recreate 
 Container birka-rehearsal-limits-web-1 Recreate 
 Container birka-rehearsal-limits-web-1 Recreated 
 Container birka-rehearsal-limits-db-1 Recreated 
 Container birka-rehearsal-limits-api-1 Recreate 
 Container birka-rehearsal-limits-backup-watch-1 Recreate 
 Container birka-rehearsal-limits-backup-watch-1 Recreated 
 Container birka-rehearsal-limits-api-1 Recreated 
 Container birka-rehearsal-limits-caddy-1 Recreate 
 Container birka-rehearsal-limits-caddy-1 Recreated 
 Container birka-rehearsal-limits-db-1 Starting 
 Container birka-rehearsal-limits-web-1 Starting 
 Container birka-rehearsal-limits-db-1 Started 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-web-1 Started 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-api-1 Starting 
 Container birka-rehearsal-limits-backup-watch-1 Starting 
 Container birka-rehearsal-limits-api-1 Started 
 Container birka-rehearsal-limits-web-1 Waiting 
 Container birka-rehearsal-limits-backup-watch-1 Started 
 Container birka-rehearsal-limits-web-1 Exited 
 Container birka-rehearsal-limits-caddy-1 Starting 
 Container birka-rehearsal-limits-caddy-1 Started
```

**A write into the API's image** — ran (exit 0, 0.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose exec -T api sh -c 'touch /app/probe'
```

```

```

**Each container as Docker runs it** — held (exit 0, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
for s in db api backup-watch caddy web; do for id in $(docker compose ps -a -q $s); do printf '%s ' $s; docker inspect -f '{{.HostConfig.Privileged}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' $id; done; done
```

```
db false false [] [] 0 0
api false false [] [] 0 0
backup-watch false false [] [] 0 0
caddy false false [] [] 0 0
web false false [] [] 0 0
```

- held: the old release's containers are not held again

- held: the same stock and sales

**Forward again: the runbook's block** — held (exit 0, 14.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka checkout 98afbd8
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose --profile ops run --rm --no-deps ops alembic upgrade head   # if this fails, stop here: see below
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role   # the rights, new tables too
docker compose up -d
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58947/api/v1/ready
```

```
INFO  [alembic.runtime.migration] Will assume transactional DDL.
 Container birka-rehearsal-limits-ops-run-b5046534e0fb Creating 
 Container birka-rehearsal-limits-ops-run-b5046534e0fb Created 
 Container birka-rehearsal-limits-db-1 Recreate 
 Container birka-rehearsal-limits-web-1 Recreate 
 Container birka-rehearsal-limits-web-1 Recreated 
 Container birka-rehearsal-limits-db-1 Recreated 
 Container birka-rehearsal-limits-backup-watch-1 Recreate 
 Container birka-rehearsal-limits-api-1 Recreate 
 Container birka-rehearsal-limits-backup-watch-1 Recreated 
 Container birka-rehearsal-limits-api-1 Recreated 
 Container birka-rehearsal-limits-caddy-1 Recreate 
 Container birka-rehearsal-limits-caddy-1 Recreated 
 Container birka-rehearsal-limits-db-1 Starting 
 Container birka-rehearsal-limits-web-1 Starting 
 Container birka-rehearsal-limits-db-1 Started 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-db-1 Waiting 
 Container birka-rehearsal-limits-web-1 Started 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-db-1 Healthy 
 Container birka-rehearsal-limits-backup-watch-1 Starting 
 Container birka-rehearsal-limits-api-1 Starting 
 Container birka-rehearsal-limits-backup-watch-1 Started 
 Container birka-rehearsal-limits-api-1 Started 
 Container birka-rehearsal-limits-web-1 Waiting 
 Container birka-rehearsal-limits-web-1 Exited 
 Container birka-rehearsal-limits-caddy-1 Starting 
 Container birka-rehearsal-limits-caddy-1 Started 
curl: (56) The requested URL returned error: 502
```

**Each container as Docker runs it** — held (exit 0, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
for s in db api backup-watch caddy web; do for id in $(docker compose ps -a -q $s); do printf '%s ' $s; docker inspect -f '{{.HostConfig.Privileged}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' $id; done; done
```

```
db false true [ALL] [CAP_CHOWN CAP_DAC_READ_SEARCH CAP_FOWNER CAP_SETGID CAP_SETUID] 1073741824 1073741824
api false true [ALL] [] 805306368 805306368
backup-watch false true [ALL] [] 536870912 536870912
caddy false true [ALL] [CAP_NET_BIND_SERVICE] 268435456 268435456
web false true [ALL] [] 134217728 134217728
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
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

- held: held again, the API birka_app

## 4. Restoring for real, on a new server, from the night `birka-20261009T204750Z`

- held: steps 1–2: the owner opens the night with the key, on their computer

**Step 3: the new server's database (its .env the old one's)** — held (exit 0, 6.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka/backend
docker compose up -d --wait db
```

```
birka-rehearsal-limits-api:98afbd8
birka-rehearsal-limits-ops:98afbd8
 Network birka-rehearsal-limits-new_default Creating 
 Network birka-rehearsal-limits-new_default Creating 
 Volume birka-rehearsal-limits-new_db_data Creating 
 Volume birka-rehearsal-limits-new_db_data Creating 
 Volume birka-rehearsal-limits-new_db_data Created 
 Volume birka-rehearsal-limits-new_db_data Created 
 Network birka-rehearsal-limits-new_default Created 
 Network birka-rehearsal-limits-new_default Created 
 Container birka-rehearsal-limits-new-db-1 Creating 
 Container birka-rehearsal-limits-new-db-1 Created 
 Container birka-rehearsal-limits-new-db-1 Starting 
 Container birka-rehearsal-limits-new-db-1 Started 
 Container birka-rehearsal-limits-new-db-1 Waiting 
 Container birka-rehearsal-limits-new-db-1 Healthy
```

**Step 4: the restore** — held (exit 0, 0.3 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
docker compose exec -T db sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --exit-on-error --single-transaction --no-owner --no-privileges' < /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/backups/birka.dump
```

```

```

**Step 5, its first line: the schema (nothing to do: the code is the backup's)** — held (exit 0, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm --no-deps ops alembic upgrade head
```

```
Container birka-rehearsal-limits-new-ops-run-dddbb7dba9ec Creating 
 Container birka-rehearsal-limits-new-ops-run-dddbb7dba9ec Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
```

Step 6 run before step 5's second line, as an administrator might: what the API does then.

**Started too early** — held (exit 0, 1.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
docker compose up -d
```

```
 Container birka-rehearsal-limits-new-backup-watch-1 Creating 
 Network birka-rehearsal-limits-new_edge Creating 
 Volume birka-rehearsal-limits-new_web_dist Created 
 Volume birka-rehearsal-limits-new_web_dist Created 
 Container birka-rehearsal-limits-new-web-1 Creating 
 Volume birka-rehearsal-limits-new_caddy_config Created 
 Volume birka-rehearsal-limits-new_caddy_config Created 
 Volume birka-rehearsal-limits-new_caddy_data Created 
 Volume birka-rehearsal-limits-new_caddy_data Created 
 Network birka-rehearsal-limits-new_edge Created 
 Network birka-rehearsal-limits-new_edge Created 
 Container birka-rehearsal-limits-new-web-1 Created 
 Container birka-rehearsal-limits-new-api-1 Created 
 Container birka-rehearsal-limits-new-caddy-1 Creating 
 Container birka-rehearsal-limits-new-backup-watch-1 Created 
 Container birka-rehearsal-limits-new-caddy-1 Created 
 Container birka-rehearsal-limits-new-web-1 Starting 
 Container birka-rehearsal-limits-new-db-1 Waiting 
 Container birka-rehearsal-limits-new-db-1 Waiting 
 Container birka-rehearsal-limits-new-web-1 Started 
 Container birka-rehearsal-limits-new-db-1 Healthy 
 Container birka-rehearsal-limits-new-db-1 Healthy 
 Container birka-rehearsal-limits-new-api-1 Starting 
 Container birka-rehearsal-limits-new-backup-watch-1 Starting 
 Container birka-rehearsal-limits-new-api-1 Started 
 Container birka-rehearsal-limits-new-web-1 Waiting 
 Container birka-rehearsal-limits-new-backup-watch-1 Started 
 Container birka-rehearsal-limits-new-web-1 Exited 
 Container birka-rehearsal-limits-new-caddy-1 Starting 
 Container birka-rehearsal-limits-new-caddy-1 Started
```

**The API's log** — ran (exit 0, 0.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
docker compose logs api | grep database.unreachable | tail -1
```

```
api-1  | {"logger": "app.api.internal", "error": "InvalidPasswordError", "cause": null, "event": "database.unreachable", "level": "warning", "request_id": "f343d01c-a9f9-4b81-8a48-da93ccd5646d", "timestamp": "2026-10-09T20:48:31.426985Z"}
```

- held: not ready, «database» (503 {"status":"not_ready","reason":"database"}), and the log names the refusal the runbook's table of messages sends to `scripts.app_role`: the role is not there yet on an empty volume

**Step 5, its second line: the role's rights** — held (exit 0, 0.6 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role
```

```
birka_app: created
72 tables: read and write
alembic_version: read only
the database: connect only, no temporary tables
 Container birka-rehearsal-limits-new-ops-run-67693b596a5e Creating 
 Container birka-rehearsal-limits-new-ops-run-67693b596a5e Created
```

**Step 6: start** — held (exit 0, 1.2 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
docker compose up -d
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58948/api/v1/ready
```

```
{"status":"ready"} Container birka-rehearsal-limits-new-api-1 Running 
 Container birka-rehearsal-limits-new-backup-watch-1 Running 
 Container birka-rehearsal-limits-new-caddy-1 Running 
 Container birka-rehearsal-limits-new-db-1 Running 
 Container birka-rehearsal-limits-new-web-1 Starting 
 Container birka-rehearsal-limits-new-db-1 Waiting 
 Container birka-rehearsal-limits-new-db-1 Waiting 
 Container birka-rehearsal-limits-new-web-1 Started 
 Container birka-rehearsal-limits-new-db-1 Healthy 
 Container birka-rehearsal-limits-new-web-1 Waiting 
 Container birka-rehearsal-limits-new-db-1 Healthy 
 Container birka-rehearsal-limits-new-web-1 Exited
```

**Who api is to the database** — held (exit 0, 0.5 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
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

**Each container as Docker runs it** — held (exit 0, 0.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
for s in db api backup-watch caddy web; do for id in $(docker compose ps -a -q $s); do printf '%s ' $s; docker inspect -f '{{.HostConfig.Privileged}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' $id; done; done
```

```
db false true [ALL] [CAP_CHOWN CAP_DAC_READ_SEARCH CAP_FOWNER CAP_SETGID CAP_SETUID] 1073741824 1073741824
api false true [ALL] [] 805306368 805306368
backup-watch false true [ALL] [] 536870912 536870912
caddy false true [ALL] [CAP_NET_BIND_SERVICE] 268435456 268435456
web false true [ALL] [] 134217728 134217728
```

- held: the new server's containers are held

- held: the night's stock and sales are back: {'on_hand': 6, 'sales': 4}

- held: Марія stays erased: the night was after it

- held: a sale on the new server, as birka_app

**Removed: birka-rehearsal-limits** — ran (exit 0, 1.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/srv-birka rev-parse --short HEAD)
docker compose --profile ops down -v --remove-orphans
```

```
 Container birka-rehearsal-limits-caddy-1 Stopped 
 Container birka-rehearsal-limits-caddy-1 Removing 
 Container birka-rehearsal-limits-caddy-1 Removed 
 Container birka-rehearsal-limits-web-1 Stopping 
 Container birka-rehearsal-limits-api-1 Stopping 
 Container birka-rehearsal-limits-web-1 Stopped 
 Container birka-rehearsal-limits-web-1 Removing 
 Container birka-rehearsal-limits-web-1 Removed 
 Container birka-rehearsal-limits-backup-watch-1 Stopped 
 Container birka-rehearsal-limits-backup-watch-1 Removing 
 Container birka-rehearsal-limits-backup-watch-1 Removed 
 Container birka-rehearsal-limits-api-1 Stopped 
 Container birka-rehearsal-limits-api-1 Removing 
 Container birka-rehearsal-limits-api-1 Removed 
 Container birka-rehearsal-limits-db-1 Stopping 
 Container birka-rehearsal-limits-db-1 Stopped 
 Container birka-rehearsal-limits-db-1 Removing 
 Container birka-rehearsal-limits-db-1 Removed 
 Volume birka-rehearsal-limits_caddy_config Removing 
 Network birka-rehearsal-limits_default Removing 
 Volume birka-rehearsal-limits_web_dist Removing 
 Volume birka-rehearsal-limits_caddy_data Removing 
 Volume birka-rehearsal-limits_db_data Removing 
 Network birka-rehearsal-limits_edge Removing 
 Volume birka-rehearsal-limits_caddy_config Removed 
 Volume birka-rehearsal-limits_caddy_data Removed 
 Volume birka-rehearsal-limits_web_dist Removed 
 Volume birka-rehearsal-limits_db_data Removed 
 Network birka-rehearsal-limits_edge Removed 
 Network birka-rehearsal-limits_default Removed
```

**Removed: birka-rehearsal-limits-new** — ran (exit 0, 1.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/limits-rehearsal/work-limits/new-server/srv-birka rev-parse --short HEAD)
docker compose --profile ops down -v --remove-orphans
```

```
 Container birka-rehearsal-limits-new-caddy-1 Stopped 
 Container birka-rehearsal-limits-new-caddy-1 Removing 
 Container birka-rehearsal-limits-new-caddy-1 Removed 
 Container birka-rehearsal-limits-new-web-1 Stopping 
 Container birka-rehearsal-limits-new-api-1 Stopping 
 Container birka-rehearsal-limits-new-web-1 Stopped 
 Container birka-rehearsal-limits-new-web-1 Removing 
 Container birka-rehearsal-limits-new-web-1 Removed 
 Container birka-rehearsal-limits-new-backup-watch-1 Stopped 
 Container birka-rehearsal-limits-new-backup-watch-1 Removing 
 Container birka-rehearsal-limits-new-backup-watch-1 Removed 
 Container birka-rehearsal-limits-new-api-1 Stopped 
 Container birka-rehearsal-limits-new-api-1 Removing 
 Container birka-rehearsal-limits-new-api-1 Removed 
 Container birka-rehearsal-limits-new-db-1 Stopping 
 Container birka-rehearsal-limits-new-db-1 Stopped 
 Container birka-rehearsal-limits-new-db-1 Removing 
 Container birka-rehearsal-limits-new-db-1 Removed 
 Volume birka-rehearsal-limits-new_caddy_data Removing 
 Volume birka-rehearsal-limits-new_web_dist Removing 
 Volume birka-rehearsal-limits-new_caddy_config Removing 
 Volume birka-rehearsal-limits-new_db_data Removing 
 Network birka-rehearsal-limits-new_default Removing 
 Network birka-rehearsal-limits-new_edge Removing 
 Volume birka-rehearsal-limits-new_caddy_data Removed 
 Volume birka-rehearsal-limits-new_web_dist Removed 
 Volume birka-rehearsal-limits-new_caddy_config Removed 
 Volume birka-rehearsal-limits-new_db_data Removed 
 Network birka-rehearsal-limits-new_default Removed 
 Network birka-rehearsal-limits-new_edge Removed
```

## Findings

None.
