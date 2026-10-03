"""The site's certificate, watched for the owner (owner decision 2026-10-03).

"If the site's certificate cannot be renewed, the owner is told by the bot a
week before it runs out, as about a failed backup." Which site is watched and
what the owner is told are pure. The handshake that reads the certificate is
played against a server on this machine, with an authority made for the
test: never the network.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import ssl
import subprocess
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from scripts.backup_watch import edge_of

from app.core.config import Settings
from app.modules.backups.certificate import (
    KEY_PREFIX,
    CertificateExpiredError,
    Edge,
    certificate_alert,
    edge_to_watch,
    read_expiry,
)
from app.modules.backups.models import AlertKind
from app.modules.backups.status import alert_for

NOW = datetime(2026, 9, 30, 3, 40, tzinfo=UTC)
DOMAIN = "shop.example.com"


@pytest.fixture
def _isolate_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in list(os.environ):
        if name.startswith("BIRKA_"):
            monkeypatch.delenv(name, raising=False)


# --- which site ---------------------------------------------------------------


@pytest.mark.parametrize(
    "domain",
    [
        None,
        "",
        "localhost",
        "LOCALHOST.",
        "birka.localhost",
        "127.0.0.1",
        "::1",
        "[::1]",
        # Caddy's site address may name plain HTTP: no certificate at all.
        "http://localhost",
        "http://shop.example.com",
        "https://localhost",
    ],
)
def test_without_a_public_domain_nothing_is_asked(domain: str | None) -> None:
    """Caddy signs localhost with its own local authority, and no public one
    signs a bare address: there is no certificate to run out."""
    assert edge_to_watch(domain, "caddy", 443) is None


@pytest.mark.parametrize(
    "domain", [" Shop.Example.com. ", "https://shop.example.com", "shop.example.com:443"]
)
def test_the_public_domain_is_asked_of_caddy_by_its_name(domain: str) -> None:
    assert edge_to_watch(domain, "caddy", 443) == Edge(DOMAIN, "caddy", 443)


@pytest.mark.usefixtures("_isolate_environment")
def test_the_settings_name_the_domain_and_where_to_ask(monkeypatch: pytest.MonkeyPatch) -> None:
    assert edge_of(Settings(_env_file=None)) is None
    assert edge_of(Settings(_env_file=None, public_domain="localhost")) is None

    monkeypatch.setenv("BIRKA_PUBLIC_DOMAIN", DOMAIN)
    assert edge_of(Settings(_env_file=None)) == Edge(DOMAIN, "caddy", 443)

    monkeypatch.setenv("BIRKA_EDGE_HOST", "127.0.0.1")
    monkeypatch.setenv("BIRKA_EDGE_PORT", "8443")
    assert edge_of(Settings(_env_file=None)) == Edge(DOMAIN, "127.0.0.1", 8443)


# --- what the owner is told -------------------------------------------------------


@pytest.mark.parametrize("left", [timedelta(days=60), timedelta(days=8), timedelta(days=7)])
def test_a_week_or_more_left_says_nothing(left: timedelta) -> None:
    assert certificate_alert(DOMAIN, NOW + left, NOW) is None


@pytest.mark.parametrize("left", [timedelta(days=6, hours=23), timedelta(days=6, minutes=1)])
def test_less_than_a_week_left_is_told(left: timedelta) -> None:
    """The owner decided "a week before it runs out": seven days, to the hour."""
    assert certificate_alert(DOMAIN, NOW + left, NOW) is not None


def test_inside_the_last_week_the_owner_hears_what_happens_and_what_to_do() -> None:
    alert = certificate_alert(DOMAIN, NOW + timedelta(days=3, hours=5), NOW)

    assert alert is not None
    assert alert.key == "certificate:2026-09-30"
    assert alert.kind is AlertKind.FAILED
    # 2026-10-03 08:40 UTC is 11:40 in Kyiv: the shop's calendar.
    assert alert.text.startswith(
        f"⚠️ Сертифікат сайту {DOMAIN} закінчується 03.10.2026, лишилося 3 дн."
    )
    assert "застосунок перестане відкриватися в Telegram" in alert.text
    assert alert.text.endswith("Що робити: скажіть про це адміністраторові сервера.")


def test_the_last_day_is_said_as_less_than_a_day() -> None:
    alert = certificate_alert(DOMAIN, NOW + timedelta(hours=5), NOW)

    assert alert is not None
    assert "лишилося менше доби." in alert.text


def test_a_certificate_that_has_run_out_is_said_as_such() -> None:
    unknown = certificate_alert(DOMAIN, None, NOW)
    known = certificate_alert(DOMAIN, NOW - timedelta(days=1), NOW)

    assert unknown is not None and known is not None
    assert unknown.text.startswith(f"⚠️ Сертифікат сайту {DOMAIN} закінчився. ")
    assert known.text.startswith(f"⚠️ Сертифікат сайту {DOMAIN} закінчився 29.09.2026. ")
    for alert in (unknown, known):
        assert "Застосунок не відкривається в Telegram" in alert.text
        assert alert.text.endswith("адміністраторові сервера.")


def test_the_owner_hears_it_at_most_once_a_day() -> None:
    def key(now: datetime) -> str:
        alert = certificate_alert(DOMAIN, NOW + timedelta(days=5), now)
        assert alert is not None
        return alert.key

    assert key(NOW) == key(NOW + timedelta(hours=12))
    assert key(NOW + timedelta(days=1)) == "certificate:2026-10-01"


def test_no_message_about_the_backups_is_keyed_as_one_about_the_certificate() -> None:
    """The backups' story skips the certificate's keys; none of its own may
    look like one."""
    backups = alert_for(None, NOW, None)
    certificate = certificate_alert(DOMAIN, None, NOW)

    assert backups is not None and not backups.key.startswith(KEY_PREFIX)
    assert certificate is not None and certificate.key.startswith(KEY_PREFIX)


# --- the handshake ------------------------------------------------------------


Handle = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


@asynccontextmanager
async def edge(handle: Handle, context: ssl.SSLContext | None = None) -> AsyncIterator[int]:
    """A server on this machine; yields its port."""

    async def answer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await handle(reader, writer)
        finally:
            writer.close()

    server = await asyncio.start_server(answer, "127.0.0.1", 0, ssl=context)
    async with server:
        yield server.sockets[0].getsockname()[1]


async def hang_up(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    return None


async def say_nothing(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.read()


async def read_a_little(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.read(1)


async def test_an_edge_that_is_not_https_could_not_be_asked() -> None:
    async with edge(hang_up) as port:
        with pytest.raises(OSError):
            await read_expiry(Edge(DOMAIN, "127.0.0.1", port))


async def test_an_edge_that_never_answers_is_given_up() -> None:
    async with edge(say_nothing) as port:
        with pytest.raises(TimeoutError):
            await read_expiry(Edge(DOMAIN, "127.0.0.1", port), timeout=0.2)


@dataclass(frozen=True)
class Authority:
    """A certificate authority made for one test, and what it signed for
    `shop.example.com`."""

    trusted: ssl.SSLContext
    good: Path
    expired: Path
    key: Path

    def served(self, certificate: Path) -> ssl.SSLContext:
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certificate, self.key)
        return context


CA_CONFIG = """\
[ca]
default_ca = test

[test]
database = index.txt
new_certs_dir = .
serial = serial
default_md = sha256
policy = anything
unique_subject = no

[anything]
commonName = supplied
"""

LEAF_EXTENSIONS = f"""\
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = DNS:{DOMAIN}
"""


@pytest.fixture
def authority(tmp_path: Path) -> Authority:
    """Made with the `openssl` command, which the CI runner has; skipped
    where it is missing."""
    if shutil.which("openssl") is None:
        pytest.skip("the openssl command is not installed")

    def openssl(*arguments: str) -> None:
        subprocess.run(  # noqa: S603 — fixed arguments, files in tmp_path
            ["openssl", *arguments],  # noqa: S607 — whichever openssl is on PATH
            cwd=tmp_path,
            check=True,
            capture_output=True,
        )

    (tmp_path / "ca.cnf").write_text(CA_CONFIG)
    (tmp_path / "leaf.cnf").write_text(LEAF_EXTENSIONS)
    (tmp_path / "index.txt").write_text("")
    (tmp_path / "serial").write_text("01\n")
    openssl(
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem",
        "-subj", "/CN=birka test authority", "-days", "2",
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    )  # fmt: skip
    openssl(
        "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr",
        "-subj", f"/CN={DOMAIN}",
    )  # fmt: skip
    for name, validity in [
        ("good.pem", ["-days", "30"]),
        ("expired.pem", ["-startdate", "20200101000000Z", "-enddate", "20200102000000Z"]),
    ]:
        openssl(
            "ca", "-batch", "-notext", "-config", "ca.cnf", "-cert", "ca.pem",
            "-keyfile", "ca.key", "-in", "leaf.csr", "-out", name, "-extfile", "leaf.cnf",
            *validity,
        )  # fmt: skip
    return Authority(
        trusted=ssl.create_default_context(cafile=tmp_path / "ca.pem"),
        good=tmp_path / "good.pem",
        expired=tmp_path / "expired.pem",
        key=tmp_path / "leaf.key",
    )


async def test_the_handshake_reads_when_the_certificate_runs_out(authority: Authority) -> None:
    asked: list[str | None] = []
    served = authority.served(authority.good)
    served.sni_callback = lambda _socket, name, _context: asked.append(name)

    async with edge(read_a_little, served) as port:
        expires_at = await read_expiry(Edge(DOMAIN, "127.0.0.1", port), context=authority.trusted)

    assert asked == [DOMAIN]
    assert timedelta(days=29) < expires_at - datetime.now(UTC) < timedelta(days=31)


async def test_a_certificate_that_has_run_out_is_told_apart(authority: Authority) -> None:
    async with edge(read_a_little, authority.served(authority.expired)) as port:
        with pytest.raises(CertificateExpiredError):
            await read_expiry(Edge(DOMAIN, "127.0.0.1", port), context=authority.trusted)


async def test_a_certificate_telegram_would_refuse_is_not_read_as_good(
    authority: Authority,
) -> None:
    """Another name, or an authority nobody trusts: the edge could not be
    asked, and the watcher logs it rather than warn about a date."""
    async with edge(read_a_little, authority.served(authority.good)) as port:
        for asked, trusted in [
            (Edge("other.example.com", "127.0.0.1", port), authority.trusted),
            (Edge(DOMAIN, "127.0.0.1", port), ssl.create_default_context()),
        ]:
            with pytest.raises(ssl.SSLCertVerificationError):
                await read_expiry(asked, context=trusted)
