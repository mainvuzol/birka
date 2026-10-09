"""Loosen one pin at a time: each must fail test_pinned_inputs.py or test_dependency_lock.py."""
import re
import subprocess
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
PY = Path.home() / ".cache/birka-runtime/python/bin/python"
PG = "@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"
CADDY = "@sha256:881bbc60f9986d5ab8e7cfd6cf7e4ef3c9c0439fef2429d035d065577882f028"


def first(old, new):
    return lambda t: t.replace(old, new, 1) if old in t else None


def regex(pattern, new):
    return lambda t: re.sub(pattern, new, t, count=1, flags=re.M) if re.search(pattern, t, re.M) else None


M = [
    ("compose: PostgreSQL by tag alone", "infra/docker-compose.yml", first(f"postgres:17-alpine{PG}", "postgres:17-alpine")),
    ("compose: Caddy on another digest than CI's check", "infra/docker-compose.yml", first(CADDY, "@sha256:" + "1" * 64)),
    ("dev compose: PostgreSQL by tag alone", "infra/docker-compose.dev.yml", first(f"postgres:17-alpine{PG}", "postgres:17-alpine")),
    ("CI: one job's PostgreSQL service by tag alone", ".github/workflows/ci.yml", first(f"postgres:17-alpine{PG}", "postgres:17-alpine")),
    ("CI: the Caddyfile checked with Caddy by tag", ".github/workflows/ci.yml", first(f"caddy:2-alpine{CADDY}", "caddy:2-alpine")),
    ("backend Dockerfile: Python by tag alone", "backend/Dockerfile", regex(r"^(FROM python:3\.12\.14-slim)@sha256:[0-9a-f]{64}", r"\1")),
    ("frontend Dockerfile: Alpine by tag alone", "frontend/Dockerfile", regex(r"^(FROM alpine:3\.22)@sha256:[0-9a-f]{64}", r"\1")),
    ("frontend Dockerfile: a new base, unpinned", "frontend/Dockerfile", regex(r"^(FROM alpine:3\.22@sha256:[0-9a-f]{64})$", "FROM busybox:1.37")),
    ("CI: an action by its tag", ".github/workflows/ci.yml", regex(r"actions/checkout@[0-9a-f]{40} # v4\.4\.0", "actions/checkout@v4")),
    ("CI: an action's commit without its release", ".github/workflows/ci.yml", regex(r"(actions/setup-node@[0-9a-f]{40}) # v4\.4\.0", r"\1")),
    ("CI: one job on ubuntu-latest", ".github/workflows/ci.yml", first("runs-on: ubuntu-24.04", "runs-on: ubuntu-latest")),
    ("CI: Python 3.12, not the image's", ".github/workflows/ci.yml", first('python-version: "3.12.14"', 'python-version: "3.12"')),
    ("CI: Node 24, not exact", ".github/workflows/ci.yml", first('node-version: "24.21.0"', 'node-version: "24"')),
    ("CI: Node of another major", ".github/workflows/ci.yml", first('node-version: "24.21.0"', 'node-version: "22.20.0"')),
    ("image: the lock installed without hashes required", "backend/Dockerfile", first("--no-deps --require-hashes -r requirements.lock", "--no-deps -r requirements.lock")),
    ("CI: a lock installed without hashes required", ".github/workflows/ci.yml", first("pip install --no-deps --require-hashes -r requirements.lock", "pip install --no-deps -r requirements.lock")),
    ("CI: the backend with its dependencies, beside the lock", ".github/workflows/ci.yml", first('pip install --no-deps --require-hashes -r requirements-dev.lock\n          pip install --no-deps -e ".[dev]"', 'pip install -c requirements-dev.lock -e ".[dev]"')),
    ("runtime lock: one pin without its hashes", "backend/requirements.lock", regex(r"^(aiofiles==25\.1\.0) \\\n(?:    --hash=sha256:[0-9a-f]{64} \\\n)*    --hash=sha256:[0-9a-f]{64}$", r"\1")),
    ("dev lock: a hash that is not the runtime lock's", "backend/requirements-dev.lock", first("--hash=sha256:a8d728f0", "--hash=sha256:00000000")),
    # After the review (2026-10-10): what a list of known names would not see.
    ("dev compose: a new service pulled by tag", "infra/docker-compose.dev.yml", first("services:\n", "services:\n  cache:\n    image: redis:7-alpine\n")),
    ("compose: PostgreSQL by Docker Hub's full name, by tag", "infra/docker-compose.yml", first(f"postgres:17-alpine{PG}", "docker.io/library/postgres:17-alpine")),
    ("CI: a job inside a container by tag", ".github/workflows/ci.yml", first("    runs-on: ubuntu-24.04\n", "    runs-on: ubuntu-24.04\n    container: debian:13\n")),
    ("CI: a Docker action by tag", ".github/workflows/ci.yml", regex(r"uses: actions/checkout@[0-9a-f]{40} # v4\.4\.0", "uses: docker://alpine:3.22")),
    ("a second workflow, .yaml, by tags", ".github/workflows/release.yaml", lambda t: "name: release\non: workflow_dispatch\njobs:\n  r:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n"),
    ("web image: its Node named apart from CI's", "frontend/Dockerfile", first("(Node 24.21.0\n", "(Node 24.22.0\n")),
]

caught = 0
for name, rel, mutate in M:
    path = ROOT / rel
    existed = path.exists()
    original = path.read_bytes() if existed else b""
    mutated = mutate(original.decode())
    if mutated is None or mutated == original.decode():
        print(f"- {name}: NOT APPLIED")
        continue
    path.write_text(mutated)
    try:
        run = subprocess.run([str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x",
                              "tests/unit/test_pinned_inputs.py", "tests/unit/test_dependency_lock.py"],
                             cwd=ROOT / "backend", capture_output=True, text=True, timeout=300)
    finally:
        if existed:
            path.write_bytes(original)
        else:
            path.unlink()
    ok = run.returncode != 0
    caught += ok
    failed = next((line.split("::")[-1].split(" ")[0] for line in run.stdout.splitlines() if line.startswith("FAILED")), "")
    print(f"- {name}: {'caught by ' + failed if ok else 'SURVIVED'}")
print(f"{caught} of {len(M)} caught")
