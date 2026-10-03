"""What the API's image starts with (before the public domain, 2026-10-03).

The sign-in limit counts by the address Caddy was reached from
(`app.core.rate_limit`). The API sees that address only when uvicorn believes
Caddy's X-Forwarded-For; without the flag every client on the internet would
share one bucket, and one stranger could refuse everyone's sign-in while every
other test stayed green."""

import json
import re
from pathlib import Path

import yaml

DOCKERFILE = Path(__file__).resolve().parents[2] / "Dockerfile"


def _api_command() -> list[str]:
    text = DOCKERFILE.read_text()
    # The first stage's CMD, in exec form, line continuations joined.
    found = re.search(r"^CMD (\[.*?\])\s*$", text.replace("\\\n", " "), re.MULTILINE)
    assert found, "the API stage has no exec-form CMD"
    return json.loads(found.group(1))


def test_the_api_believes_the_address_caddy_was_reached_from() -> None:
    command = _api_command()
    assert command[:2] == ["uvicorn", "app.main:app"]
    assert "--proxy-headers" in command
    at = command.index("--forwarded-allow-ips")
    assert command[at + 1] == "*"


def test_the_api_is_never_published_by_compose() -> None:
    """Trusting any sender is safe only while nothing but Caddy reaches the
    API: compose exposes its port on its own network and never publishes it."""
    compose = yaml.safe_load((DOCKERFILE.parents[1] / "infra" / "docker-compose.yml").read_text())
    api = compose["services"]["api"]
    assert "ports" not in api
    assert [str(port) for port in api["expose"]] == ["8000"]
