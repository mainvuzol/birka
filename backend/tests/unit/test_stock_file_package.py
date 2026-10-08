"""The format package parser authors get: `formats/birka-stock-list/` (ADR-0014 §1).

The package is a description, a JSON Schema, an example and a reference
validator (`scripts/check_stock_file.py`). None of it may drift from what the
server accepts:

- the published schema is the server model's own, byte for byte;
- the example is a file the server takes, and each of its lines is what the
  description says Birka makes of it;
- the validator says OK exactly when the server would take the file, and
  refuses, line by line, what a schema cannot say. The one place it is
  stricter on purpose is a key written twice, which JSON parsing on the
  server silently resolves, and which the phone refuses before it sends
  (ADR-0014 §15).
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from scripts import check_stock_file as validator

from app.api.v1.snapshots import AddPartRequest, ImportRequest
from app.modules.catalog.parser import parse_catalog_line
from app.modules.snapshots.file_lines import (
    FILE_COUNT_HINT,
    FILE_NOTE,
    FILE_SPLIT_NOT_IN_TEXT,
    countless,
    file_line_evidence,
)
from app.modules.snapshots.models import SnapshotQuantityState
from app.modules.snapshots.stock_file import (
    MAX_PART_BYTES,
    MAX_PART_LINES,
    MAX_PART_TEXT_CHARS,
    MESSAGES,
    StockFileV1,
    load_stock_file_text,
)

PACKAGE = Path(__file__).resolve().parents[3] / "formats" / "birka-stock-list"
SCHEMA = PACKAGE / "birka-stock-list-v1.schema.json"
EXAMPLE = PACKAGE / "example-v1.json"
DESCRIPTION = PACKAGE / "README.md"

KNOWN = SnapshotQuantityState.KNOWN
UNKNOWN_DISTRIBUTION = SnapshotQuantityState.UNKNOWN_DISTRIBUTION
UNKNOWN_QUANTITY = SnapshotQuantityState.UNKNOWN_QUANTITY

# A character UTF-8 writes in four bytes: the quickest way past the byte bound.
WIDE = "𝕄"


def a_line(number: int = 1) -> dict[str, Any]:
    return {"text": "Лоран шоколад M-1 L-2", "photo": "IMG_0001.jpg", "photo_line": number}


def a_file(*lines: dict[str, Any]) -> dict[str, Any]:
    return {"format": "birka.stock-list", "version": 1, "lines": list(lines) or [a_line()]}


def written(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def run(capsys: pytest.CaptureFixture[str], tmp_path: Path, raw: bytes) -> tuple[int, str]:
    path = tmp_path / "file.json"
    path.write_bytes(raw)
    code = validator.main([str(path)])
    return code, capsys.readouterr().out


def the_server_takes(text: str) -> tuple[bool, set[str]]:
    """What the API does with a body holding this file: FastAPI parses the
    body with `json.loads`, then validates the request model."""
    try:
        data = json.loads(text.removeprefix("\ufeff"))
    except ValueError:
        return False, {"json_invalid"}
    body = {
        "command_id": str(uuid.uuid4()),
        "store_id": str(uuid.uuid4()),
        "location_id": str(uuid.uuid4()),
        "file": data,
        "file_name": "зошит.json",
    }
    try:
        ImportRequest.model_validate(body)
        AddPartRequest.model_validate(
            {key: body[key] for key in ("command_id", "file", "file_name")}
        )
    except ValidationError as refused:
        return False, {error["type"] for error in refused.errors(include_url=False)}
    return True, set()


def the_validator_takes(text: str) -> tuple[bool, set[str]]:
    try:
        load_stock_file_text(text)
    except ValidationError as refused:
        return False, {error["type"] for error in refused.errors(include_url=False)}
    return True, set()


# ---------------------------------------------------------------------------
# The schema and the example
# ---------------------------------------------------------------------------


def test_the_published_schema_is_the_server_model() -> None:
    published = SCHEMA.read_bytes()
    assert published == validator.schema_text().encode("utf-8"), (
        "regenerate it: python -m scripts.check_stock_file --schema > "
        "../formats/birka-stock-list/birka-stock-list-v1.schema.json"
    )
    assert json.loads(published) == StockFileV1.model_json_schema(by_alias=True)


def test_the_published_example_is_a_valid_file() -> None:
    text = EXAMPLE.read_text(encoding="utf-8")
    example = load_stock_file_text(text)
    assert example.price_kind == "purchase"
    assert example.schema_ == "./" + SCHEMA.name
    assert (PACKAGE / example.schema_).resolve() == SCHEMA.resolve()
    assert the_server_takes(text) == (True, set())


# What the description says Birka makes of each kind of line in the example:
# (text, state, total, the split the text shows, the file's reasons).
WHAT_BIRKA_MAKES_OF_THE_EXAMPLE = [
    # A heading, passed on with a note.
    ("Куртки жіночі", UNKNOWN_QUANTITY, None, None, (FILE_NOTE,)),
    # A count with «шт», agreeing with the file: stated.
    ("Лоран шоколад M 3 шт 1850", KNOWN, 3, None, ()),
    # A table line without «шт»: the file's count is only a hint.
    ("Бомбер чорний M 3 1200", UNKNOWN_QUANTITY, None, None, (FILE_COUNT_HINT,)),
    # A split the text shows, each size joined to its count by a sign.
    (
        "Лоран бежевий S-1 M-2 L-1",
        UNKNOWN_DISTRIBUTION,
        4,
        (("S", 1), ("M", 2), ("L", 1)),
        (),
    ),
    # One size with its count, joined by a sign: shown too.
    ("Лоран M-3", UNKNOWN_QUANTITY, None, (("M", 3),), ()),
    # Several sizes with one total: the total kept, the split unknown.
    ("Парка хакі S M L 3 шт 2400", UNKNOWN_DISTRIBUTION, 3, None, ()),
    # Crossed out: the line as written, with the parser's note.
    ("Пальто сіре 46 1 шт", KNOWN, 1, None, (FILE_NOTE,)),
    # No count, a numeric size: answered with a note, never one piece.
    ("Тренч бежевий 44", UNKNOWN_QUANTITY, None, None, ()),
    # An unsure colour: the count stands, the note is shown.
    ("Пуховик сірий 2 шт", KNOWN, 2, None, (FILE_NOTE,)),
    # Counts per size joined by spaces alone: bare numbers, not a split.
    ("Бомбер M 2 L 1", UNKNOWN_DISTRIBUTION, None, None, (FILE_SPLIT_NOT_IN_TEXT,)),
    # A total, passed on with a note.
    ("Разом 15 шт", KNOWN, 15, None, (FILE_NOTE,)),
]


def test_each_example_line_gets_what_the_description_says() -> None:
    example = load_stock_file_text(EXAMPLE.read_text(encoding="utf-8"))
    made = []
    for line in example.lines:
        evidence = file_line_evidence(parse_catalog_line(line.text).to_dict(), line)
        made.append(
            (line.text, evidence.state, evidence.total, evidence.shown_split, evidence.reasons)
        )
    assert made == WHAT_BIRKA_MAKES_OF_THE_EXAMPLE
    # «Рядок без кількості — одна штука» is offered for the heading alone: never
    # for a line with a number, a count or counts per size.
    one_piece = [
        countless(parse_catalog_line(line.text).to_dict(), line.model_dump(exclude_none=True))
        for line in example.lines
    ]
    assert one_piece == [True] + [False] * 10


def test_the_description_names_every_key_and_every_refusal() -> None:
    description = DESCRIPTION.read_text(encoding="utf-8")
    schema = StockFileV1.model_json_schema(by_alias=True)
    keys = set(schema["properties"])
    for definition in schema["$defs"].values():
        keys |= set(definition["properties"])
    named = set(re.findall(r"`([$a-z_]+)`", description))
    assert keys <= named, f"not described: {sorted(keys - named)}"
    assert set(MESSAGES) <= named, f"refusals not described: {sorted(set(MESSAGES) - named)}"
    # Its relative links resolve.
    for target in re.findall(r"\]\((?!https?:|#)([^)#]+)", description):
        assert (PACKAGE / target).exists(), target


# ---------------------------------------------------------------------------
# The reference validator
# ---------------------------------------------------------------------------


def test_the_reference_validator_accepts_the_example(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert validator.main([str(EXAMPLE)]) == 0
    assert capsys.readouterr().out == f"OK: {EXAMPLE}: 11 рядків, 2 фото\n"


def test_the_reference_validator_prints_the_published_schema(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert validator.main(["--schema"]) == 0
    assert capsys.readouterr().out == SCHEMA.read_text(encoding="utf-8")


def test_the_reference_validator_words_every_refusal_of_the_format() -> None:
    assert set(MESSAGES) <= set(validator.REFUSALS)


def _heavy(number: int) -> dict[str, Any]:
    return {
        **a_line(number),
        "text": "x",
        "photo": WIDE * 200,
        "model": WIDE * 200,
        "note": WIDE * 200,
        "colours": [WIDE * 60] * 10,
    }


BAD = {
    "a key written twice": (
        '{"format":"birka.stock-list","version":1,"lines":'
        '[{"text":"a","text":"b","photo":"p","photo_line":1}]}',
        "рядок 1: stock_file_duplicate_key: ключ «text» повторюється",
    ),
    "3.0 for a count": (
        '{"format":"birka.stock-list","version":1,"lines":'
        '[{"text":"a","photo":"p","photo_line":1,"count":3.0}]}',
        "рядок 1: int_type: кількість — має бути цілим числом",
    ),
    "NaN": (
        '{"format":"birka.stock-list","version":1,"lines":'
        '[{"text":"a","photo":"p","photo_line":NaN}]}',
        "рядок 1: stock_file_not_finite: NaN",
    ),
    "a line break in a text": (
        written(a_file(a_line(), {**a_line(2), "text": "Лоран\nшоколад"})),
        "рядок 2: stock_file_control_character: у полі «текст»",
    ),
    "a tab in a note": (
        written(a_file({**a_line(), "note": "за\tкреслено"})),
        "рядок 1: stock_file_control_character: у полі «примітка»",
    ),
    "a photo line twice": (
        written(a_file(a_line(1), a_line(2), a_line(1))),
        "рядок 3: stock_file_photo_line_repeated: те саме фото й рядок, що в рядку 1",
    ),
    "sizes and counts per size": (
        written(
            a_file(
                {**a_line(), "sizes": ["M"], "size_counts": [{"size": "M", "count": 1}]},
            )
        ),
        "рядок 1: stock_file_sizes_and_size_counts",
    ),
    "a size named twice": (
        written(
            a_file(
                {
                    **a_line(),
                    "size_counts": [{"size": "M", "count": 1}, {"size": "m", "count": 2}],
                },
            )
        ),
        "рядок 1: stock_file_size_repeated: розмір «m» двічі",
    ),
    "a blank text": (
        written(a_file({**a_line(), "text": "   "})),
        "рядок 1: stock_file_text_blank",
    ),
    "an empty list": (
        written(a_file({**a_line(), "colours": []})),
        "рядок 1: too_short: кольори — порожнє",
    ),
    "an unknown key": (
        written(a_file({**a_line(), "qty": 3})),
        "рядок 1: extra_forbidden: невідоме поле «qty»",
    ),
    "too much text": (
        written(a_file(*[{**a_line(n), "text": "Л" * 500} for n in range(1, 202)])),
        f"рядок 201: stock_file_text_too_long_in_all: у файлі забагато тексту: "
        f"не більше {MAX_PART_TEXT_CHARS} символів",
    ),
    "over the byte bound": (
        written(a_file(*[_heavy(n) for n in range(1, 251)])),
        "файл: stock_file_too_large: файл завеликий (",
    ),
    "too many lines": (
        written(a_file(*[a_line(n) for n in range(1, MAX_PART_LINES + 2)])),
        "файл: too_long: рядки — задовге",
    ),
    "another version": (
        written({**a_file(), "version": 2}),
        "файл: literal_error: версія формату 2 не підтримується",
    ),
    "another format": (
        written({**a_file(), "format": "birka.stock"}),
        "файл: literal_error: це не файл формату Бірки",
    ),
    "not JSON": ('{"format": "birka.stock-list",', "файл: json_invalid:"),
}


@pytest.mark.parametrize("case", list(BAD), ids=list(BAD))
def test_the_reference_validator_refuses_what_a_schema_cannot_say(
    case: str, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    text, said = BAD[case]
    code, out = run(capsys, tmp_path, text.encode("utf-8"))
    assert code == 1
    assert f"{tmp_path / 'file.json'}: {said}" in out, out


def test_the_byte_bound_is_the_compact_encoding_not_the_file_on_disk(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    """A pretty-printed file with escapes may be larger on disk than the bound;
    what counts is the file written compactly, as the phone sends it."""
    line = {"text": "Л" * 400, "model": "Л" * 200, "note": "Л" * 200, "colours": ["Л" * 60] * 10}
    data = a_file(*[{**a_line(n), **line} for n in range(1, 251)])
    pretty = json.dumps(data, ensure_ascii=True, indent=4).encode("utf-8")
    assert len(pretty) > MAX_PART_BYTES
    assert (
        len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()) < MAX_PART_BYTES
    )
    code, out = run(capsys, tmp_path, pretty)
    assert (code, out.startswith("OK:")) == (0, True), out


def test_bytes_that_are_not_utf8_are_refused(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    raw = written(a_file({**a_line(), "text": "Лоран"})).encode("cp1251", errors="replace")
    code, out = run(capsys, tmp_path, raw)
    assert code == 1
    assert "файл: not_utf8: файл не в кодуванні UTF-8" in out


def test_the_reference_validator_reads_escapes_and_a_bom_like_raw_text(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    raw = EXAMPLE.read_text(encoding="utf-8")
    data = json.loads(raw)
    escaped = "\ufeff" + json.dumps(data, ensure_ascii=True)
    assert load_stock_file_text(escaped) == load_stock_file_text(raw)
    code, out = run(capsys, tmp_path, escaped.encode("utf-8"))
    assert (code, out) == (0, f"OK: {tmp_path / 'file.json'}: 11 рядків, 2 фото\n")


def test_every_file_named_is_checked_and_one_bad_file_fails_the_run(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(written(a_file(a_line(1), a_line(1))), encoding="utf-8")
    assert validator.main([str(EXAMPLE), str(bad)]) == 1
    out = capsys.readouterr().out.splitlines()
    assert out[0].startswith(f"OK: {EXAMPLE}")
    assert out[1].startswith(f"{bad}: рядок 2: stock_file_photo_line_repeated")
    assert validator.main([]) == 2


# ---------------------------------------------------------------------------
# The validator and the server agree
# ---------------------------------------------------------------------------

GOOD = {
    "the example": EXAMPLE.read_text(encoding="utf-8"),
    "the smallest file": written(a_file()),
    "escapes and a BOM": "\ufeff" + json.dumps(a_file(), ensure_ascii=True),
    "nulls for absent keys": written(
        {
            **a_file({**a_line(), "model": None, "count": None, "size_counts": None}),
            "source": None,
            "price_kind": None,
            "$schema": None,
        }
    ),
    "a full line": written(
        {
            **a_file(
                {
                    **a_line(),
                    "model": "Лоран",
                    "colours": ["шоколад"],
                    "size_counts": [{"size": "M", "count": 1}, {"size": "L", "count": 2}],
                    "count": 3,
                    "price": "1850",
                    "note": "закреслено",
                }
            ),
            "source": "Зошит 2",
            "counted_on": "осінь 2025",
            "price_kind": "sale",
            "parser": "parser 1.0",
        }
    ),
    "the most lines": written(a_file(*[a_line(n) for n in range(1, MAX_PART_LINES + 1)])),
    "four-byte characters": written(a_file({**a_line(), "text": WIDE * 500})),
}


@pytest.mark.parametrize("case", list(GOOD), ids=list(GOOD))
def test_a_file_the_validator_passes_the_server_takes(case: str) -> None:
    assert the_validator_takes(GOOD[case]) == (True, set())
    assert the_server_takes(GOOD[case]) == (True, set())


# The duplicate key is the validator's own: JSON parsing on the server keeps
# the last value, so only the phone and the validator can see it.
ONLY_THE_VALIDATOR_SEES = {"a key written twice"}
# NaN reaches the server as a float, refused there by its type instead.
REFUSED_ALIKE_FOR_ANOTHER_REASON = {"NaN"}


@pytest.mark.parametrize("case", list(BAD), ids=list(BAD))
def test_a_file_the_validator_refuses_the_server_refuses_for_the_same_reason(case: str) -> None:
    text, _ = BAD[case]
    by_validator = the_validator_takes(text)
    by_server = the_server_takes(text)
    assert by_validator[0] is False
    if case in ONLY_THE_VALIDATOR_SEES:
        assert by_server == (True, set())
    elif case in REFUSED_ALIKE_FOR_ANOTHER_REASON:
        assert by_server[0] is False
    else:
        assert by_server == by_validator
