"""What the bot tells the network's owners of a finished stocktake (owner
decision, 2026-10-10; ADR-0022).

The owner chose one record and a silent message of its sum, as a drawer's
difference (business-rules.md, "a stocktake of a whole warehouse"). The
message is written in the same transaction that finishes the stocktake
(`service.finish`), one per owner with a chat but never to whoever finished
it, and sent by the watcher through `telegram.outbox`, as the drawer's are.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.service import telegram_chats
from app.modules.stocktake.models import StocktakeMessage
from app.modules.telegram import outbox
from app.modules.telegram.outbox import Send

if TYPE_CHECKING:
    from app.modules.stocktake.service import Sums


def message_text(
    *,
    location_name: str,
    store_name: str,
    timezone: str,
    sums: Sums,
    started_by: str,
    started_at: datetime,
    finished_by: str,
    finished_at: datetime,
) -> str:
    """The message, plain and impersonal like the app's texts, with the
    times in the store's own zone. Nothing in it is a customer's: the names
    are staff."""
    zone = ZoneInfo(timezone)
    lines = [
        f"Інвентаризація: склад «{location_name}», магазин «{store_name}».",
        f"Пораховано позицій: {sums.counted_positions}."
        + (
            f" Не перевірено: {sums.unchecked_positions} — їхні залишки не змінювались."
            if sums.unchecked_positions
            else " Не перевірено: 0."
        ),
    ]
    if sums.shortage_units:
        lines.append(f"Нестача: {sums.shortage_units} од. (позицій: {sums.shortage_positions}).")
    if sums.surplus_units:
        lines.append(f"Надлишок: {sums.surplus_units} од. (позицій: {sums.surplus_positions}).")
    if not sums.shortage_units and not sums.surplus_units:
        lines.append("Розбіжностей з обліком немає.")
    lines.append(
        f"Початок: {started_by}, {started_at.astimezone(zone):%d.%m %H:%M}. "
        f"Завершення: {finished_by}, {finished_at.astimezone(zone):%d.%m %H:%M}."
    )
    return "\n".join(lines)


async def deliver(session: AsyncSession, *, send: Send, now: datetime) -> int:
    """Send every `PENDING` message; returns how many were sent."""
    return await outbox.deliver(
        session, model=StocktakeMessage, chats=telegram_chats, send=send, now=now
    )


__all__ = ["deliver", "message_text"]
