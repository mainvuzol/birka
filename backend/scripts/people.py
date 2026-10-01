r"""Who works in which store — run on the server by the technical administrator.

The owner decided on 2026-10-01 that people are added here, by the number of
their Telegram account, and only on an owner's word (business-rules.md,
"people"). Every change names that owner with --approved-by.

    python -m scripts.people list
    python -m scripts.people grant --approved-by OWNER --telegram-user-id ID \
        --store MAIN --role SELLER
    python -m scripts.people grant --approved-by OWNER --telegram-user-id ID \
        --all-stores --role MANAGER
    python -m scripts.people remove --approved-by OWNER --telegram-user-id ID --store MAIN
    python -m scripts.people deactivate --approved-by OWNER --telegram-user-id ID

OWNER and ID are Telegram account numbers.

A person with no access sees their Telegram number in the app, to pass on.
On the server: `docker compose run --rm --no-deps api python -m scripts.people …`.
Exit 0 when it is done or was already so, 2 when it is refused.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from typing import TYPE_CHECKING

import structlog
from sqlalchemy.ext.asyncio import async_sessionmaker

import app.models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.core.config import get_settings
from app.core.db import create_engine
from app.core.errors import DomainError

if TYPE_CHECKING:
    from app.modules.identity.people import Person


def _where(store: str | None) -> str:
    return "every store" if store is None else store


async def run(args: argparse.Namespace) -> str:
    # Imported here, once `main` has sent its log lines to stderr: a module's
    # logger is bound to the configuration of the moment it is imported.
    from app.modules.identity import people

    engine = create_engine(get_settings())
    try:
        async with async_sessionmaker(engine, expire_on_commit=False).begin() as session:
            if args.command == "list":
                return _listing(await people.people(session))
            store = None if getattr(args, "all_stores", False) else getattr(args, "store", None)
            if args.command == "grant":
                changed = await people.grant(
                    session,
                    approved_by=args.approved_by,
                    telegram_user_id=args.telegram_user_id,
                    store_code=store,
                    role_code=args.role,
                    name=args.name,
                )
                done = "granted" if changed else "already so"
                return f"{done}: {args.telegram_user_id} is {args.role} in {_where(store)}"
            if args.command == "remove":
                changed = await people.remove(
                    session,
                    approved_by=args.approved_by,
                    telegram_user_id=args.telegram_user_id,
                    store_code=store,
                )
                done = "removed" if changed else "already removed"
                return f"{done}: {args.telegram_user_id} from {_where(store)}"
            ended = await people.deactivate(
                session, approved_by=args.approved_by, telegram_user_id=args.telegram_user_id
            )
            return f"deactivated: {args.telegram_user_id}, {ended} role(s) ended"
    finally:
        await engine.dispose()


def _listing(found: Sequence[Person]) -> str:
    if not found:
        return "nobody works here yet"
    lines: list[str] = []
    for person in found:
        username = f" @{person.username}" if person.username else ""
        lines.append(
            f"{person.telegram_user_id}  {person.display_name}{username}  [{person.organization}]"
        )
        for access in person.access:
            state = "" if access.active else "  (removed)"
            lines.append(f"    {access.role:<8} {_where(access.store_code)}{state}")
    return "\n".join(lines)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="python -m scripts.people",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="everyone, and where they work")

    def change(name: str, help_text: str, *, where: bool) -> argparse.ArgumentParser:
        command = commands.add_parser(name, help=help_text)
        command.add_argument(
            "--approved-by",
            type=int,
            required=True,
            metavar="TELEGRAM_ID",
            help="the owner on whose word this is done",
        )
        command.add_argument("--telegram-user-id", type=int, required=True)
        if where:
            place = command.add_mutually_exclusive_group(required=True)
            place.add_argument("--store", metavar="CODE", help="one store, e.g. MAIN")
            place.add_argument("--all-stores", action="store_true", help="every store")
        return command

    grant = change("grant", "give a role in one store, or in every store", where=True)
    grant.add_argument(
        "--role",
        type=str.upper,
        required=True,
        help="SELLER, MANAGER, OWNER, or a role the organization composed",
    )
    grant.add_argument("--name", help="what to call them until they first open the app")
    change(
        "remove",
        "take a person out of one store, or out of a role they hold in every store",
        where=True,
    )
    change("deactivate", "turn a person off in every store at once", where=False)
    return root


def main(argv: Sequence[str] | None = None) -> None:
    args = parser().parse_args(argv)
    # The answer goes to stdout; the service's own log lines, to stderr.
    structlog.configure(logger_factory=structlog.PrintLoggerFactory(sys.stderr))
    try:
        print(asyncio.run(run(args)))
    except DomainError as exc:
        print(f"refused: {exc.message}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
