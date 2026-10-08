"""What the server's images and its front door start with.

Before the public domain (2026-10-03): the sign-in limit counts by the
address Caddy was reached from (`app.core.rate_limit`). The API sees that
address only when uvicorn believes Caddy's X-Forwarded-For; without the flag
every client on the internet would share one bucket, and one stranger could
refuse everyone's sign-in while every other test stayed green.

Failures are visible (2026-10-03): Docker can tell a ready API from one that
only started; every image knows the build it is; the watcher sees the
backups' disk and asks the API on the compose network, where Caddy never
sends anyone; and a breach CI does not gate is still seen.

Nothing here runs Docker or Caddy; CI's `edge` job does, with these files.
"""

import json
import os
import re
import subprocess
import sys
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.core.config import Settings

DOCKERFILE = Path(__file__).resolve().parents[2] / "Dockerfile"
ROOT = DOCKERFILE.parents[1]
INFRA = ROOT / "infra"
READY = "http://127.0.0.1:8000/api/v1/ready"


def _compose() -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load((INFRA / "docker-compose.yml").read_text())
    return loaded


def _services() -> dict[str, dict[str, Any]]:
    services: dict[str, dict[str, Any]] = _compose()["services"]
    return services


def _workflow() -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text())
    return loaded


def _stages(dockerfile: Path) -> dict[str, list[str]]:
    """Each stage's instructions, line continuations joined, by its name."""
    stages: dict[str, list[str]] = {}
    current: list[str] = []
    for line in dockerfile.read_text().replace("\\\n", " ").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("FROM "):
            name = line.split(" AS ")[-1] if " AS " in line else f"stage{len(stages)}"
            current = stages.setdefault(name, [])
        current.append(line)
    return stages


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
    api = _services()["api"]
    assert "ports" not in api
    assert [str(port) for port in api["expose"]] == ["8000"]


def test_only_caddy_publishes_a_port() -> None:
    """Docker opens a published port ahead of the server's firewall."""
    assert [name for name, service in _services().items() if service.get("ports")] == ["caddy"]


def test_every_service_keeps_a_bounded_log() -> None:
    """`web` included: its output is small, but unbounded is unbounded."""
    bounded = _compose()["x-logging"]
    assert bounded["options"] == {"max-size": "10m", "max-file": "5"}
    services = _services()
    kept = {name: service.get("logging") for name, service in services.items()}
    assert kept == dict.fromkeys(services, bounded)


# --- ready, as Docker sees it -------------------------------------------------


def test_docker_asks_the_api_whether_it_is_ready_with_python() -> None:
    """The image is python:slim, which has no curl."""
    check = _services()["api"]["healthcheck"]
    test = check["test"]
    assert test[:3] == ["CMD", "python", "-c"]
    assert "urllib.request" in test[3] and READY in test[3]
    assert "curl" not in json.dumps(check)
    assert {"interval", "timeout", "retries", "start_period"} <= set(check)


def test_the_site_does_not_wait_for_a_ready_api() -> None:
    """A schema not yet migrated must not keep the whole site down: Caddy
    waits for the API to start, not to be ready."""
    assert _services()["caddy"]["depends_on"]["api"] == {"condition": "service_started"}


class _Answer(BaseHTTPRequestHandler):
    status = 200

    def do_GET(self) -> None:
        self.send_response(self.status if self.path == "/api/v1/ready" else 404)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def api_answering() -> Iterator[tuple[type[_Answer], int]]:
    answer = type("Answer", (_Answer,), {})
    server = HTTPServer(("127.0.0.1", 0), answer)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield answer, server.server_address[1]
    finally:
        server.shutdown()
        server.server_close()


def _healthcheck(port: int) -> int:
    """The compose file's own check, run against `port` instead of 8000."""
    code = _services()["api"]["healthcheck"]["test"][3].replace(":8000/", f":{port}/")
    return subprocess.run(  # noqa: S603 — the compose file's check, current test interpreter
        [sys.executable, "-c", code], capture_output=True, timeout=30
    ).returncode


def test_the_check_passes_only_while_the_api_says_it_is_ready(api_answering) -> None:
    answer, port = api_answering
    assert _healthcheck(port) == 0
    answer.status = 503
    assert _healthcheck(port) != 0, "a database not answering, or not migrated"


def test_the_check_fails_when_nothing_answers() -> None:
    with HTTPServer(("127.0.0.1", 0), _Answer) as closed:
        port = closed.server_address[1]
    assert _healthcheck(port) != 0


# --- the build's version ------------------------------------------------------


def test_every_image_is_built_with_its_version() -> None:
    built = {name: service["build"] for name, service in _services().items() if "build" in service}
    assert set(built) == {"api", "ops", "backup-watch", "web"}
    for name, build in built.items():
        assert build["args"] == {"BIRKA_RELEASE": "${BIRKA_RELEASE:-dev}"}, name


def test_both_backend_images_carry_the_version_after_their_slow_layers() -> None:
    stages = _stages(DOCKERFILE)
    assert not any("BIRKA_RELEASE" in line for line in stages["base"]), (
        "in the shared stage it would rebuild the packages and the ops tools on every commit"
    )
    for name in ("ops", "api"):
        stage = stages[name]
        assert "ARG BIRKA_RELEASE=dev" in stage, name
        assert "ENV BIRKA_RELEASE=$BIRKA_RELEASE" in stage, name
        runs = [at for at, line in enumerate(stage) if line.startswith("RUN ")]
        assert all(at < stage.index("ARG BIRKA_RELEASE=dev") for at in runs), name


def test_both_backend_images_hold_the_same_code_and_run_as_birka() -> None:
    """The ops tools go in before the code (2026-10-08), so the code and its
    user are written out in both final stages. They stay the same lines: the
    backup runs on the code the API runs, and neither image runs as root."""
    stages = _stages(DOCKERFILE)

    def code_and_user(name: str) -> list[str]:
        stage = stages[name]
        first = next(at for at, line in enumerate(stage) if line.startswith("COPY "))
        return stage[first : stage.index("USER birka") + 1]

    def copies(name: str) -> list[str]:
        return [line for line in stages[name] if line.startswith("COPY ")]

    assert code_and_user("ops") == code_and_user("api")
    assert copies("ops") == copies("api")
    for name in ("ops", "api"):
        users = [line for line in stages[name] if line.startswith("USER ")]
        assert users[-1] == "USER birka", name
    assert not any(line.startswith(("COPY app ", "USER ")) for line in stages["base"]), (
        "the shared stage holds no code and stays root, so the ops tools install before the code"
    )


def test_the_bundle_is_built_with_the_version_and_the_published_stage_needs_none() -> None:
    build, published = _stages(ROOT / "frontend" / "Dockerfile").values()
    at = build.index("ARG BIRKA_RELEASE=dev")
    assert build.index("RUN npm ci --no-audit --no-fund") < at < build.index("RUN npm run build")
    assert not any("BIRKA_RELEASE" in line for line in published)


def test_the_running_api_and_watcher_never_hide_the_build_they_are() -> None:
    """No value in compose: the shell's when exported, else the image's own,
    never a `dev` written over the build's commit at `up`."""
    for name in ("api", "backup-watch"):
        environment = _services()[name]["environment"]
        assert "BIRKA_RELEASE" in environment, name
        assert environment["BIRKA_RELEASE"] is None, name


# --- the watcher --------------------------------------------------------------


def test_the_watcher_sees_the_backups_disk_read_only_and_asks_the_api_inside() -> None:
    services = _services()
    watcher = services["backup-watch"]
    [backups] = [volume for volume in services["ops"]["volumes"] if volume.endswith(":/backups")]
    assert watcher["volumes"] == [f"{backups}:ro"]
    environment = watcher["environment"]
    assert environment["BIRKA_API_URL"] == "http://api:8000"
    assert environment["BIRKA_ADMIN_TELEGRAM_IDS"] == "${BIRKA_ADMIN_TELEGRAM_IDS:-}"
    assert environment["BIRKA_HEARTBEAT_URL"] == "${BIRKA_HEARTBEAT_URL:-}"
    assert "BIRKA_ADMIN_TELEGRAM_IDS" not in services["api"]["environment"]


def test_the_variables_are_the_settings_they_name() -> None:
    named = {
        "BIRKA_API_URL": "api_url",
        "BIRKA_ADMIN_TELEGRAM_IDS": "admin_telegram_ids",
        "BIRKA_HEARTBEAT_URL": "heartbeat_url",
        "BIRKA_RELEASE": "release",
    }
    assert set(named.values()) <= set(Settings.model_fields)
    assert all(variable == f"BIRKA_{field.upper()}" for variable, field in named.items())


def test_the_example_settings_explain_the_new_ones() -> None:
    lines = (INFRA / ".env.example").read_text().splitlines()
    for variable in ("BIRKA_ADMIN_TELEGRAM_IDS", "BIRKA_HEARTBEAT_URL"):
        at = lines.index(f"{variable}=")
        assert lines[at - 1].startswith("#"), f"{variable} has no comment"
    # Not set from .env: an empty value there would be the build's version.
    assert not any(line.startswith("BIRKA_RELEASE") for line in lines)
    assert any("BIRKA_RELEASE=$(git rev-parse --short HEAD)" in line for line in lines)


# --- the front door -----------------------------------------------------------


def test_caddy_answers_the_apis_internals_itself_with_404() -> None:
    """`/internal/status` is the watcher's, on the compose network. Through
    Caddy it would otherwise get the page, 200, from the catch-all."""
    text = (INFRA / "Caddyfile").read_text()
    matcher = re.search(r"^\t@internal path (.+)$", text, re.MULTILINE)
    assert matcher and set(matcher.group(1).split()) == {"/internal", "/internal/*"}
    block = re.search(r"^\thandle @internal \{\n(.*?)\n\t\}$", text, re.MULTILINE | re.DOTALL)
    assert block and block.group(1).strip() == "respond 404"
    assert block.start() < text.index("\thandle {\n"), "before the catch-all"


# --- CI -----------------------------------------------------------------------


def _hot_path_steps() -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = _workflow()["jobs"]["hot-path"]["steps"]
    return steps


def _annotate(tmp_path: Path, output: str | None) -> tuple[str, str]:
    """Run the hot-path job's annotating step on the harness's `output`."""
    [step] = [step for step in _hot_path_steps() if step.get("shell") == "python"]
    figures, summary = tmp_path / "hot-path.txt", tmp_path / "summary.md"
    if output is not None:
        figures.write_text(output)
    finished = subprocess.run(  # noqa: S603 — the workflow's own step, current test interpreter
        [sys.executable, "-c", step["run"]],
        env={**os.environ, "HOT_PATH_OUTPUT": str(figures), "GITHUB_STEP_SUMMARY": str(summary)},
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert finished.returncode == 0, finished.stderr
    return finished.stdout, summary.read_text() if summary.exists() else ""


def _row(case: str, p95: float, budget: float, *, gated: bool) -> dict[str, object]:
    return {
        "case": case,
        "concurrency": 1 if gated else 6,
        "n": 200,
        "p50": p95 / 2,
        "p95": p95,
        "p99": p95,
        "max": p95,
        "budget": budget,
        "verdict": "pass" if p95 <= budget else "FAIL",
        "gated": gated,
    }


def test_a_breach_ci_does_not_gate_is_a_warning_and_a_summary_line(tmp_path) -> None:
    rows = [
        _row("GET /catalog/stock-options", 30.0, 300.0, gated=True),
        _row("POST /sales · 1 line (6 sellers)", 512.25, 500.0, gated=False),
        _row("POST /sales · same coat, 6 sellers", 100.0, 500.0, gated=False),
        _row("POST /sales · 1 line", 501.0, 500.0, gated=True),
    ]
    output = "gate: one-seller; 2 CPUs\nPOST /sales · 1 line  …  (not gated)\n\n"
    stdout, summary = _annotate(tmp_path, output + json.dumps(rows, indent=2) + "\n")

    warnings = [line for line in stdout.splitlines() if line.startswith("::warning")]
    assert warnings == [
        "::warning title=Hot path over budget (not gated)::"
        "POST /sales · 1 line (6 sellers): p95 512.2 ms, over its 500.0 ms budget (not gated)"
    ]
    assert "- POST /sales · 1 line (6 sellers): p95 512.2 ms" in summary
    assert "same coat" not in summary and "POST /sales · 1 line:" not in summary


def test_no_figures_and_no_breach_say_nothing_and_fail_nothing(tmp_path) -> None:
    assert "::warning" not in _annotate(tmp_path, None)[0]
    passing = json.dumps([_row("POST /sales · 1 line", 50.0, 500.0, gated=True)], indent=2)
    stdout, summary = _annotate(tmp_path, f"gate: all\n\n{passing}\n")
    assert "::warning" not in stdout and summary == ""


def test_the_annotation_reads_what_the_harness_writes_and_changes_no_verdict() -> None:
    steps = _hot_path_steps()
    names = [step.get("name") for step in steps]
    measure = steps[names.index("Measure, and fail on a budget breached")]
    annotate = steps[names.index("Breaches that do not fail the run, where they are seen")]
    assert "set -o pipefail" in measure["run"]
    figures = annotate["env"]["HOT_PATH_OUTPUT"]
    assert f"| tee {figures}" in measure["run"], "the step reads what the harness wrote"
    assert annotate["if"] == "always()" and annotate["continue-on-error"] is True
    assert names.index("Breaches that do not fail the run, where they are seen") == (
        names.index("Measure, and fail on a budget breached") + 1
    )
    # The keys the step reads, from the harness itself.
    from scripts.measure_hot_path import summarise

    row = summarise("POST /sales · 1 line", 1, [1.0, 2.0])
    assert {"case", "p95", "budget", "verdict", "gated"} <= set(row)


def test_the_edge_job_probes_what_the_server_relies_on() -> None:
    job = _workflow()["jobs"]["edge"]
    assert job["env"]["BIRKA_RELEASE"] == "${{ github.sha }}"
    names = [step.get("name") for step in job["steps"]]
    probe = job["steps"][
        names.index(
            "The API is ready behind the edge, healthy to Docker, and keeps its internals in"
        )
    ]["run"]
    assert "alembic upgrade head" in probe
    assert '"$base/api/v1/ready")' in probe and 'test "$code" = 200' in probe
    assert '"$base/internal/status")' in probe and 'test "$code" = 404' in probe
    assert "/api/v1/client-errors" in probe and 'test "$code" = 204' in probe
    assert "State.Health.Status" in probe and "healthy" in probe
    # Before the step that stops the API to read Caddy's own log.
    assert names.index(
        "The API is ready behind the edge, healthy to Docker, and keeps its internals in"
    ) < names.index("The edge's own log keeps no query string")
