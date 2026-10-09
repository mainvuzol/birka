"""The server installs exactly the packages CI tested.

pyproject.toml says what the backend needs, mostly as lower bounds. On their
own those let every fresh install take whatever PyPI has that day: on
2026-09-25 a fresh CI install took SQLAlchemy 2.1.1 through an unbounded
`>=` and type checking broke. The server's image would have done the same at
its next build, with nothing to run against it. So:

- requirements.lock pins every package the runtime needs on Linux, and
  backend/Dockerfile installs it and nothing else (`--no-deps`);
- requirements-dev.lock is that set plus the test and lint tools, and CI
  installs it the same way, then the backend alone;
- both hold the sha256 of each file PyPI has for a version, and are
  installed with --require-hashes, so a file replaced under the same version
  is refused (owner, 2026-10-10; ADR-0019).

These tests keep the two files honest without a network: each pin satisfies
pyproject.toml, the files agree with each other, they hold the whole
dependency closure and nothing more, and the packages installed here are the
locked versions, so a green CI run is a run on what the server will install.
"""

from __future__ import annotations

import re
import tomllib
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path

import pytest
from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
PYPROJECT = BACKEND_ROOT / "pyproject.toml"
RUNTIME_LOCK = BACKEND_ROOT / "requirements.lock"
DEV_LOCK = BACKEND_ROOT / "requirements-dev.lock"
DOCKERFILE = BACKEND_ROOT / "Dockerfile"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"

# Installed in a developer's environment for local tooling (pgserver runs the
# local PostgreSQL), never asked for by pyproject.toml. Freezing an environment
# without filtering would carry them into a lock, and from there to the server.
LOCAL_ONLY = ("pgserver", "fasteners", "psutil")

_COMMENT = re.compile(r"(^|\s+)#.*$")


def read_lock(path: Path) -> dict[str, Requirement]:
    """A lock file's pins by normalized name, read the way pip reads it.

    Comments and blank lines are dropped, a line ending in a backslash goes
    on, and `--hash` options are set aside. Every remaining line must pin one
    exact version, and no package may appear twice.
    """
    joined: list[str] = []
    pending = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        if raw.endswith("\\") and not _COMMENT.search(raw):
            pending += raw[:-1] + " "
            continue
        joined.append(pending + raw)
        pending = ""
    joined.append(pending)

    pins: dict[str, Requirement] = {}
    for line in joined:
        text = _COMMENT.sub("", line).strip()
        if not text:
            continue
        text = " ".join(part for part in text.split() if not part.startswith("--hash"))
        requirement = Requirement(text)
        specifiers = list(requirement.specifier)
        assert len(specifiers) == 1 and specifiers[0].operator == "==", (
            f"{path.name}: {text!r} does not pin one exact version"
        )
        assert "*" not in specifiers[0].version, f"{path.name}: {text!r} pins a wildcard"
        name = canonicalize_name(requirement.name)
        assert name not in pins, f"{path.name}: {name} appears twice"
        pins[name] = requirement
    return pins


def pinned(requirement: Requirement) -> str:
    return next(iter(requirement.specifier)).version


def read_hashes(path: Path) -> dict[str, set[str]]:
    """Each pin's `--hash=sha256:` values, by normalized name."""
    text = path.read_text(encoding="utf-8").replace("\\\n", " ")
    hashes: dict[str, set[str]] = {}
    for line in text.splitlines():
        match = re.match(r"([A-Za-z0-9][A-Za-z0-9._-]*)==\S+(.*)", _COMMENT.sub("", line))
        if match:
            found = re.findall(r"--hash=sha256:([0-9a-f]{64})\b", match.group(2))
            hashes[canonicalize_name(match.group(1))] = set(found)
    return hashes


def pyproject_requirements(group: str) -> list[Requirement]:
    """`runtime` is [project].dependencies; anything else is that extra."""
    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]
    if group == "runtime":
        return [Requirement(line) for line in project["dependencies"]]
    return [Requirement(line) for line in project["optional-dependencies"][group]]


def this_environment() -> dict[str, str]:
    """Marker values as this interpreter sees them."""
    return {key: str(value) for key, value in default_environment().items()}


def image_environment() -> dict[str, str]:
    """Marker values as the server's image sees them: Linux, CPython, and the
    Python release backend/Dockerfile names."""
    match = re.search(r"^FROM python:(\d+)\.(\d+)\.(\d+)-", DOCKERFILE.read_text(), re.MULTILINE)
    assert match, "backend/Dockerfile does not name an exact Python release"
    major, minor, patch = match.groups()
    environment = this_environment()
    environment.update(
        os_name="posix",
        sys_platform="linux",
        platform_system="Linux",
        platform_machine="x86_64",
        platform_release="",
        platform_version="",
        implementation_name="cpython",
        platform_python_implementation="CPython",
        implementation_version=f"{major}.{minor}.{patch}",
        python_version=f"{major}.{minor}",
        python_full_version=f"{major}.{minor}.{patch}",
    )
    return environment


def applies(requirement: Requirement, environment: dict[str, str], extras: set[str]) -> bool:
    """Whether a requirement holds under these markers, for these extras."""
    if requirement.marker is None:
        return True
    return any(
        requirement.marker.evaluate({**environment, "extra": extra}) for extra in ("", *extras)
    )


def closure(roots: list[Requirement], environment: dict[str, str]) -> dict[str, str | None]:
    """Every package the roots reach under these markers, read from the
    installed packages' own metadata: name -> installed version, or None for
    one that is not installed here (whose own dependencies stay unknown)."""
    found: dict[str, str | None] = {}
    extras_of: dict[str, set[str]] = {}
    pending = [root for root in roots if applies(root, environment, set())]
    while pending:
        requirement = pending.pop()
        name = canonicalize_name(requirement.name)
        extras = set(requirement.extras)
        if name in found and extras <= extras_of[name]:
            continue
        extras_of[name] = extras_of.get(name, set()) | extras
        try:
            installed = distribution(requirement.name)
        except PackageNotFoundError:
            found[name] = None
            continue
        found[name] = installed.version
        for line in installed.requires or []:
            dependency = Requirement(line)
            if applies(dependency, environment, extras_of[name]):
                pending.append(dependency)
    return found


def on_linux(pins: dict[str, Requirement]) -> set[str]:
    """The names a lock installs on the image (a universal lock may carry
    pins for other platforms)."""
    environment = image_environment()
    return {name for name, pin in pins.items() if applies(pin, environment, set())}


LOCKS = {
    "requirements.lock": (RUNTIME_LOCK, ["runtime"]),
    "requirements-dev.lock": (DEV_LOCK, ["runtime", "dev"]),
}


@pytest.mark.parametrize("lock_name", LOCKS)
def test_every_requirement_is_satisfied_by_its_pin(lock_name: str) -> None:
    """A pin outside pyproject's range would install something it rules out."""
    path, groups = LOCKS[lock_name]
    pins = read_lock(path)
    for group in groups:
        for requirement in pyproject_requirements(group):
            name = canonicalize_name(requirement.name)
            assert name in pins, f"{lock_name} has no pin for {requirement}"
            version = pinned(pins[name])
            assert requirement.specifier.contains(version, prereleases=True), (
                f"{lock_name} pins {name}=={version}, outside pyproject's {requirement}"
            )


@pytest.mark.parametrize("lock_name", LOCKS)
def test_exact_pins_in_pyproject_are_the_locked_ones(lock_name: str) -> None:
    """ruff, mypy and import-linter (and SQLAlchemy) are pinned exactly on
    purpose; the lock must not move them on its own."""
    path, groups = LOCKS[lock_name]
    pins = read_lock(path)
    for group in groups:
        for requirement in pyproject_requirements(group):
            exact = [s.version for s in requirement.specifier if s.operator == "=="]
            if exact:
                name = canonicalize_name(requirement.name)
                assert pinned(pins[name]) == exact[0], (
                    f"pyproject pins {name}=={exact[0]}, {lock_name} {pinned(pins[name])}"
                )


def test_the_dev_lock_is_the_runtime_lock_plus_tools() -> None:
    """CI tests with the dev lock and the server installs the runtime one: a
    runtime package at another version in each would make CI's green prove
    nothing about the server."""
    runtime, dev = read_lock(RUNTIME_LOCK), read_lock(DEV_LOCK)
    missing = sorted(runtime.keys() - dev.keys())
    assert not missing, f"in requirements.lock but not requirements-dev.lock: {missing}"
    differ = {name: (pinned(runtime[name]), pinned(dev[name])) for name in runtime}
    differ = {name: pair for name, pair in differ.items() if pair[0] != pair[1]}
    assert not differ, f"runtime pins differ between the two locks: {differ}"


@pytest.mark.parametrize("lock_name", LOCKS)
def test_no_local_tool_reaches_a_lock(lock_name: str) -> None:
    pins = read_lock(LOCKS[lock_name][0])
    leaked = [name for name in LOCAL_ONLY if name in pins]
    assert not leaked, f"{lock_name} holds local tools pyproject.toml never asks for: {leaked}"


@pytest.mark.parametrize("lock_name", LOCKS)
def test_a_lock_is_the_whole_closure_and_nothing_else(lock_name: str) -> None:
    """With --no-deps nothing fills a gap: a package the closure needs and the
    lock lacks would be missing from the image (`pip check` fails its build).
    A package the closure does not need is one nobody reviews."""
    path, groups = LOCKS[lock_name]
    roots = [r for group in groups for r in pyproject_requirements(group)]
    reached = closure(roots, image_environment())
    locked = on_linux(read_lock(path))

    unlocked = sorted(reached.keys() - locked)
    assert not unlocked, f"needed on the server but not in {lock_name}: {unlocked}"
    # A package not installed here hides its own dependencies, so only a
    # complete walk can say that the lock holds nothing more.
    if all(version is not None for version in reached.values()):
        extra = sorted(locked - reached.keys())
        assert not extra, f"in {lock_name} but nothing in pyproject.toml needs it: {extra}"


def test_the_installed_packages_are_the_locked_versions() -> None:
    """The tests in this run ran against the locked versions, so the image,
    which installs the same pins, runs what was tested. Read with this
    machine's own markers: a package only another platform needs (colorama on
    Windows) is not the server's and is not checked."""
    pins = read_lock(DEV_LOCK)
    roots = pyproject_requirements("runtime") + pyproject_requirements("dev")
    installed = closure(roots, this_environment())

    not_installed = sorted(name for name, version in installed.items() if version is None)
    assert not not_installed, f"needed by pyproject.toml, not installed: {not_installed}"
    drifted = {
        name: f"installed {version}, locked {pinned(pins[name])}"
        for name, version in installed.items()
        if name in pins and version != pinned(pins[name])
    }
    assert not drifted, f"this environment is not the locked one: {drifted}"


def test_the_image_installs_the_lock_and_only_the_lock() -> None:
    """`pip install .` resolved pyproject's ranges afresh at every build; it is
    what the lock replaces, and it must not come back beside it."""
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")
    assert re.search(r"^COPY requirements\.lock ", dockerfile, re.MULTILINE)
    installs = [found.strip() for found in re.findall(r"pip install[^\n&;]*", dockerfile)]
    assert installs == ["pip install --no-deps --require-hashes -r requirements.lock"], installs


def test_ci_installs_the_backend_with_a_lock() -> None:
    """Every CI job that installs the backend installs a lock first, by hash,
    and then the backend alone, so what CI tests is what the image installs."""
    lines = [line.strip() for line in CI_WORKFLOW.read_text(encoding="utf-8").splitlines()]
    backends = [n for n, line in enumerate(lines) if "pip install" in line and " -e " in line]
    assert backends, "CI no longer installs the backend with pip"
    for n in backends:
        assert lines[n].startswith("pip install --no-deps -e "), (
            f"the backend brings its own dependencies: {lines[n]}"
        )
        lock = r"pip install --no-deps --require-hashes -r requirements(-dev)?\.lock"
        assert re.fullmatch(lock, lines[n - 1]), f"no lock installed before it: {lines[n - 1]}"


@pytest.mark.parametrize("lock_name", LOCKS)
def test_every_pin_carries_its_hashes(lock_name: str) -> None:
    """--require-hashes refuses a pin without one, so a lost hash fails the
    install; this says which, before a build gets there."""
    hashes = read_hashes(BACKEND_ROOT / lock_name)
    assert hashes.keys() == read_lock(BACKEND_ROOT / lock_name).keys()
    bare = sorted(name for name, found in hashes.items() if not found)
    assert not bare, f"{lock_name}: pins without a hash: {bare}"


def test_both_locks_hold_the_same_hashes_for_a_runtime_pin() -> None:
    """The server's files are the ones CI's tests ran on."""
    runtime, dev = read_hashes(RUNTIME_LOCK), read_hashes(DEV_LOCK)
    differ = sorted(name for name in runtime if runtime[name] != dev.get(name))
    assert not differ, f"hashes differ between the two locks: {differ}"
