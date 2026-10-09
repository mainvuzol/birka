# Rehearsal: a new version, and going back

From `6867576` (#74, schema 0037) to `fb567b8` (main, 0038), on one server whose checkout is a local clone; started 2026-10-09 20:04:00 EEST. The password is base64 as the runbook makes it; test secrets, the tests' fake bot token.

## Installed at 6867576 (server runbook, steps 3, 4 and 6)

**Build, database, migration, start** — held (exit 0, 9.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend
docker compose up -d --wait db
docker compose run --rm --no-deps api alembic upgrade head
docker compose up -d
```

```
 Container birka-rehearsal-update-backup-watch-1 Creating 
 Volume birka-rehearsal-update_caddy_data Creating 
 Volume birka-rehearsal-update_web_dist Creating 
 Volume birka-rehearsal-update_web_dist Creating 
 Volume birka-rehearsal-update_caddy_config Created 
 Volume birka-rehearsal-update_caddy_config Created 
 Volume birka-rehearsal-update_caddy_data Created 
 Volume birka-rehearsal-update_caddy_data Created 
 Volume birka-rehearsal-update_web_dist Created 
 Volume birka-rehearsal-update_web_dist Created 
 Container birka-rehearsal-update-web-1 Creating 
 Container birka-rehearsal-update-web-1 Created 
 Container birka-rehearsal-update-backup-watch-1 Created 
 Container birka-rehearsal-update-api-1 Created 
 Container birka-rehearsal-update-caddy-1 Creating 
 Container birka-rehearsal-update-caddy-1 Created 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Starting 
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
seed complete for organization e5690076-9418-4226-bbdc-06ac98f89910
 Container birka-rehearsal-update-api-run-0acadd495bb6 Creating 
 Container birka-rehearsal-update-api-run-0acadd495bb6 Created
```

Used through the app: a model received 10, three sales, two in parts (Марія paid off, Ірина owes 1000).

## 1. A new version: 6867576 → fb567b8

**The runbook's block** — held (exit 0, 6.4 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka checkout fb567b8
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose run --rm --no-deps api alembic upgrade head   # if this fails, stop here: see below
docker compose up -d
```

```
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-ops-run-c5a42f85b914 Creating 
 Container birka-rehearsal-update-ops-run-c5a42f85b914 Created 
Previous HEAD position was 6867576 feat(stock-import): the shops' existing stock from a parser's JSON file — several files to a warehouse's list, every line reviewed, a split the line shows confirmed by a tap (#74)
HEAD is now at fb567b8 docs(backups): restoring for real rehearsed end to end — its restore command fixed, and backups set up again on the new server (#76)
 Container birka-rehearsal-update-api-run-e559797c06c7 Creating 
 Container birka-rehearsal-update-api-run-e559797c06c7 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade 0037_stock_list_parts -> 0038_customer_erasure, A customer's name and phone are erased from a debt once it has been closed long enough, or on the owner's word. Owner decision, 2026-10-09; ADR-0015.
 Container birka-rehearsal-update-caddy-1 Running 
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-backup-watch-1 Recreate 
 Container birka-rehearsal-update-api-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreated 
 Container birka-rehearsal-update-api-1 Recreated 
 Container birka-rehearsal-update-web-1 Starting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Started 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-api-1 Starting 
 Container birka-rehearsal-update-backup-watch-1 Starting 
 Container birka-rehearsal-update-api-1 Started 
 Container birka-rehearsal-update-web-1 Waiting 
 Container birka-rehearsal-update-backup-watch-1 Started 
 Container birka-rehearsal-update-web-1 Exited
```

**The readiness check, as the runbook had it** — ran (exit 56, 0.0 s)

```sh
curl -kfsS https://localhost:58743/api/v1/ready
```

```
curl: (56) The requested URL returned error: 502
```

> **Finding:** the readiness check straight after `up -d` gets 502 from Caddy while the API starts (also in the first run, kept as first-run.md): an administrator reads a failed update. Fixed: curl retries until the API answers


**The readiness check, as the runbook now says** — held (exit 0, 2.1 s)

```sh
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58743/api/v1/ready
```

```
{"status":"ready"}curl: (56) The requested URL returned error: 502
```

The backup before the update: `birka-20261009T170415Z`.

**The schema's revision** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT version_num FROM alembic_version;
SQL
```

```
0038_customer_erasure
```

**The running version** — held (exit 0, 0.1 s)

```sh
docker compose exec -T api printenv BIRKA_RELEASE
```

```
fb567b8
```

Schema `0038_customer_erasure`, the API runs `fb567b8`; stock and sales {'on_hand': 7, 'sales': 3} (before: {'on_hand': 7, 'sales': 3}).

## 2. Going back, 2: code and schema, by a migration's downgrade (nobody erased yet)

**The downgrade, with the new code that knows it** — held (exit 0, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api alembic downgrade 0037_stock_list_parts
```

```
Container birka-rehearsal-update-api-run-add524d00f7d Creating 
 Container birka-rehearsal-update-api-run-add524d00f7d Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running downgrade 0038_customer_erasure -> 0037_stock_list_parts, A customer's name and phone are erased from a debt once it has been closed long enough, or on the owner's word. Owner decision, 2026-10-09; ADR-0015.
```

**Then the old code** — held (exit 0, 2.6 s)

```sh
git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka checkout 6867576
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend   # stands in for the build
docker compose up -d
```

```
birka-rehearsal-update-api:6867576
birka-rehearsal-update-ops:6867576
Previous HEAD position was fb567b8 docs(backups): restoring for real rehearsed end to end — its restore command fixed, and backups set up again on the new server (#76)
HEAD is now at 6867576 feat(stock-import): the shops' existing stock from a parser's JSON file — several files to a warehouse's list, every line reviewed, a split the line shows confirmed by a tap (#74)
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-caddy-1 Running 
 Container birka-rehearsal-update-api-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreated 
 Container birka-rehearsal-update-api-1 Recreated 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Starting 
 Container birka-rehearsal-update-web-1 Started 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-api-1 Starting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-backup-watch-1 Starting 
 Container birka-rehearsal-update-api-1 Started 
 Container birka-rehearsal-update-web-1 Waiting 
 Container birka-rehearsal-update-backup-watch-1 Started 
 Container birka-rehearsal-update-web-1 Exited
```

**The schema's revision** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT version_num FROM alembic_version;
SQL
```

```
0037_stock_list_parts
```

Schema `0037_stock_list_parts`; stock and sales {'on_hand': 7, 'sales': 3}; Марія reads `Марія Сплатила`.

**Updated again: the runbook's block** — held (exit 0, 6.1 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka checkout fb567b8
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose run --rm --no-deps api alembic upgrade head   # if this fails, stop here: see below
docker compose up -d
```

```
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-ops-run-1801399ef6a0 Creating 
 Container birka-rehearsal-update-ops-run-1801399ef6a0 Created 
Previous HEAD position was 6867576 feat(stock-import): the shops' existing stock from a parser's JSON file — several files to a warehouse's list, every line reviewed, a split the line shows confirmed by a tap (#74)
HEAD is now at fb567b8 docs(backups): restoring for real rehearsed end to end — its restore command fixed, and backups set up again on the new server (#76)
 Container birka-rehearsal-update-api-run-e79d36ebe8cd Creating 
 Container birka-rehearsal-update-api-run-e79d36ebe8cd Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade 0037_stock_list_parts -> 0038_customer_erasure, A customer's name and phone are erased from a debt once it has been closed long enough, or on the owner's word. Owner decision, 2026-10-09; ADR-0015.
 Container birka-rehearsal-update-caddy-1 Running 
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-api-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreated 
 Container birka-rehearsal-update-api-1 Recreated 
 Container birka-rehearsal-update-web-1 Starting 
 Container birka-rehearsal-update-db-1 Waiting 
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
```

**The readiness check, as the runbook now says** — held (exit 0, 2.1 s)

```sh
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58743/api/v1/ready
```

```
{"status":"ready"}curl: (56) The requested URL returned error: 502
```

## 3. Going back, 1: the code alone, once a customer is erased

On fb567b8, the owner erases Марія on request: erased 1.

**The old code** — held (exit 0, 2.5 s)

```sh
git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka checkout 6867576
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend   # stands in for the build
docker compose up -d
```

```
birka-rehearsal-update-api:6867576
birka-rehearsal-update-ops:6867576
Previous HEAD position was fb567b8 docs(backups): restoring for real rehearsed end to end — its restore command fixed, and backups set up again on the new server (#76)
HEAD is now at 6867576 feat(stock-import): the shops' existing stock from a parser's JSON file — several files to a warehouse's list, every line reviewed, a split the line shows confirmed by a tap (#74)
 Container birka-rehearsal-update-caddy-1 Running 
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-api-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreated 
 Container birka-rehearsal-update-api-1 Recreated 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Starting 
 Container birka-rehearsal-update-web-1 Started 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-api-1 Starting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-backup-watch-1 Starting 
 Container birka-rehearsal-update-api-1 Started 
 Container birka-rehearsal-update-web-1 Waiting 
 Container birka-rehearsal-update-backup-watch-1 Started 
 Container birka-rehearsal-update-web-1 Exited
```

With the old code on the new schema:

- «Борги», who owes (status=OPEN): 200
- «Борги», everyone: 500
- the debts' list: 500
- Марія's debt: 500
- Ірина's debt: 200
- a sale: 201

> **Finding:** going back by the code alone across `0038` breaks «Борги» once a customer is erased: the old code cannot read a debt with no name («Борги», everyone, the debts' list, Марія's debt answer 500); the runbook did not say so


**Fixed forward: the runbook's block** — held (exit 0, 6.2 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka fetch && git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka checkout fb567b8
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend   # stands in for: docker compose build && docker compose --profile ops build ops
docker compose run --rm --no-deps api alembic upgrade head   # if this fails, stop here: see below
docker compose up -d
```

```
birka-rehearsal-update-ops:fb567b8
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-ops-run-a2415cb19299 Creating 
 Container birka-rehearsal-update-ops-run-a2415cb19299 Created 
Previous HEAD position was 6867576 feat(stock-import): the shops' existing stock from a parser's JSON file — several files to a warehouse's list, every line reviewed, a split the line shows confirmed by a tap (#74)
HEAD is now at fb567b8 docs(backups): restoring for real rehearsed end to end — its restore command fixed, and backups set up again on the new server (#76)
 Container birka-rehearsal-update-api-run-e2ff10a1dad5 Creating 
 Container birka-rehearsal-update-api-run-e2ff10a1dad5 Created 
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
 Container birka-rehearsal-update-caddy-1 Running 
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-api-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreate 
 Container birka-rehearsal-update-backup-watch-1 Recreated 
 Container birka-rehearsal-update-api-1 Recreated 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-web-1 Starting 
 Container birka-rehearsal-update-web-1 Started 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-backup-watch-1 Starting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-api-1 Starting 
 Container birka-rehearsal-update-backup-watch-1 Started 
 Container birka-rehearsal-update-api-1 Started 
 Container birka-rehearsal-update-web-1 Waiting 
 Container birka-rehearsal-update-web-1 Exited
```

**The readiness check, as the runbook now says** — held (exit 0, 2.1 s)

```sh
curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:58743/api/v1/ready
```

```
{"status":"ready"}curl: (56) The requested URL returned error: 502
```

Forward again, «Борги», everyone: 200.

## 4. Going back, 2, once a customer is erased

**The downgrade** — ran (exit 1, 0.8 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose run --rm --no-deps api alembic downgrade 0037_stock_list_parts
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

**The schema's revision** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT version_num FROM alembic_version;
SQL
```

```
0038_customer_erasure
```

Refused: yes; the schema stays `0038_customer_erasure`.

## 5. Going back, 3: everything, from `birka-20261009T170415Z`, on the same server

The owner's computer collected (exit 0).

Decrypted with the owner's key; SHA-256 equals the drilled archive's.

**The proposed sequence** — held (exit 0, 11.7 s)

```sh
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
docker compose --profile ops run --rm ops       # the state being left, kept too
git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka checkout 6867576                 # the code the backup was taken with
export BIRKA_RELEASE=$(git -C /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka rev-parse --short HEAD)
sh /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/make-images.sh "$BIRKA_RELEASE" /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/srv-birka/backend   # stands in for the build
docker compose stop api backup-watch           # nothing writes while the database goes back
docker compose rm -sf db && docker volume rm birka-rehearsal-update_db_data   # on the server: birka_db_data
docker compose up -d --wait db
docker compose exec -T db sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --exit-on-error --single-transaction --no-owner --no-privileges' < /Users/nikitahlushak/.cache/birka-runtime/update-rehearsal/work/backups/birka.dump   # on the server: backups/birka.dump
docker compose up -d
```

```
 Container birka-rehearsal-update-db-1 Removing 
 Container birka-rehearsal-update-db-1 Removed 
 Volume birka-rehearsal-update_db_data Creating 
 Volume birka-rehearsal-update_db_data Creating 
 Volume birka-rehearsal-update_db_data Created 
 Volume birka-rehearsal-update_db_data Created 
 Container birka-rehearsal-update-db-1 Creating 
 Container birka-rehearsal-update-db-1 Created 
 Container birka-rehearsal-update-db-1 Starting 
 Container birka-rehearsal-update-db-1 Started 
 Container birka-rehearsal-update-db-1 Waiting 
 Container birka-rehearsal-update-db-1 Healthy 
 Container birka-rehearsal-update-db-1 Running 
 Container birka-rehearsal-update-caddy-1 Running 
 Container birka-rehearsal-update-backup-watch-1 Recreate 
 Container birka-rehearsal-update-api-1 Recreate 
 Container birka-rehearsal-update-api-1 Recreated 
 Container birka-rehearsal-update-backup-watch-1 Recreated 
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
```

**The schema's revision** — held (exit 0, 0.1 s)

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At' <<'SQL'
SELECT version_num FROM alembic_version;
SQL
```

```
0037_stock_list_parts
```

Schema `0037_stock_list_parts`; stock and sales {'on_hand': 7, 'sales': 3} (the state before the update: {'on_hand': 7, 'sales': 3}); Марія reads `Марія Сплатила`.

**Removed** — ran (exit 0, 1.1 s)

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
 Container birka-rehearsal-update-api-1 Stopping 
 Container birka-rehearsal-update-web-1 Stopping 
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
 Volume birka-rehearsal-update_web_dist Removing 
 Volume birka-rehearsal-update_caddy_data Removing 
 Volume birka-rehearsal-update_caddy_config Removing 
 Network birka-rehearsal-update_default Removing 
 Volume birka-rehearsal-update_db_data Removing 
 Volume birka-rehearsal-update_web_dist Removed 
 Volume birka-rehearsal-update_caddy_config Removed 
 Volume birka-rehearsal-update_caddy_data Removed 
 Volume birka-rehearsal-update_db_data Removed 
 Network birka-rehearsal-update_default Removed
```

## Findings

- the readiness check straight after `up -d` gets 502 from Caddy while the API starts (also in the first run, kept as first-run.md): an administrator reads a failed update. Fixed: curl retries until the API answers
- going back by the code alone across `0038` breaks «Борги» once a customer is erased: the old code cannot read a debt with no name («Борги», everyone, the debts' list, Марія's debt answer 500); the runbook did not say so
