"""What each container's memory reaches under the heaviest work Birka does,
inside the limits compose now sets (ADR-0017), on this Mac in Docker.

One trial project (birka-limits-try) from this checkout's infra/, the images
built here (nothing pulled or built), no way out of its network. Pass 1:
every memory limit raised to 3 GiB (generous.yml), so each peak is the
work's own. Pass 2 (final.yml): compose's own limits, and the measuring
scripts held to the API's. While it
runs, `docker stats` is read every second and each container's highest
memory kept. The work, each inside the service it would run in on a server:

1. the hot path's load, as the server runbook's "the hot path on this
   server" sets it up: an API (the `api` service) on a database of its
   own, six sellers at once, driven from a `measure` container (the API's
   image with httpx added: the server's images do not hold it);
2. an opening list's approval at 2 000, 5 000 and 10 000 answers
   (`scripts.measure_opening_approval`), the app in process, in a
   `measure` container: the largest request the API serves;
3. the night's backup and its drill (`ops`) of the largest database those
   left;
4. the API and the watcher at rest, beside them.

Every container is checked afterwards for being killed for its memory.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path("/Users/nikitahlushak/birka")
L = Path.home() / ".cache/birka-runtime/limits"
DOCKER = str(Path.home() / ".docker/bin/docker")
ENV = {
    "PATH": f"{Path.home() / '.docker/bin'}:/usr/bin:/bin:/usr/sbin:/sbin",
    "HOME": str(Path.home()),
    "COMPOSE_PROJECT_NAME": "birka-limits-try",
    "COMPOSE_FILE": f"{REPO / 'infra/docker-compose.yml'}:{L / 'override.yml'}:"
                    f"{sys.argv[2] if len(sys.argv) > 2 else L / 'generous.yml'}",
    "COMPOSE_ENV_FILES": str(L / ".env"),
    "DOCKER_CONFIG": str(Path.home() / ".docker"),
}
UNITS = {"B": 1 / 2**20, "KiB": 1 / 1024, "MiB": 1, "GiB": 1024}


def mib(text: str) -> float:
    number, unit = re.fullmatch(r"([\d.]+)\s*([KMG]?i?B)", text.strip()).groups()
    return float(number) * UNITS[unit]


class Sampler(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.peaks: dict[str, float] = {}
        self.limits: dict[str, float] = {}
        self.phase = "start"
        self.by_phase: dict[str, dict[str, float]] = {}
        self.stop = threading.Event()

    def run(self) -> None:
        while not self.stop.is_set():
            out = subprocess.run(
                [DOCKER, "stats", "--no-stream", "--format", "{{.Name}}\t{{.MemUsage}}"],
                capture_output=True, text=True,
            ).stdout
            for line in out.splitlines():
                name, usage = line.split("\t")
                if not name.startswith("birka-limits"):
                    continue
                used, limit = (part.strip() for part in usage.split("/"))
                value = mib(used)
                self.peaks[name] = max(self.peaks.get(name, 0), value)
                self.limits[name] = mib(limit)
                phase = self.by_phase.setdefault(self.phase, {})
                phase[name] = max(phase.get(name, 0), value)
            time.sleep(1)


def sh(command: str, log: list[str], *, check: bool = True, timeout: int = 3600) -> subprocess.CompletedProcess[str]:
    done = subprocess.run(["/bin/sh", "-c", command], cwd=REPO / "infra", env=ENV, capture_output=True,
                          text=True, timeout=timeout)
    tail = "\n".join((done.stdout + done.stderr).strip().splitlines()[-25:])
    log.append(f"\n```sh\n{command}\n```\n\nexit {done.returncode}\n\n```\n{tail}\n```")
    if check and done.returncode != 0:
        raise RuntimeError(f"exit {done.returncode}: {command}")
    return done


def main() -> int:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    (L / "approval").mkdir(exist_ok=True)
    subprocess.run(["chmod", "777", str(L / "approval")], check=True)
    log: list[str] = ["# Memory under the heaviest work, inside the limits", ""]
    owner = ("postgresql+asyncpg://birka:$(grep ^POSTGRES_PASSWORD= " + str(L / ".env") +
             " | cut -d= -f2-)@db:5432")
    sampler = Sampler()
    sampler.start()
    started = time.time()
    subprocess.run([DOCKER, "rm", "-f", "birka-limits-perf-api"], capture_output=True)
    for database in ("birka_perf", "birka_json_perf"):
        sh(f"docker compose exec -T db sh -c 'dropdb -U \"$POSTGRES_USER\" --if-exists {database}'", log)
    try:
        sampler.phase = "1. the hot path, six sellers"
        log.append(f"\n## {sampler.phase}")
        sh("docker compose exec -T db sh -c 'createdb -U \"$POSTGRES_USER\" birka_perf'", log)
        sh("docker compose run -d --name birka-limits-perf-api --no-deps "
           "-e BIRKA_APP_ENV=ci -e BIRKA_LOG_LEVEL=WARNING "
           f"-e BIRKA_DATABASE_URL={owner}/birka_perf "
           "api sh -c \"alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 58043 --no-access-log\"", log)
        time.sleep(20)
        sh("docker compose --profile measure run --rm --no-deps "
           f"-e BIRKA_PERF_DATABASE_URL={owner}/birka_perf "
           "-e BIRKA_PERF_API_URL=http://birka-limits-perf-api:58043 -e BIRKA_PERF_GATE=all "
           "measure python -m scripts.measure_hot_path", log, timeout=1800)
        killed = sh(f"{DOCKER} inspect -f '{{{{.State.OOMKilled}}}} {{{{.State.Status}}}}' birka-limits-perf-api", log).stdout.strip()
        log.append(f"\nThe hot path's API: OOMKilled, status: `{killed}`.")
        sh(f"{DOCKER} rm -f birka-limits-perf-api", log)

        sampler.phase = "2. an opening list's approval, 2 000 to 10 000 answers"
        log.append(f"\n## {sampler.phase}")
        sh("docker compose exec -T db sh -c 'createdb -U \"$POSTGRES_USER\" birka_json_perf'", log)
        approval = sh("docker compose --profile measure run --rm --no-deps "
                      f"-v {L / 'approval'}:/out -e BIRKA_PERF_OUTPUT=/out "
                      f"-e BIRKA_PERF_DATABASE_URL={owner}/birka_json_perf "
                      "measure python -m scripts.measure_opening_approval", log, check=False, timeout=3600)
        log.append(f"\nThe approval's measurement exited {approval.returncode} (137 would be a kill for memory).")

        sampler.phase = "3. the night's backup and drill of the largest database"
        log.append(f"\n## {sampler.phase}")
        sh("docker compose --profile ops run --rm "
           f"-e BIRKA_DATABASE_URL={owner}/birka_json_perf ops", log)

        sampler.phase = "4. at rest"
        log.append(f"\n## {sampler.phase}")
        time.sleep(30)
        states = sh(f"{DOCKER} ps -a --filter label=com.docker.compose.project=birka-limits-try "
                    "--format '{{.Names}}' | xargs -I{} " + DOCKER +
                    " inspect -f '{{.Name}} OOMKilled={{.State.OOMKilled}} {{.State.Status}}' {}", log).stdout
        log.append(f"\n```\n{states.strip()}\n```")
    finally:
        subprocess.run([DOCKER, "rm", "-f", "birka-limits-perf-api"], capture_output=True)
        sampler.stop.set()
        sampler.join(timeout=10)
        took = time.time() - started
        log.append(f"\n## Peaks, MiB (sampled every second, {took / 60:.0f} minutes)\n")
        log.append("| container | peak | limit |\n|---|---|---|")
        for name in sorted(sampler.peaks):
            log.append(f"| {name} | {sampler.peaks[name]:.0f} | {sampler.limits.get(name, 0):.0f} |")
        log.append("\n## By phase\n")
        for phase, peaks in sampler.by_phase.items():
            log.append(f"- {phase}: " + ", ".join(f"{n} {v:.0f}" for n, v in sorted(peaks.items())))
        (out / "memory.md").write_text("\n".join(log) + "\n")
        (out / "memory.json").write_text(json.dumps({"peaks": sampler.peaks, "limits": sampler.limits,
                                                     "by_phase": sampler.by_phase}, indent=2))
        print("\n".join(log[-40:]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
