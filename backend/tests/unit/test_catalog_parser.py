"""Real store evidence plus adversarial cases; no database or catalog needed."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.modules.catalog.parser import PARSER_VERSION, parse_catalog_line

CORPUS = json.loads((Path(__file__).parents[1] / "fixtures/catalog_store_rows_v1.json").read_text())


def values(raw: str, field: str) -> list[str]:
    return [candidate.value for candidate in parse_catalog_line(raw).fields.get(field, ())]


@pytest.mark.parametrize("row", CORPUS["rows"], ids=lambda row: row["id"])
def test_real_rows_preserve_raw_and_exact_evidence(row: dict) -> None:
    raw = row["raw_text"]
    for field, expected in row.get("expected_candidates", {}).items():
        assert set(values(raw, field)) == set(expected)
    for field in row.get("absent_fields", []):
        assert not values(raw, field)
    for unknown in row.get("must_preserve_unknown", []):
        assert unknown in [part.text for part in parse_catalog_line(raw).unclassified_descriptors]
    parsed = parse_catalog_line(raw)
    assert parsed.raw_text == raw
    assert parsed.parser_version == PARSER_VERSION
    assert parsed.to_json() == parse_catalog_line(raw).to_json()
    assert json.loads(parsed.to_json()) == parsed.to_dict()
    for candidates in parsed.fields.values():
        for candidate in candidates:
            assert candidate.confidence in {"EXPLICIT", "AMBIGUOUS"}
            assert candidate.evidence
            for evidence in candidate.evidence:
                assert 0 <= evidence.start < evidence.end <= len(raw)
                assert raw[evidence.start : evidence.end] == evidence.text
    for part in (*parsed.option_groups, *parsed.unclassified_descriptors):
        assert raw[part.start : part.end] == part.text


def test_rare_known_item_code_does_not_become_quantity_price_or_size() -> None:
    parsed = parse_catalog_line("Куртка 1636")
    assert not parsed.fields.get("quantity")
    assert not parsed.fields.get("size")
    assert not parsed.fields.get("price")
    assert any(part.text == "1636" for part in parsed.unclassified_descriptors)


def test_pockets_are_not_a_stock_count() -> None:
    assert not values("Куртка 4 кармана Бордо", "quantity")
    assert not values("4 кармана", "size")


def test_quantity_is_not_a_product_identity() -> None:
    assert values("3 шт", "quantity") == ["3"]
    assert not values("3 шт", "garment_type")
    assert not values("3 куртки", "quantity")


def test_preposition_is_not_cyrillic_size() -> None:
    assert not values("Молочный пуховик с капюшоном", "size")
    assert values("Бомбер ботега 45 см шоколад С", "size") == ["S"]
    assert values("Жакет Л", "size") == ["L"]
    assert values("Дубленка парка Черная ХС", "size") == ["XS"]


@pytest.mark.parametrize("raw", ["Куртка -3 шт", "Куртка 1,5 шт", "Куртка 1.5 шт"])
def test_noninteger_or_signed_count_never_becomes_positive_suffix(raw: str) -> None:
    assert not values(raw, "quantity")


def test_range_does_not_become_one_precise_length() -> None:
    parsed = parse_catalog_line("Куртка 55-65 см")
    assert not parsed.fields.get("length_cm") or all(
        item.confidence == "AMBIGUOUS" for item in parsed.fields["length_cm"]
    )


def test_slash_enumeration_never_allocates_total_or_creates_aliases() -> None:
    parsed = parse_catalog_line("Лама бежевая/персик/butter 6 шт")
    assert parsed.option_groups
    assert parsed.quantity_distribution == "UNKNOWN_DISTRIBUTION"
    assert values(parsed.raw_text, "quantity") == ["6"]
    assert "aliases" not in parsed.to_dict()
    assert "allocations" not in parsed.to_dict()
    assert parsed.review_reasons


def test_conflicting_sizes_do_not_choose_a_winner() -> None:
    parsed = parse_catalog_line("Бомбер M L")
    assert set(values(parsed.raw_text, "size")) == {"M", "L"}
    assert all(c.confidence == "AMBIGUOUS" for c in parsed.fields["size"])


def test_raw_unicode_offsets_are_not_normalized_offsets() -> None:
    raw = "  ЧЁРНЫЙ\u00a0 бомбер\tМ   65 см  "
    parsed = parse_catalog_line(raw)
    assert parsed.raw_text == raw
    assert "  " not in parsed.normalized_text
    for candidates in parsed.fields.values():
        for candidate in candidates:
            for span in candidate.evidence:
                assert raw[span.start : span.end] == span.text


@pytest.mark.parametrize("raw", ["", " \t\n", "куртка\x00", "куртка\ud800", "а" * 2001])
def test_invalid_input_is_refused(raw: str) -> None:
    with pytest.raises(ValueError):
        parse_catalog_line(raw)


def test_unknown_version_is_not_silently_reinterpreted() -> None:
    with pytest.raises(ValueError):
        parse_catalog_line("Куртка", parser_version="future")


def test_serialization_is_stable_across_hash_seeds() -> None:
    code = (
        "from app.modules.catalog.parser import parse_catalog_line; "
        "print(parse_catalog_line('Бомбер M/L шоколад 3 шт').to_json())"
    )
    outputs = [
        subprocess.check_output(  # noqa: S603 — fixed source, current test interpreter
            [sys.executable, "-c", code], env={**os.environ, "PYTHONHASHSEED": seed}
        )
        for seed in ("1", "739")
    ]
    assert outputs[0] == outputs[1]


@pytest.mark.parametrize(
    "raw, unknown",
    [
        ("Куртка 3 шт-брак", "брак"),
        ("с капюшоном-оверсайз", "оверсайз"),
        ("55 см-оверсайз", "оверсайз"),
    ],
)
def test_partial_token_extraction_keeps_unknown_suffix(raw: str, unknown: str) -> None:
    parsed = parse_catalog_line(raw)
    assert any(unknown in descriptor.text for descriptor in parsed.unclassified_descriptors)
    assert parsed.review_reasons


@pytest.mark.parametrize("raw", ["- 3 шт", "−3 шт", "+3 шт", "Куртка 3/5 шт"])
def test_signed_or_fractional_quantity_never_yields_positive_suffix(raw: str) -> None:
    assert not values(raw, "quantity")


def test_slash_sizes_remain_review_candidates_without_stock_allocation() -> None:
    parsed = parse_catalog_line("Бомбер L/XL")
    assert parsed.option_groups
    assert parsed.quantity_distribution == "UNKNOWN_DISTRIBUTION"
    assert all(candidate.confidence == "AMBIGUOUS" for candidate in parsed.fields["size"])


@pytest.mark.parametrize(
    "raw",
    [row["raw_text"] for row in CORPUS["rows"]]
    + [
        "55 см-оверсайз",
        "3 шт-брак",
        "с капюшоном-оверсайз",
        "4 кармана-кожа",
        "  ЧЁРНЫЙ\u00a0бoмбер 55-65 см",
        "не черная",
        "🙂 куртка\tМ",
    ],
)
def test_every_alphanumeric_character_remains_explained(raw: str) -> None:
    parsed = parse_catalog_line(raw)
    spans = [
        evidence
        for candidates in parsed.fields.values()
        for candidate in candidates
        for evidence in candidate.evidence
    ]
    covered = {
        i
        for span in [*spans, *parsed.option_groups, *parsed.unclassified_descriptors]
        for i in range(span.start, span.end)
    }
    assert {i for i, char in enumerate(raw) if char.isalnum()} <= covered


def test_direct_negation_cannot_be_an_explicit_positive_color() -> None:
    parsed = parse_catalog_line("Куртка не черная")
    assert all(candidate.confidence == "AMBIGUOUS" for candidate in parsed.fields["color"])
    assert "NEGATED_DESCRIPTOR" in parsed.review_reasons


def test_one_recognized_color_in_slash_is_still_ambiguous() -> None:
    parsed = parse_catalog_line("черный/неизвестный")
    assert all(candidate.confidence == "AMBIGUOUS" for candidate in parsed.fields["color"])


def test_preview_cli_preserves_input_and_needs_no_database() -> None:
    raw = "Куртка 1636\n"
    completed = subprocess.run(
        [sys.executable, "-m", "scripts.preview_catalog"],
        input=raw,
        text=True,
        capture_output=True,
        check=True,
    )
    assert json.loads(completed.stdout)["raw_text"] == raw
    assert completed.stderr == ""


def test_preview_cli_rejects_empty_input_without_traceback() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "scripts.preview_catalog"],
        input="",
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 2
    assert not completed.stdout
    assert "Traceback" not in completed.stderr
