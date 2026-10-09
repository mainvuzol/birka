# ADR-0016: The app's own database role

Status: Accepted (2026-10-09). Built on `feat/app-db-role`; see the
[report](../project-memory/app-db-role-report.md).
Owner decision: chosen as the next work on 2026-10-09, after PR #78, from
the risks left before the public domain.
Closes: the risk register's "the API connects to PostgreSQL as the owner of
every table" (ADR-0010, "before the public domain").
Builds on: ADR-0002 (the ledger is append-only, guarded by triggers),
ADR-0011 (the watcher), ADR-0015 (erasing a customer).

## Context

The API, the watcher and the `ops` container all connected as
`POSTGRES_USER`. In the official PostgreSQL image that user is a
**superuser**, not merely the tables' owner, as the risk register said.
Whoever took over the API's process, which faces the internet, could then:
- disable or drop the triggers that keep the ledger, the audit log and an
  erased customer as they are, and rewrite history;
- `TRUNCATE` an append-only table, which no trigger guards;
- read the server's files, or run programs in the database's container
  (`COPY … TO PROGRAM`).

The app itself only reads and writes rows. Nothing at runtime creates,
alters or drops anything, truncates, makes a temporary table, or calls a
function only a superuser may (checked on 2026-10-09: advisory locks,
`pg_trgm` and the statement timeout need nothing more). Migrations, the
nightly backup and its drill, and a restore do need more.

## Decision

### 1. One role, `birka_app`, for what faces the shops

- `api` and `backup-watch` connect as `birka_app`. Its password is
  `BIRKA_APP_DB_PASSWORD` in `.env`, long and random like
  `POSTGRES_PASSWORD`; compose refuses to start without it.
- It is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  NOINHERIT`, member of no role, and owns no table.
- In the app's database it may connect, use the schema `public`, and
  `SELECT, INSERT, UPDATE, DELETE` every table. `alembic_version` it may
  only read: `/api/v1/ready` compares it with the code.
- It may not `TRUNCATE`, create anything there, not even a temporary table,
  or alter, drop or disable a table or a trigger: PostgreSQL leaves those to
  the owner. The triggers then hold against the API itself.
- **No temporary tables**, because the trigger functions name the tables
  they read without a schema, and a session finds its own temporary table
  first: a temporary `cash_close` or `customer_credit` would be read in the
  real one's place, and a guard fooled (review, 2026-10-09). PostgreSQL
  lets everyone make temporary tables unless told not to; the command
  tells it, for everyone but the owner.

### 2. The owner stays for what changes the schema or copies the database

`POSTGRES_USER` stays the superuser of the database's container and is used
only by:
- the migrations, now run from the `ops` container: `docker compose
  --profile ops run --rm --no-deps ops alembic upgrade head` (and `check`,
  `downgrade`), no longer from `api`, which may not;
- the nightly backup and its drill (`ops`), which creates and drops a
  scratch database;
- a restore, through the database's own container.

`ops` is not long-running and nothing reaches it from outside: cron starts
it, or an administrator.

### 3. The rights are given by a command, after every migration and restore

`python -m scripts.app_role`, from `ops`, as the owner, in one transaction:
1. refuses, changing nothing, without a password of at least 32 characters
   (a placeholder starting `change-me` is refused too), when not run by a
   superuser or run as `birka_app`, or before the first migration;
2. creates `birka_app` if it is missing, and sets its password from
   `BIRKA_APP_DB_PASSWORD`, sent as a SCRAM-SHA-256 verifier made by the
   command, so the password itself is never in a statement the database
   could log. Its attributes, expiry and connection limit are set again,
   and any default it set on itself is reset: a role may set its own (a
   compromised API could make every later connection read-only);
3. takes back everything on the database, the schema and every table, from
   it and on the tables from PUBLIC too, and every role it is a member of,
   by whoever gave it; then grants §1, on every table that exists and every
   table the owner creates later (default privileges);
4. checks what it holds, right by right. A right another role gave stays
   when the owner takes back its own; then the command refuses, names it,
   and changes nothing.

It changes nothing when run again, and prints what it did. It runs:
- at the first install, after the migration;
- after every update's migration (default privileges would cover new
  tables, but running it costs a second and resets what the role may have
  set on itself);
- after a restore: backups are taken with `--no-owner --no-privileges`
  (backup runbook), so a restored database holds no rights at all, and on
  an empty volume the role does not exist.

Not a migration: a role belongs to the whole PostgreSQL cluster, not to one
database, its password is a secret, and a restore would lose a migration's
grants without running it again. Not alembic's `env.py`: `alembic current`
and `check` would then change rights too.

### 4. What the API says when the role cannot work

`/api/v1/ready` still answers `database` (the watcher's «база даних не
відповідає»): no new message to the owner. Its log line names the cause:
- `InvalidPasswordError`: the role is missing, as after a restore onto an
  empty volume, or its password is not the one in `.env`;
- `InsufficientPrivilegeError`: the role has no rights, as after a restore
  onto its own cluster.

The runbook's table of messages says to run the command for both.

### 5. Local development and tests keep one user

`docker-compose.dev.yml`, the test suite and the hot-path measurement
connect as the owner, as before. CI's end-to-end job and edge job run the
API as `birka_app`, so every journey proves the rights are enough, and the
edge job checks that the API's user is `birka_app` and not a superuser.

## Consequences

- `.env` gains `BIRKA_APP_DB_PASSWORD`. A server installed before this
  version (none is) adds it before updating; the update's own run of the
  command creates the role.
- The runbook's migration commands move from `api` to `ops`. From `api`, a
  migration that changes the schema is refused, and changes nothing.
- Going back by the code alone to a release before this one works: its
  compose connects as the owner, and the role stays, unused.
- A compromised API can still read and write every row the app can,
  including the customers' names and phones, and write what the app
  writes. It can still change its own password and defaults, which the
  next run of the command puts back; connect to the cluster's other
  databases (`postgres`, the drill's scratch copy), where it holds no
  table; and make large objects, which PostgreSQL lets any role make. What
  it can no longer do is rewrite what the triggers keep, truncate a table,
  or reach past the database.
- `ops` and the `db` container hold the superuser's password, as before.

## Rejected

- **One role per module, or column grants.** Every module reads others'
  tables through their services in one process, so a role per module
  guards nothing a compromised process cannot reach.
- **Revoking `UPDATE` and `DELETE` on the append-only tables.** The
  triggers already refuse them, and hold now that the API owns nothing; a
  second list of tables to keep in step with the schema is a place to go
  wrong.
- **A fixed `search_path` on every trigger function**, a migration over
  every guard. With no temporary table and nothing it may create, there is
  nothing for the role to put ahead of the real tables; the command takes
  back any such right each time it runs.
- **Making the table owner a role other than the superuser.** It would
  narrow `ops` too, but the drill creates databases and the restore runs as
  the container's user; a change of its own, if wanted.
