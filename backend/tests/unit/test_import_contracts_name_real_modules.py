"""Every module the import contracts name exists (ADR-0012, B15).

import-linter refuses a contract whose *source* module is missing, but a
missing *forbidden* module it skips without a word: a contract forbidding
`app.modules.cash.servise` would be kept forever and check nothing. So every
module named in `pyproject.toml`'s contracts is imported here, and a typo, a
renamed file or a stub never written turns this red.
"""

from __future__ import annotations

import importlib
import tomllib
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _named_modules() -> list[str]:
    config = tomllib.loads((BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    named: set[str] = set()
    for contract in config["tool"]["importlinter"]["contracts"]:
        for key in ("source_modules", "forbidden_modules", "layers"):
            named.update(contract.get(key, []))
    return sorted(named)


def test_the_contracts_name_modules_at_all() -> None:
    """A parsing slip here would make the test below check nothing either."""
    assert "app.modules.cash.service" in _named_modules()


@pytest.mark.parametrize("module", _named_modules())
def test_a_module_a_contract_names_exists(module: str) -> None:
    importlib.import_module(module)
