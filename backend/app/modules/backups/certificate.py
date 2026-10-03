"""Whether the site's certificate is about to run out, and what the owner is told.

Telegram opens the Mini App only over HTTPS, with a certificate it trusts.
Caddy gets that certificate for the public domain and renews it by itself,
weeks before it runs out. When renewal keeps failing — port 80 closed by a
firewall change, the domain pointed elsewhere — nothing in the shop notices
until the day it lapses and the app stops opening in Telegram.

The owner decided on 2026-10-03: "if the site's certificate cannot be renewed,
the owner is told by the bot a week before it runs out, as about a failed
backup" (business-rules.md, "before the public domain"). So
`scripts.backup_watch` asks the edge for its certificate as it looks at the
backups, and a warning goes to the same people, through the same
`backup_alert` queue, silently, and at most once a day.

`backup_alert` knows four kinds of message, and migration 0018 checks them;
none is this one. Rather than a migration for one more word, a warning about
the certificate is recorded as `FAILED` — its renewal failed — and told apart
by its key, which starts with `certificate:`. The backups' own story never
reads it as theirs (`service.queue_alerts`).
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import ssl
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from app.modules.backups.models import AlertKind
from app.modules.backups.status import Alert

# The owner's week (decision 2026-10-03).
WARN_BEFORE = timedelta(days=7)

# Every warning about the certificate has a key starting with this, and no
# message about the backups does.
KEY_PREFIX = "certificate:"
KIND = AlertKind.FAILED

# OpenSSL's X509_V_ERR_CERT_HAS_EXPIRED: the handshake was refused because a
# certificate's notAfter has passed.
CERT_HAS_EXPIRED = 10

# The date in the message is the shop's, as the owner reads a calendar.
SHOP_ZONE = ZoneInfo("Europe/Kyiv")

TELL = "Що робити: скажіть про це адміністраторові сервера."


class CertificateExpiredError(Exception):
    """The edge's certificate has already run out: the handshake was refused
    for exactly that, so the edge never said when."""


@dataclass(frozen=True, slots=True)
class Edge:
    """The public domain, and where to ask for its certificate."""

    domain: str
    host: str
    port: int


ReadExpiry = Callable[[Edge], Awaitable[datetime]]


def edge_to_watch(domain: str | None, host: str, port: int) -> Edge | None:
    """The edge to ask, or None when there is no public certificate to watch:
    no domain, localhost (Caddy signs that with its own local authority), or
    a bare address (no public authority signs one for Telegram)."""
    given = (domain or "").strip()
    with contextlib.suppress(ValueError):
        ipaddress.ip_address(given.strip("[]"))
        return None
    # Caddy's site address may carry a scheme or a port (`http://localhost`
    # serves plain HTTP, with no certificate at all).
    parts = urlsplit(given if "://" in given else f"//{given}")
    if parts.scheme not in ("", "https"):
        return None
    name = (parts.hostname or "").rstrip(".")
    if not name or name == "localhost" or name.endswith(".localhost"):
        return None
    try:
        ipaddress.ip_address(name)
    except ValueError:
        return Edge(domain=name, host=host, port=port)
    return None


async def read_expiry(
    edge: Edge, *, timeout: float = 10, context: ssl.SSLContext | None = None
) -> datetime:
    """When the certificate the edge presents for its domain runs out.

    The handshake is a browser's: the domain goes as SNI, and the chain and
    the name are checked against the system's authorities, so a certificate
    Telegram would refuse is never read as a good one. Raises
    `CertificateExpiredError` when it is refused because the certificate has
    run out; any other `OSError` — refused, timed out, not trusted — means
    the edge could not be asked."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(
                edge.host,
                edge.port,
                ssl=context or ssl.create_default_context(),
                server_hostname=edge.domain,
            ),
            timeout,
        )
    except ssl.SSLCertVerificationError as refusal:
        if refusal.verify_code == CERT_HAS_EXPIRED:
            raise CertificateExpiredError(refusal.verify_message) from refusal
        raise
    try:
        presented = writer.get_extra_info("peercert")
    finally:
        writer.close()
        with contextlib.suppress(OSError):
            await asyncio.wait_for(writer.wait_closed(), timeout)
    return datetime.fromtimestamp(ssl.cert_time_to_seconds(presented["notAfter"]), UTC)


def certificate_alert(domain: str, expires_at: datetime | None, now: datetime) -> Alert | None:
    """What the owner must hear about the certificate now, if anything.

    `expires_at` is None when the edge refused the handshake because the
    certificate has already run out, and so did not say when. The key is the
    day (UTC, as for a server that never backed up), so however often the
    watcher looks the owner hears it at most once a day, every day until it
    is renewed."""
    if expires_at is not None and expires_at - now >= WARN_BEFORE:
        return None
    if expires_at is None or expires_at <= now:
        on = "" if expires_at is None else f" {expires_at.astimezone(SHOP_ZONE):%d.%m.%Y}"
        text = (
            f"⚠️ Сертифікат сайту {domain} закінчився{on}. Застосунок не відкривається "
            "в Telegram, доки сертифікат не оновлять. " + TELL
        )
    else:
        days = (expires_at - now) // timedelta(days=1)
        left = f"лишилося {days} дн." if days else "лишилося менше доби."
        text = (
            f"⚠️ Сертифікат сайту {domain} закінчується "
            f"{expires_at.astimezone(SHOP_ZONE):%d.%m.%Y}, {left} Сервер мав оновити його "
            "сам, але досі не оновив. Коли сертифікат закінчиться, застосунок перестане "
            "відкриватися в Telegram. " + TELL
        )
    return Alert(key=f"{KEY_PREFIX}{now:%Y-%m-%d}", kind=KIND, text=text)


__all__ = [
    "KEY_PREFIX",
    "WARN_BEFORE",
    "CertificateExpiredError",
    "Edge",
    "ReadExpiry",
    "certificate_alert",
    "edge_to_watch",
    "read_expiry",
]
