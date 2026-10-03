"""Application user.

Telegram supplies identity; it is not the source of business truth. A user row
exists in our database with our own id, and the Telegram id is one attribute of
it (`.ai/architecture.md`, state ownership).
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UUIDPrimaryKey


class AppUser(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "app_user"

    telegram_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    language_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Raised by one whenever this person's sign-ins are ended (owner decision,
    # 2026-10-03): a session token issued under a lower number is refused.
    session_epoch: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    __table_args__ = (UniqueConstraint("telegram_user_id", name="uq_app_user_telegram_user_id"),)


__all__ = ["AppUser"]
