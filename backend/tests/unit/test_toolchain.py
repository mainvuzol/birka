"""The formatter that runs at commit time must be the one CI checks with.

This exists because of a real failure: `.pre-commit-config.yaml` pinned ruff
v0.6.9 while the project used 0.16.7. The hook reformatted files in the old
style *during* `git commit`, and CI then rejected exactly those files. A guard
that reliably breaks the build is worse than no guard, and nothing pointed at
the cause — the two versions simply lived in different files.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
PYPROJECT = BACKEND_ROOT / "pyproject.toml"
PRE_COMMIT = REPO_ROOT / ".pre-commit-config.yaml"


def pinned_version(package: str) -> str:
    """The exact version pinned for a dev tool in pyproject.toml."""
    data = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    dev = data["project"]["optional-dependencies"]["dev"]
    for requirement in dev:
        if requirement.startswith(f"{package}=="):
            return requirement.split("==", 1)[1]
    raise AssertionError(f"{package} is not pinned exactly in the dev extra")


def pre_commit_rev(repo_fragment: str) -> str:
    """The `rev:` pinned for a pre-commit repo, read without a YAML parser."""
    text = PRE_COMMIT.read_text(encoding="utf-8")
    match = re.search(rf"repo:\s*\S*{re.escape(repo_fragment)}\S*\s*\n\s*rev:\s*(\S+)", text)
    assert match, f"no rev found for {repo_fragment}"
    return match.group(1).lstrip("v")


@pytest.mark.parametrize("tool", ["ruff", "mypy", "import-linter"])
def test_output_sensitive_tools_are_pinned_exactly(tool: str) -> None:
    """`>=` on a formatter means CI and the developer can disagree."""
    assert pinned_version(tool)


def test_pre_commit_ruff_matches_the_project_ruff() -> None:
    """The failure this module exists to prevent."""
    assert pre_commit_rev("ruff-pre-commit") == pinned_version("ruff"), (
        "the ruff in .pre-commit-config.yaml and the one in pyproject.toml "
        "have drifted — the commit hook will format code that CI rejects"
    )


def test_installed_ruff_matches_the_pin() -> None:
    """Catches a stale virtualenv before it produces a confusing CI failure."""
    from importlib.metadata import version

    assert version("ruff") == pinned_version("ruff")


def test_installed_mypy_matches_the_pin() -> None:
    from importlib.metadata import version

    assert version("mypy") == pinned_version("mypy")
