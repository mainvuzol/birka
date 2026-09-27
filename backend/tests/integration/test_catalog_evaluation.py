"""Real matcher evaluation is reproducible and leaves no seeded catalog behind."""

from __future__ import annotations

import json
import os
from dataclasses import replace

import pytest
from scripts import evaluate_catalog as evaluation
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.modules.tenancy.models import Organization
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def count(session):
    return await session.scalar(select(func.count()).select_from(Organization))


async def test_real_evaluation_is_repeatable_and_rolls_back_seed(maker):
    async with maker() as session:
        before = await count(session)
        first = await evaluation.evaluate_catalog(session)
        assert await count(session) == before
        second = await evaluation.evaluate_catalog(session)
        assert first == second
        assert first["gates_passed"]
        assert not first["promotion_ready"]
        assert first["owner_reviewed_heldout_identity_precision"] is None
        assert first["real_store_extraction"]["excluded_from_identity_metrics"] == 44
        assert first["synthetic_identity"]["unsafe_same_variant_suggestions"] == 0
        assert first["synthetic_identity"]["human_review_rate"] == "1.000000"
        await session.commit()
    async with maker() as session:
        assert await count(session) == before


@pytest.mark.parametrize(
    "fault", ["wrong_top", "confirmation", "missing_conflict", "missing_target"]
)
async def test_regression_gates_fail_closed(maker, monkeypatch, fault):
    real_preview = evaluation.preview_match

    async def broken(*args, **kwargs):
        result = await real_preview(*args, **kwargs)
        if fault == "wrong_top" and result.decision_type == "SAME_VARIANT":
            return replace(result, candidates=list(reversed(result.candidates)))
        if fault == "confirmation":
            return replace(result, requires_confirmation=False)
        if fault == "missing_conflict":
            return replace(result, candidates=[{**c, "conflicts": []} for c in result.candidates])
        if fault == "missing_target":
            return replace(result, candidates=[])
        return result

    monkeypatch.setattr(evaluation, "preview_match", broken)
    async with maker() as session:
        before = await count(session)
        result = await evaluation.evaluate_catalog(session)
        assert not result["gates_passed"]
        failures = str(result["synthetic_identity"]["failures"])
        expected = {
            "wrong_top": "UNSAFE_SAME_VARIANT_SUGGESTION",
            "confirmation": "CONFIRMATION_REQUIREMENT_LOWERED",
            "missing_conflict": "EXPECTED_CONFLICT_MISSING",
            "missing_target": "TARGET_NOT_RETRIEVED",
        }
        assert expected[fault] in failures
        assert await count(session) == before


async def test_exception_rolls_back_all_evaluation_writes(maker, monkeypatch):
    async def failure(*args, **kwargs):
        raise RuntimeError("Synthetic evaluation failure")

    monkeypatch.setattr(evaluation, "preview_match", failure)
    async with maker() as session:
        before = await count(session)
        with pytest.raises(RuntimeError, match="Synthetic"):
            await evaluation.evaluate_catalog(session)
        assert await count(session) == before
        await session.commit()
    async with maker() as session:
        assert await count(session) == before


async def test_empty_identity_denominators_are_unavailable_and_gate_fails(maker, tmp_path):
    path = tmp_path / "empty.json"
    data = json.loads(evaluation.DEFAULT_DATASET.read_text())
    data["cases"] = []
    path.write_text(json.dumps(data))
    async with maker() as session:
        result = await evaluation.evaluate_catalog(session, path)
        metrics = result["synthetic_identity"]
        assert not result["gates_passed"]
        assert metrics["decision_accuracy"] is None
        assert metrics["retrieval_recall_at_10"] is None
        assert metrics["unsafe_same_suggestion_rate"] is None


@pytest.mark.parametrize("fault", ["duplicate", "unknown_target", "missing_same_target"])
async def test_invalid_dataset_fails_before_seeding(maker, tmp_path, fault):
    data = json.loads(evaluation.DEFAULT_DATASET.read_text())
    if fault == "duplicate":
        data["cases"].append(data["cases"][0])
    elif fault == "unknown_target":
        data["cases"][0]["target"] = "unknown"
    else:
        data["cases"][0].pop("target")
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(data))
    async with maker() as session:
        before = await count(session)
        with pytest.raises(ValueError):
            await evaluation.evaluate_catalog(session, path)
        assert await count(session) == before


async def test_cli_rejects_unsafe_database_names_and_remote_hosts(monkeypatch, tmp_path):
    for url in (
        "postgresql+asyncpg://localhost/production",
        "postgresql+asyncpg://remote.example/birka_test",
    ):
        monkeypatch.setenv("BIRKA_TEST_DATABASE_URL", url)
        with pytest.raises(ValueError, match="localhost"):
            await evaluation._run(tmp_path / "report.json")
    assert not (tmp_path / "report.json").exists()
