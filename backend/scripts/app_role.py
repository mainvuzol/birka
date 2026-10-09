r"""The app's own database role — run on the server by the technical administrator.

The API and `backup-watch` connect as `birka_app`, which reads and writes
rows and nothing more (ADR-0016): it may not truncate a table, create
anything, not even a temporary table, or alter, drop or disable a table or
a trigger, so the triggers that keep the ledger hold against the API
itself. This gives it that, as the database's owner:

    python -m scripts.app_role

- `birka_app` is created if it is missing; its password is set from
  `BIRKA_APP_DB_PASSWORD`, and anything it set on itself is reset;
- it may connect, and read and write every table, now and every table the
  owner creates later; `alembic_version` it may only read;
- anything more it holds is taken back, and what it holds is checked.

Run it after every migration, and after a restore: backups keep no rights.
Running it again changes nothing. On the server:
`docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role`.
Exit 0 when done, 2 when refused, changing nothing: no password or a weak
one, not run as the owner, the database not migrated yet, or a right given
to it by another role, which the owner cannot take back.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import secrets
import sys
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.core.db import create_engine

APP_ROLE = "birka_app"
# `openssl rand -base64 32` gives 44 characters.
MIN_PASSWORD_LENGTH = 32
# What `.env.example` and the CI files start a placeholder with.
PLACEHOLDER = "change-me"
# PostgreSQL's own default for a password it hashes itself.
SCRAM_ITERATIONS = 4096
ATTRIBUTES = (
    "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT"
    " CONNECTION LIMIT -1 VALID UNTIL 'infinity'"
)
ROW_RIGHTS = ("SELECT", "INSERT", "UPDATE", "DELETE")
# What a table's owner may give beyond rows; MAINTAIN since PostgreSQL 17.
MORE_RIGHTS = ("TRUNCATE", "REFERENCES", "TRIGGER")


class RefusedError(Exception):
    pass


def scram_verifier(
    password: str, *, salt: bytes | None = None, iterations: int = SCRAM_ITERATIONS
) -> str:
    """The SCRAM-SHA-256 verifier PostgreSQL stores for `password`
    (RFC 5802, RFC 7677). Sent instead of the password, so the password
    itself is never in a statement the database could log. The password is
    taken as written: SASLprep changes nothing in an ASCII one, and a random
    one is ASCII."""
    salt = secrets.token_bytes(16) if salt is None else salt
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()

    def b64(raw: bytes) -> str:
        return base64.b64encode(raw).decode()

    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


async def _is_superuser(connection: AsyncConnection) -> bool:
    return bool(
        await connection.scalar(text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user"))
    )


async def _on_the_database(connection: AsyncConnection, statement: str) -> None:
    """`statement`, with `{database}` the current database's name, quoted."""
    await connection.exec_driver_sql(
        "DO $grant$ BEGIN EXECUTE format("
        + "'"
        + statement.replace("'", "''").format(database="%I")
        + "', current_database()); END $grant$"
    )


async def give_rights(connection: AsyncConnection, password: str) -> list[str]:
    """Everything §3 of ADR-0016 says, in the caller's transaction; what was
    done, in words. Refused before anything changes."""
    if len(password) < MIN_PASSWORD_LENGTH or password.startswith(PLACEHOLDER):
        raise RefusedError(
            f"BIRKA_APP_DB_PASSWORD must be long and random, at least {MIN_PASSWORD_LENGTH} "
            "characters (server runbook, step 2: openssl rand -base64 32)"
        )
    if await connection.scalar(text("SELECT current_user")) == APP_ROLE:
        raise RefusedError(
            f"run it as the database's owner, from the ops container, not as {APP_ROLE}"
        )
    if not await _is_superuser(connection):
        raise RefusedError("run it as the database's owner (POSTGRES_USER), from the ops container")
    if not await connection.scalar(
        text("SELECT to_regclass('public.alembic_version') IS NOT NULL")
    ):
        raise RefusedError("the database is not migrated yet: run `alembic upgrade head` first")

    done: list[str] = []
    exists = await connection.scalar(
        text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": APP_ROLE}
    )
    verb = "ALTER" if exists else "CREATE"
    # The verifier holds `$` and `:`, which `text()` would read as bind
    # parameters: it goes to the driver as written. No quote can be in it.
    await connection.exec_driver_sql(
        f"{verb} ROLE {APP_ROLE} {ATTRIBUTES} PASSWORD '{scram_verifier(password)}'"
    )
    done.append(f"{APP_ROLE}: {'password set' if exists else 'created'}")

    # A role may set its own defaults, everywhere or in one database:
    # whatever it set (a read-only default, another search path) is reset.
    settings = await connection.scalar(
        text(
            "SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole"
            " WHERE r.rolname = :role"
        ),
        {"role": APP_ROLE},
    )
    await connection.exec_driver_sql(  # APP_ROLE is this module's constant
        "DO $reset$ DECLARE d record; BEGIN"  # noqa: S608
        f" EXECUTE 'ALTER ROLE {APP_ROLE} RESET ALL';"
        " FOR d IN SELECT db.datname FROM pg_db_role_setting s"
        " JOIN pg_database db ON db.oid = s.setdatabase"
        f" JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = '{APP_ROLE}' LOOP"
        f" EXECUTE format('ALTER ROLE {APP_ROLE} IN DATABASE %I RESET ALL', d.datname);"
        " END LOOP; END $reset$"
    )
    if settings:
        done.append(f"its own settings reset ({settings})")

    # Every role it is a member of, by whoever made it one.
    memberships = (
        await connection.execute(
            text(
                "SELECT quote_ident(granted.rolname), quote_ident(grantor.rolname)"
                " FROM pg_auth_members m"
                " JOIN pg_roles granted ON granted.oid = m.roleid"
                " JOIN pg_roles member ON member.oid = m.member"
                " JOIN pg_roles grantor ON grantor.oid = m.grantor"
                " WHERE member.rolname = :role ORDER BY 1"
            ),
            {"role": APP_ROLE},
        )
    ).all()
    for granted, grantor in memberships:
        await connection.exec_driver_sql(f"REVOKE {granted} FROM {APP_ROLE} GRANTED BY {grantor}")
        done.append(f"no longer a member of {granted}")

    # The database: to connect, nothing more. Nobody but the owner creates
    # here, a temporary table least of all: one named like a table a
    # trigger reads, which names its tables without a schema, would be read
    # in its place. PostgreSQL gives everyone TEMPORARY unless told not to.
    await _on_the_database(connection, "REVOKE ALL ON DATABASE {database} FROM " + APP_ROLE)
    await _on_the_database(
        connection, "REVOKE CREATE, TEMPORARY ON DATABASE {database} FROM PUBLIC"
    )
    await _on_the_database(connection, "GRANT CONNECT ON DATABASE {database} TO " + APP_ROLE)
    # The schema: to use it, never to create in it. PostgreSQL 15 and later
    # already deny PUBLIC that; a restored or older database may not.
    await connection.exec_driver_sql(f"REVOKE ALL ON SCHEMA public FROM {APP_ROLE}")
    await connection.exec_driver_sql("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
    await connection.exec_driver_sql(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}")
    # The tables: everything back first, from it and from everyone, then
    # rows. PUBLIC holds nothing on them by default; a table's owner keeps
    # its own rights whatever PUBLIC is refused.
    rows = ", ".join(ROW_RIGHTS)
    for grantee in (APP_ROLE, "PUBLIC"):
        await connection.exec_driver_sql(
            f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {grantee}"
        )
        await connection.exec_driver_sql(
            f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {grantee}"
        )
    await connection.exec_driver_sql(f"GRANT {rows} ON ALL TABLES IN SCHEMA public TO {APP_ROLE}")
    await connection.exec_driver_sql(
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}"
    )
    await connection.exec_driver_sql(
        f"REVOKE INSERT, UPDATE, DELETE ON public.alembic_version FROM {APP_ROLE}"
    )
    # Tables the owner creates later, in a later migration, get the same.
    await connection.exec_driver_sql(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT {rows} ON TABLES TO {APP_ROLE}"
    )
    await connection.exec_driver_sql(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE}"
    )

    tables = await _checked(connection)
    done.append(f"{tables} tables: read and write")
    done.append("alembic_version: read only")
    done.append("the database: connect only, no temporary tables")
    return done


async def _checked(connection: AsyncConnection) -> int:
    """What it holds now, each right on its own (given several,
    `has_table_privilege` is true when any one is held): every row right on
    every table but `alembic_version`, which it only reads, and nothing
    more anywhere. How many tables it reads and writes."""
    more = list(MORE_RIGHTS)
    if await connection.scalar(text("SELECT current_setting('server_version_num')::int >= 170000")):
        more.append("MAINTAIN")
    held = (
        await connection.execute(
            text(
                "SELECT tablename, r, has_table_privilege(:role, format('public.%I', tablename), r)"
                " FROM pg_tables, unnest(CAST(:rights AS text[])) AS r"
                " WHERE schemaname = 'public'"
            ),
            {"role": APP_ROLE, "rights": [*ROW_RIGHTS, *more]},
        )
    ).tuples()
    wrong = sorted(
        f"{table} {right}"
        for table, right, has in held
        if has != (right in (("SELECT",) if table == "alembic_version" else ROW_RIGHTS))
    )
    database = (
        await connection.execute(
            text(
                "SELECT has_database_privilege(:role, current_database(), 'CREATE'),"
                " has_database_privilege(:role, current_database(), 'TEMPORARY'),"
                " has_schema_privilege(:role, 'public', 'CREATE'),"
                " (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member"
                "  WHERE r.rolname = :role)"
            ),
            {"role": APP_ROLE},
        )
    ).one()
    if any(database):
        wrong.append("the database: create, temporary, create in public, or a role's member")
    if wrong:
        # Taken back above as the owner, a right someone else gave remains.
        raise RefusedError(
            f"{APP_ROLE} does not hold exactly its rights ({', '.join(wrong)}): another role"
            " gave it more; take that back as that role, then run this again"
        )
    tables = await connection.scalar(
        text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
    )
    return int(tables) - 1


async def run() -> list[str]:
    settings = get_settings()
    password = settings.app_db_password.get_secret_value()
    if not password:
        raise RefusedError("BIRKA_APP_DB_PASSWORD is not set (server runbook, step 2)")
    engine = create_engine(settings)
    try:
        async with engine.begin() as connection:
            return await give_rights(connection, password)
    finally:
        await engine.dispose()


def parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        prog="python -m scripts.app_role",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )


def main(argv: Sequence[str] | None = None) -> None:
    parser().parse_args(argv)
    try:
        print("\n".join(asyncio.run(run())))
    except RefusedError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
