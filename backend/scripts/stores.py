r"""The stores' names — run on the server by the technical administrator.

The owner decided on 2026-10-01 that the stores carry their real names. The
seed gives them (`--main-name`, `--second-name`); this changes one later, on
an owner's word, as `scripts.people` changes people.

    python -m scripts.stores list
    python -m scripts.stores rename --approved-by OWNER --store MAIN --name "Лана, Хрещатик"

OWNER is the owner's Telegram account number.
On the server: `docker compose run --rm --no-deps api python -m scripts.stores …`.
Exit 0 when it is done or was already so, 2 when it is refused.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import app.models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.core.config import get_settings
from app.core.db import create_engine
from app.core.errors import DomainError
from app.modules.tenancy.models import Organization, Store, StoreState


def _state(state: str) -> str:
    """Nothing for a store that trades; «(blocked)» or «(archived)» else."""
    return "" if state == StoreState.ACTIVE else f"  ({state.lower()})"


async def run(args: argparse.Namespace) -> str:
    # Imported here, once `main` has sent its log lines to stderr: a module's
    # logger is bound to the configuration of the moment it is imported.
    from app.modules.identity.stores import rename_store

    engine = create_engine(get_settings())
    try:
        async with async_sessionmaker(engine, expire_on_commit=False).begin() as session:
            if args.command == "list":
                rows = (
                    await session.execute(
                        select(Organization.name, Store.code, Store.name, Store.state)
                        .join(Store, Store.organization_id == Organization.id)
                        .order_by(Organization.name, Store.code)
                    )
                ).all()
                if not rows:
                    return "no stores yet"
                return "\n".join(
                    f"{code:<8} {name}{_state(state)}  [{organization}]"
                    for organization, code, name, state in rows
                )
            changed = await rename_store(
                session, approved_by=args.approved_by, store_code=args.store, name=args.name
            )
            return (
                f"{'renamed' if changed else 'already so'}: {args.store} is «{args.name.strip()}»"
            )
    finally:
        await engine.dispose()


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="python -m scripts.stores",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="every store, its code and name")
    rename = commands.add_parser("rename", help="give a store its name")
    rename.add_argument(
        "--approved-by",
        type=int,
        required=True,
        metavar="TELEGRAM_ID",
        help="the owner on whose word this is done",
    )
    rename.add_argument("--store", metavar="CODE", required=True, help="e.g. MAIN")
    rename.add_argument("--name", required=True)
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
