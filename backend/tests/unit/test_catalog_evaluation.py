"""Invalid evaluation evidence must not silently produce a green report."""

import json

import pytest
from scripts.evaluate_catalog import DEFAULT_DATASET, Dataset, parser_report


@pytest.mark.parametrize("fault", ["empty", "duplicate", "unknown_key", "misspelled_field"])
def test_parser_corpus_rejects_missing_or_misspelled_assertions(tmp_path, fault):
    row = {"id": "one", "raw_text": "Куртка", "expected_candidates": {"garment_type": ["jacket"]}}
    data = {"corpus_version": "test", "provenance": "synthetic", "rows": [row]}
    if fault == "empty":
        data["rows"] = []
    elif fault == "duplicate":
        data["rows"] = [row, row]
    elif fault == "unknown_key":
        row["expected_candidate"] = row.pop("expected_candidates")
    else:
        row["absent_fields"] = ["quantitty"]
    path = tmp_path / "corpus.json"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        parser_report(path)


def test_unannotated_rows_are_excluded_from_extraction_accuracy(tmp_path):
    path = tmp_path / "corpus.json"
    path.write_text(
        json.dumps(
            {
                "corpus_version": "test",
                "provenance": "synthetic",
                "rows": [{"id": "one", "raw_text": "Куртка"}],
            }
        )
    )
    report = parser_report(path)
    assert report["unannotated_rows"] == 1
    assert report["assertions"] == 0
    assert report["assertion_accuracy"] is None
    assert report["raw_preserved_rows"] == 1


@pytest.mark.parametrize("fault", ["classification", "family", "new_model"])
def test_inconsistent_catalog_declarations_are_rejected(fault):
    data = json.loads(DEFAULT_DATASET.read_text())
    if fault == "classification":
        data["products"][2]["business_category"] = "Different"
    elif fault == "family":
        data["products"][1]["family"] = "laurent"
    else:
        data["products"][2]["distinction_note"] = None
    with pytest.raises(ValueError):
        Dataset.model_validate(data)
