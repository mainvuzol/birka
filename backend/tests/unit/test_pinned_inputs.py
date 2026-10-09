"""Everything the server is built from is named exactly, so it is what CI ran.

Owner decision, 2026-10-10 (ADR-0019): a tag such as `caddy:2-alpine` is
rebuilt in place now and then, `actions/checkout@v4` moves with each v4
release, `ubuntu-latest` becomes a new Ubuntu (26.04, from 2026-10-19), and a
version on PyPI is a name, not a file. Each was a way for the server, or the
CI that vouches for it, to get something nobody tested. So:

- every image is pinned by its digest, the multi-arch index, and a name and
  tag carry one digest wherever they appear;
- every GitHub Action is pinned by a commit, its release named beside it;
- CI runs on a named Ubuntu, with the image's Python and an exact Node;
- the Python locks hold a hash for each file (test_dependency_lock.py), and
  the image and CI install them with --require-hashes.

Nothing here reaches a registry; moving a pin is the server runbook's "a
pinned version, changed on purpose".
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = sorted((ROOT / ".github" / "workflows").glob("*.yml"))
DOCKERFILES = [ROOT / "backend" / "Dockerfile", ROOT / "frontend" / "Dockerfile"]
COMPOSE = [ROOT / "infra" / "docker-compose.yml", ROOT / "infra" / "docker-compose.dev.yml"]
FILES = DOCKERFILES + COMPOSE + WORKFLOWS

# The outside images Birka is built from or runs. A new one is added here,
# and pinned like these.
IMAGES = ("postgres", "caddy", "node", "alpine", "python")
_IMAGE = re.compile(rf"(?<![\w./-])((?:{'|'.join(IMAGES)}):[\w.-]+)(@sha256:[0-9a-f]{{64}})?")
_COMMENT = re.compile(r"(^|\s)#.*$")


def _code(path: Path) -> list[tuple[int, str]]:
    """The file's lines without their comments, which may name a tag in prose."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return [(n, _COMMENT.sub("", line)) for n, line in enumerate(lines, 1)]


def _image_refs() -> list[tuple[str, int, str, str | None]]:
    found = []
    for path in FILES:
        for number, line in _code(path):
            for match in _IMAGE.finditer(line):
                name, digest = match.group(1), match.group(2)
                found.append((path.relative_to(ROOT).as_posix(), number, name, digest))
    return found


def test_every_image_is_pinned_by_its_digest() -> None:
    refs = _image_refs()
    # 5 bases and images in the Dockerfiles and compose, PostgreSQL in the dev
    # compose and CI's four jobs, Caddy in the edge job: fewer means the scan
    # lost some.
    assert len(refs) >= 11, f"fewer images than built and run from: {refs}"
    floating = [f"{path}:{number} {name}" for path, number, name, digest in refs if digest is None]
    assert not floating, f"named by tag alone: {floating}"


def test_a_name_and_tag_carry_one_digest_everywhere() -> None:
    """CI's PostgreSQL is the server's; the Caddy that validates the Caddyfile
    is the one that serves it."""
    digests: dict[str, set[str]] = {}
    for _, _, name, digest in _image_refs():
        digests.setdefault(name, set()).add(digest or "")
    split = {name: sorted(found) for name, found in digests.items() if len(found) > 1}
    assert not split, f"one tag, several digests: {split}"
    assert {name.split(":")[0] for name in digests} == set(IMAGES), digests


def test_every_dockerfile_base_is_an_outside_image_or_a_stage() -> None:
    """A FROM that names neither would escape the rule above."""
    for path in DOCKERFILES:
        stages: set[str] = set()
        for _, line in _code(path):
            match = re.match(r"\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?", line, re.I)
            if not match:
                continue
            base, alias = match.group(1), match.group(2)
            pinned = bool(re.fullmatch(_IMAGE.pattern, base)) and "@sha256:" in base
            assert base in stages or pinned, (path, base)
            if alias:
                stages.add(alias)


def test_every_action_is_pinned_by_a_commit() -> None:
    uses = [
        (path.name, number, line.strip())
        for path in WORKFLOWS
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if re.match(r"\s*(-\s+)?uses:", line)
    ]
    assert uses, "the workflow uses no action"
    loose = [
        f"{name}:{number} {line}"
        for name, number, line in uses
        if not re.fullmatch(r"(-\s+)?uses: [\w.-]+/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+", line)
    ]
    assert not loose, f"an action named by a tag, or without its release beside the commit: {loose}"


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_ci_runs_on_a_named_ubuntu(path: Path) -> None:
    runners = re.findall(r"^\s*runs-on:\s*(\S+)", path.read_text(encoding="utf-8"), re.M)
    assert runners, "no job"
    assert all(re.fullmatch(r"ubuntu-\d\d\.\d\d", runner) for runner in runners), runners


def test_ci_sets_up_the_python_and_node_the_images_hold() -> None:
    """The backend's tests run on the image's Python, to the patch release;
    the frontend's on one exact Node of the image's major version."""
    backend = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    python = re.search(r"^FROM python:(\d+\.\d+\.\d+)-slim@", backend, re.M)
    node = re.search(r"^FROM node:(\d+)-alpine@", frontend, re.M)
    assert python and node
    text = "\n".join(path.read_text(encoding="utf-8") for path in WORKFLOWS)
    pythons = re.findall(r"python-version:\s*\"?([^\"\s]+)", text)
    nodes = re.findall(r"node-version:\s*\"?([^\"\s]+)", text)
    assert pythons and set(pythons) == {python.group(1)}, pythons
    assert nodes and len(set(nodes)) == 1, nodes
    assert re.fullmatch(rf"{node.group(1)}\.\d+\.\d+", nodes[0]), nodes


def test_the_image_and_ci_install_the_locks_by_hash() -> None:
    """With --require-hashes a lock line that lost its hash fails the install
    instead of passing unchecked."""
    dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert "pip install --no-deps --require-hashes -r requirements.lock" in dockerfile
    lines = [
        line.strip() for path in WORKFLOWS for line in path.read_text(encoding="utf-8").splitlines()
    ]
    lock = re.compile(r"pip install .*-r requirements(-dev)?\.lock")
    locks = [n for n, line in enumerate(lines) if lock.search(line)]
    assert locks, "CI installs no lock"
    for n in locks:
        assert lines[n].startswith("pip install --no-deps --require-hashes -r "), lines[n]
        # The backend itself, alone right after: pip checks no hash of an
        # editable install, so it may not share the locked one's command.
        assert re.fullmatch(r"pip install --no-deps -e \S+", lines[n + 1]), lines[n + 1]
