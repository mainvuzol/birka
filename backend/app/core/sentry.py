"""What Sentry is given, and what is taken out first.

Sentry stays off until `BIRKA_SENTRY_DSN` is set. When it is on, nothing a
customer typed, no sign-in data and no token leaves the process: the request
body, the query string, the Referer's query, and the values a refused
database row repeats are cut from every event and breadcrumb. The API and the
watcher (`scripts.backup_watch`) start it the same way.

Nor does a secret held in an address. The bot's token is part of every
address the bot calls (`https://api.telegram.org/bot<token>/<method>`), and
the outside check-in's address is itself its secret (`BIRKA_HEARTBEAT_URL`).
sentry-sdk's aiohttp integration, on by default, kept each call the watcher
made as a breadcrumb with its whole path, and every event of the process
carried them (found on 2026-10-03, making failures visible). So that
integration is off, any address a breadcrumb still holds is cut to its
scheme and host, and the token is cut from every text an event carries.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

import sentry_sdk

from app.core.config import Settings
from app.core.logging import (
    redact_database_values,
    without_bot_token,
    without_query,
    without_query_strings,
)

if TYPE_CHECKING:
    from sentry_sdk.types import Breadcrumb, BreadcrumbHint, Event, Hint


def scrub_request_body(event: Event, _hint: Hint) -> Event:
    """Remove the request body from every event before it leaves the process.

    `POST /auth/telegram` carries raw Telegram initData, which is a usable
    credential until `telegram_init_data_max_age_seconds` elapses. Anyone able
    to read the Sentry project could replay it and mint a session.
    """
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for sensitive in ("authorization", "Authorization", "cookie", "Cookie"):
                headers.pop(sensitive, None)
    return event


def _scrub_text(text: str) -> str:
    return without_bot_token(without_query_strings(redact_database_values(text)))


# A value that is an address with a scheme: `https://…`, `postgresql+asyncpg://…`.
_ADDRESS = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")


def _origin(url: str) -> str:
    """An address cut to its scheme and host: enough to tell which service
    was called, and nothing of the path, the query or a password."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc.rpartition('@')[2]}"


def scrub_event(event: Event, hint: Hint) -> Event:
    """Remove what must not leave the process from an event, before it leaves.

    The request body, as above. Then the customers' names and phones, which the
    logs never carry either (`.ai/project-memory/known-risks.md`, customer
    credit): a debt search sends them in its query string, which sentry-sdk
    attaches to every event of the request whatever `send_default_pii` says,
    and PostgreSQL repeats a refused row's values in the text of a database
    error. The request id stays, as a tag (app/core/correlation.py), so the
    event can still be matched to the request's log lines.
    """
    scrub_request_body(event, hint)
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("query_string", None)
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = without_query(url)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for referer in ("referer", "Referer"):
                if isinstance(headers.get(referer), str):
                    headers[referer] = without_query(headers[referer])
    exceptions = event.get("exception")
    if isinstance(exceptions, dict):
        for exception in exceptions.get("values") or []:
            if isinstance(exception, dict) and isinstance(exception.get("value"), str):
                exception["value"] = _scrub_text(exception["value"])
    if isinstance(event.get("message"), str):
        event["message"] = _scrub_text(event["message"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if isinstance(logentry.get(key), str):
                logentry[key] = _scrub_text(logentry[key])
        # The arguments of a logged message are its values; the formatted
        # message above already says what they were, without them.
        logentry.pop("params", None)
    return event


def scrub_breadcrumb(crumb: Breadcrumb, _hint: BreadcrumbHint) -> Breadcrumb:
    """The same for the trail of log lines and calls an event carries.

    Every log line is a breadcrumb, the access line of the failing request
    included. The access line is already cut where it is written
    (app/core/logging.py); this is for any other line that holds a URL.

    An outgoing call's address — under `url`, or any value that is an address
    — keeps only its scheme and host: its path can be a secret (the bot's
    token, the check-in's address).
    """
    if isinstance(crumb.get("message"), str):
        crumb["message"] = _scrub_text(crumb["message"])
    data = crumb.get("data")
    if isinstance(data, dict):
        # sentry-sdk keeps an outgoing call's query apart from its URL.
        data.pop("http.query", None)
        data.pop("http.fragment", None)
        for key, value in list(data.items()):
            if not isinstance(value, str):
                continue
            if _ADDRESS.match(value):
                data[key] = _origin(value)
            elif key == "url":
                data[key] = _scrub_text(without_query(value))
            else:
                data[key] = _scrub_text(value)
    return crumb


def install_sentry(settings: Settings, *, component: str) -> None:
    """Start Sentry for one process — `api` or `backup-watch` — when a DSN is
    set; without one nothing leaves the server. The owner decided on
    2026-10-03 that error details stay in the server's log for now, and that
    one setting turns Sentry on once someone will read it.

    Each event names the build it came from (`BIRKA_RELEASE`) and the process
    that sent it.
    """
    if not settings.sentry_dsn:
        return
    # Imported here: only a process that sends to Sentry needs it.
    from sentry_sdk.integrations.aiohttp import AioHttpIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        release=settings.release,
        send_default_pii=False,
        # send_default_pii=False only gates cookies; sentry-sdk 2.x attaches
        # request bodies regardless. Both of the next two lines are required.
        max_request_body_size="never",
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
        # Login credentials also live in traceback locals (init_data and
        # parsed payloads). Request scrubbing does not remove those copies.
        include_local_variables=False,
        traces_sample_rate=0.0,
        # It would keep every outgoing call — to Telegram, with the bot's
        # token in its path, and the check-in — as a breadcrumb, and neither
        # process needs those. Off before it starts: sentry-sdk patches
        # aiohttp once per process and never undoes it.
        disabled_integrations=[AioHttpIntegration],
    )
    sentry_sdk.get_global_scope().set_tag("component", component)


__all__ = ["install_sentry", "scrub_breadcrumb", "scrub_event", "scrub_request_body"]
