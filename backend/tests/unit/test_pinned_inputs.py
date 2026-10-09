"""Everything the server is built from is named exactly, so it is what CI ran.

Owner decision, 2026-10-10 (ADR-0019): a tag such as `caddy:2-alpine` is
rebuilt in place now and then, `actions/checkout@v4` moves with each v4
release, `ubuntu-latest` becomes a new Ubuntu (26.04, from 2026-10-19), and a
version on PyPI is a name, not a file. Each was a way for the server, or the
CI that vouches for it, to get something nobody tested. So:

- every image is pinned by its digest, the multi-arch index, and a name and
  tag carry one digest wherever they appear;
- every GitHub Action is pinned by a commit, its release named beside it;
- CI runs on a named Ubuntu, with the image's Python and the Node release
  the web image's Dockerfile names;
- the Python locks hold a hash for each file (test_dependency_lock.py), and
  the image and CI install them with --require-hashes.

Nothing here reaches a registry; moving a pin is the server runbook's "a
pinned version, changed on purpose".
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
GITHUB = ROOT / ".github"
WORKFLOWS = sorted([*(GITHUB / "workflows").glob("*.yml"), *(GITHUB / "workflows").glob("*.yaml")])
ACTIONS = sorted([*GITHUB.glob("actions/**/action.yml"), *GITHUB.glob("actions/**/action.yaml")])
DOCKERFILES = [ROOT / "backend" / "Dockerfile", ROOT / "frontend" / "Dockerfile"]
COMPOSE = [ROOT / "infra" / "docker-compose.yml", ROOT / "infra" / "docker-compose.dev.yml"]
TEXT = DOCKERFILES + COMPOSE + WORKFLOWS + ACTIONS

DIGEST = re.compile(r"@sha256:[0-9a-f]{64}$")
# The outside images Birka is built from or runs, wherever they are named in
# text (a `docker run` in a workflow step, too), with or without Docker Hub's
# own prefix. Compose's and CI's `image:` keys and every Dockerfile's FROM
# are checked for any image at all, below.
IMAGES = ("postgres", "caddy", "node", "alpine", "python")
_IMAGE = re.compile(
    rf"(?<![\w./-])(?:docker\.io/(?:library/)?)?((?:{'|'.join(IMAGES)}):[\w.-]+)(@sha256:[0-9a-f]{{64}})?"
)
_COMMENT = re.compile(r"(^|\s)#.*$")


def _code(path: Path) -> list[tuple[int, str]]:
    """The file's lines without their comments, which may name a tag in prose."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return [(n, _COMMENT.sub("", line)) for n, line in enumerate(lines, 1)]


def _yaml(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8"))
    return loaded


def _image_refs() -> list[tuple[str, int, str, str | None]]:
    found = []
    for path in TEXT:
        for number, line in _code(path):
            for match in _IMAGE.finditer(line):
                name, digest = match.group(1), match.group(2)
                found.append((path.relative_to(ROOT).as_posix(), number, name, digest))
    return found


def test_every_image_compose_runs_is_pinned_by_its_digest() -> None:
    """Any image, not only today's: a service compose pulls rather than
    builds names its digest."""
    loose = [
        f"{path.name}: {name}: {svc.get('image')!r}"
        for path in COMPOSE
        for name, svc in _yaml(path)["services"].items()
        if "build" not in svc and not DIGEST.search(str(svc.get("image", "")))
    ]
    assert not loose, f"pulled by tag alone: {loose}"


def test_every_image_ci_starts_is_pinned_by_its_digest() -> None:
    loose = []
    for path in WORKFLOWS:
        for job, definition in _yaml(path)["jobs"].items():
            images = [
                str(svc.get("image", "")) for svc in (definition.get("services") or {}).values()
            ]
            container = definition.get("container")
            if isinstance(container, dict):
                container = container.get("image", "")
            if container:
                images.append(str(container))
            loose += [
                f"{path.name}: {job}: {image!r}" for image in images if not DIGEST.search(image)
            ]
    assert not loose, f"started by tag alone: {loose}"


def test_every_dockerfile_base_is_pinned_or_a_stage() -> None:
    for path in DOCKERFILES:
        stages: set[str] = set()
        for _, line in _code(path):
            match = re.match(r"\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?", line, re.I)
            if not match:
                continue
            base, alias = match.group(1), match.group(2)
            assert base in stages or DIGEST.search(base), (path.name, base)
            if alias:
                stages.add(alias)


def test_every_known_image_named_in_text_is_pinned() -> None:
    """A `docker run` of one in a workflow step, too."""
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


def test_every_action_is_pinned_by_a_commit() -> None:
    """A local action (`./…`) is this repository's own, pinned by the commit;
    a Docker one names its digest."""
    uses = [
        (path.name, number, line.strip())
        for path in WORKFLOWS + ACTIONS
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if re.match(r"\s*(-\s+)?uses:", line)
    ]
    assert uses, "the workflow uses no action"
    pinned = re.compile(
        r"(-\s+)?uses: (?:[\w.-]+/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+"
        r"|\./[\w./-]+|docker://\S+@sha256:[0-9a-f]{64})"
    )
    loose = [f"{name}:{number} {line}" for name, number, line in uses if not pinned.fullmatch(line)]
    assert not loose, f"an action named by a tag, or without its release beside the commit: {loose}"


@pytest.mark.parametrize("path", WORKFLOWS, ids=lambda p: p.name)
def test_ci_runs_on_a_named_ubuntu(path: Path) -> None:
    runners = [str(job.get("runs-on")) for job in _yaml(path)["jobs"].values()]
    assert runners, "no job"
    assert all(re.fullmatch(r"ubuntu-\d\d\.\d\d", runner) for runner in runners), runners


def test_ci_sets_up_the_python_and_node_the_images_hold() -> None:
    """The backend's tests run on the image's Python, to the patch release
    its tag names; the frontend's on the Node release the web image's
    Dockerfile says its pinned `node` holds (read from the image when it was
    pinned; whoever moves the digest updates both)."""
    backend = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    python = re.search(r"^FROM python:(\d+\.\d+\.\d+)-slim@", backend, re.M)
    node_major = re.search(r"^FROM node:(\d+)-alpine@", frontend, re.M)
    node = re.findall(r"\bNode (\d+\.\d+\.\d+)\b", frontend)
    assert python and node_major and len(set(node)) == 1, (python, node_major, node)
    assert node[0].split(".")[0] == node_major.group(1), (node, node_major.group(1))
    text = "\n".join(path.read_text(encoding="utf-8") for path in WORKFLOWS + ACTIONS)
    pythons = re.findall(r"python-version:\s*\"?([^\"\s]+)", text)
    nodes = re.findall(r"node-version:\s*\"?([^\"\s]+)", text)
    assert pythons and set(pythons) == {python.group(1)}, pythons
    assert nodes and set(nodes) == {node[0]}, nodes


def test_the_image_and_ci_install_the_locks_by_hash() -> None:
    """With --require-hashes a lock line that lost its hash fails the install
    instead of passing unchecked."""
    dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    assert "pip install --no-deps --require-hashes -r requirements.lock" in dockerfile
    lines = [
        line.strip()
        for path in WORKFLOWS + ACTIONS
        for line in path.read_text(encoding="utf-8").splitlines()
    ]
    lock = re.compile(r"pip install .*-r requirements(-dev)?\.lock")
    locks = [n for n, line in enumerate(lines) if lock.search(line)]
    assert locks, "CI installs no lock"
    for n in locks:
        assert lines[n].startswith("pip install --no-deps --require-hashes -r "), lines[n]
        # The backend itself, alone right after: pip checks no hash of an
        # editable install, so it may not share the locked one's command.
        assert re.fullmatch(r"pip install --no-deps -e \S+", lines[n + 1]), lines[n + 1]
