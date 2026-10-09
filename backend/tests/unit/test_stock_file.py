"""The file a parser writes for Birka: `birka.stock-list`, version 1 (ADR-0014 §1).

`StockFileV1` *is* the format: parser authors get its JSON Schema and its
reference validator, and the API reads every file through it. A parser's
output is a machine's, so the format is strict where a shop's own text never
is: unknown keys, loose types, empty values and control characters are
refused, and every refusal inside a line names the line. These tests pin
each rule, and the bounds that keep one file under the edge's 1 MB.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from app.modules.snapshots.stock_file import (
    MAX_LINE_CHARS,
    MAX_PART_BYTES,
    MAX_PART_LINES,
    MAX_PART_TEXT_CHARS,
    StockFileV1,
    canonical,
    canonical_bytes,
    content_fingerprint_of_file,
    content_fingerprint_of_lines,
    load_stock_file_text,
)

# A character UTF-8 writes in four bytes: the worst case for every bound.
WIDE = "𝕄"
# The edge refuses a body over 1 000 000 bytes; the phone refuses one over
# 990 000 before sending (ADR-0014 §11).
EDGE = 1_000_000
PHONE = 990_000


def a_line(**overrides: Any) -> dict[str, Any]:
    return {"text": "Лоран шоколад M-1 L-2", "photo": "IMG_0001.jpg", "photo_line": 1, **overrides}


def a_file(*lines: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    return {
        "format": "birka.stock-list",
        "version": 1,
        "lines": list(lines) or [a_line()],
        **overrides,
    }


def numbered(count: int, **overrides: Any) -> list[dict[str, Any]]:
    return [a_line(photo_line=number, **overrides) for number in range(1, count + 1)]


def refusals(data: Any) -> list[dict[str, Any]]:
    with pytest.raises(ValidationError) as refused:
        StockFileV1.model_validate(data)
    return refused.value.errors(include_url=False)


def kinds(data: Any) -> set[str]:
    return {error["type"] for error in refusals(data)}


def test_a_file_line_keeps_what_the_format_allows() -> None:
    full = a_line(
        text="Лоран шоколад M-1 L-2 1200",
        model="Лоран",
        colours=["шоколад"],
        size_counts=[{"size": "M", "count": 1}, {"size": "L", "count": 2}],
        count=3,
        price="1200",
        note="закреслено",
    )
    sized = a_line(text="Бомбер S M 2 шт", photo_line=2, sizes=["S", "M"], count=2)
    file = StockFileV1.model_validate(
        a_file(
            full,
            sized,
            source="Зошит Наталії, 2025",
            counted_on="осінь 2025",
            price_kind="purchase",
            parser="photo2json 0.3",
        )
    )

    # Kept exactly as written, and exactly what the file said, nothing added.
    assert canonical(file) == a_file(
        full,
        sized,
        source="Зошит Наталії, 2025",
        counted_on="осінь 2025",
        price_kind="purchase",
        parser="photo2json 0.3",
    )
    assert file.lines[0].size_counts is not None
    assert [(pair.size, pair.count) for pair in file.lines[0].size_counts] == [("M", 1), ("L", 2)]
    # A line needs only its text and where it was written.
    assert canonical(StockFileV1.model_validate(a_file())) == a_file()


def test_unknown_keys_are_refused_at_every_level() -> None:
    for data, where in (
        (a_file(warehouse="Спільний склад"), ("warehouse",)),
        (a_file(a_line(qty=3)), ("lines", 0, "qty")),
        (
            a_file(a_line(size_counts=[{"size": "M", "count": 1, "colour": "чорна"}])),
            ("lines", 0, "size_counts", 0, "colour"),
        ),
    ):
        [error] = refusals(data)
        assert (error["type"], error["loc"]) == ("extra_forbidden", where)


def test_the_dollar_schema_key_is_allowed_and_ignored() -> None:
    plain = StockFileV1.model_validate(a_file())
    marked = StockFileV1.model_validate(a_file(**{"$schema": "./birka-stock-list-v1.schema.json"}))

    assert canonical(marked) == canonical(plain)
    assert canonical_bytes(marked) == canonical_bytes(plain)
    assert content_fingerprint_of_file(marked) == content_fingerprint_of_file(plain)
    # Its own name is not a key the file may use.
    assert kinds(a_file(schema_="x")) == {"extra_forbidden"}


@pytest.mark.parametrize("value", ["7", True, 7.0, Decimal("7"), Decimal("3.0"), None])
@pytest.mark.parametrize("where", ["photo_line", "count", "size_count", "version"])
def test_types_are_strict(where: str, value: Any) -> None:
    """`"7"` is not 7, `true` is not 1, and `3.0` is not 3 (ADR-0014 §1)."""
    if where == "version":
        data = a_file(version=value)
    elif where == "size_count":
        data = a_file(a_line(size_counts=[{"size": "M", "count": value}]))
    else:
        data = a_file(a_line(**{where: value}))
    if value is None and where == "count":
        StockFileV1.model_validate(data)  # an optional key may be null
        return
    assert kinds(data) <= {"int_type", "missing"}, refusals(data)
    assert refusals(data)


def test_optional_keys_may_be_null_or_absent_but_never_empty() -> None:
    for key in ("model", "price", "note"):
        StockFileV1.model_validate(a_file(a_line(**{key: None})))
        assert kinds(a_file(a_line(**{key: ""}))) == {"string_too_short"}, key
    for key in ("colours", "sizes", "size_counts"):
        StockFileV1.model_validate(a_file(a_line(**{key: None})))
        assert kinds(a_file(a_line(**{key: []}))) == {"too_short"}, key
    for key in ("colours", "sizes"):
        assert kinds(a_file(a_line(**{key: [""]}))) == {"string_too_short"}, key
    assert kinds(a_file(a_line(size_counts=[{"size": "", "count": 1}]))) == {"string_too_short"}
    for key in ("source", "counted_on", "parser", "$schema"):
        StockFileV1.model_validate(a_file(**{key: None}))
        assert kinds(a_file(**{key: ""})) == {"string_too_short"}, key
    StockFileV1.model_validate(a_file(price_kind=None))
    assert kinds(a_file(price_kind="")) == {"literal_error"}
    assert kinds(a_file(price_kind="SALE")) == {"literal_error"}
    for key in ("text", "photo", "photo_line"):
        line = a_line()
        del line[key]
        assert kinds(a_file(line)) == {"missing"}, key
        assert kinds(a_file(a_line(**{key: None}))) <= {"string_type", "int_type"}, key


def test_a_file_names_its_format_and_version() -> None:
    assert kinds(a_file(format="birka.stock-list.v2")) == {"literal_error"}
    assert kinds(a_file(version=2)) == {"literal_error"}
    assert kinds(a_file(version=0)) == {"literal_error"}
    for key in ("format", "version", "lines"):
        data = a_file()
        del data[key]
        assert kinds(data) == {"missing"}, key


def test_a_photo_line_appears_once_per_file() -> None:
    errors = refusals(
        a_file(
            a_line(photo="IMG_1.jpg", photo_line=7),
            a_line(photo="IMG_1.jpg", photo_line=8),
            a_line(photo="IMG_2.jpg", photo_line=7),
            a_line(photo="IMG_1.jpg", photo_line=7),
        )
    )

    assert [(error["type"], error["loc"], error["ctx"]) for error in errors] == [
        ("stock_file_photo_line_repeated", ("lines", 3, "photo_line"), {"line": 4, "first_line": 1})
    ]
    # The photo's name is compared as the shop names it.
    StockFileV1.model_validate(
        a_file(a_line(photo="IMG_1.jpg", photo_line=7), a_line(photo="img_1.jpg", photo_line=7))
    )


def test_a_line_gives_sizes_or_counts_per_size_never_both() -> None:
    [error] = refusals(
        a_file(
            a_line(),
            a_line(photo_line=2, sizes=["M", "L"], size_counts=[{"size": "M", "count": 1}]),
        )
    )
    assert (error["type"], error["loc"], error["ctx"]) == (
        "stock_file_sizes_and_size_counts",
        ("lines", 1),
        {"line": 2},
    )


def test_counts_per_size_name_each_size_once_and_one_size_counts_too() -> None:
    """One size with its count is a size with its count, as several are
    («Лоран M-3»; owner, 2026-10-08), so `size_counts` takes one or more."""
    StockFileV1.model_validate(a_file(a_line(size_counts=[{"size": "M", "count": 3}])))
    StockFileV1.model_validate(
        a_file(a_line(size_counts=[{"size": str(size), "count": 1} for size in range(40, 50)]))
    )

    for repeated in (["M", "M"], ["M", "m"], ["M", " M "], ["xl", "XL"]):
        [error] = refusals(
            a_file(a_line(size_counts=[{"size": size, "count": 1} for size in repeated]))
        )
        assert (error["type"], error["loc"]) == (
            "stock_file_size_repeated",
            ("lines", 0, "size_counts"),
        )
        assert error["ctx"] == {"size": repeated[1], "line": 1}
    assert kinds(
        a_file(a_line(size_counts=[{"size": str(size), "count": 1} for size in range(40, 51)]))
    ) == {"too_long"}
    for count in (0, -1, 10_001):
        assert kinds(a_file(a_line(size_counts=[{"size": "M", "count": count}]))) <= {
            "greater_than_equal",
            "less_than_equal",
        }


STRING_FIELDS = [
    ("text", lambda value: a_file(a_line(text=f"Лоран{value}M-1"))),
    ("photo", lambda value: a_file(a_line(photo=f"IMG{value}.jpg"))),
    ("model", lambda value: a_file(a_line(model=f"Ло{value}ран"))),
    ("colours", lambda value: a_file(a_line(colours=[f"чор{value}на"]))),
    ("sizes", lambda value: a_file(a_line(sizes=[f"M{value}"]))),
    ("size", lambda value: a_file(a_line(size_counts=[{"size": f"M{value}", "count": 1}]))),
    ("price", lambda value: a_file(a_line(price=f"12{value}00"))),
    ("note", lambda value: a_file(a_line(note=f"закрес{value}лено"))),
    ("source", lambda value: a_file(source=f"Зошит{value}1")),
    ("counted_on", lambda value: a_file(counted_on=f"осінь{value}2025")),
    ("parser", lambda value: a_file(parser=f"p2j{value}0.3")),
    ("schema_", lambda value: a_file(**{"$schema": f"x{value}.json"})),
]


@pytest.mark.parametrize(
    "character",
    ["\n", "\r", "\t", "\x00", "\x1f", "\x7f", "\x80", "\x85", "\x9b", "\x9f", "\u2028", "\u2029"],
)
@pytest.mark.parametrize(("field", "build"), STRING_FIELDS, ids=[f for f, _ in STRING_FIELDS])
def test_control_characters_are_refused_in_every_string(
    field: str, build: Any, character: str
) -> None:
    """A line break inside `text` would show one written line as two, and
    so would U+0085, the next-line character, or the line and paragraph
    separators U+2028 and U+2029; every C0 and C1 control is refused, and
    so are those two (review, 2026-10-09)."""
    [error] = refusals(build(character))
    assert error["type"] == "stock_file_control_character"
    assert error["ctx"]["field"] == field


def test_every_c0_and_c1_control_is_refused_and_its_neighbours_are_not() -> None:
    controls = [chr(code) for code in (*range(0x00, 0x20), *range(0x7F, 0xA0), 0x2028, 0x2029)]
    for character in controls:
        [error] = refusals(a_file(a_line(), a_line(photo_line=2, text=f"Лоран{character}M-1")))
        assert (error["type"], error["loc"], error["ctx"]) == (
            "stock_file_control_character",
            ("lines", 1, "text"),
            {"field": "text", "line": 2},
        ), hex(ord(character))
    # The characters around them are text: a space, U+00A0, «~» and the
    # neighbours of the separators are kept.
    for character in (" ", "~", "\xa0", "\xad", "\u2027", "\u202f"):
        StockFileV1.model_validate(a_file(a_line(text=f"Лоран{character}M-1")))


def test_a_blank_text_is_refused() -> None:
    for blank in (" ", "   ", " ", " "):
        [error] = refusals(a_file(a_line(), a_line(photo_line=2, text=blank)))
        assert (error["type"], error["loc"], error["ctx"]) == (
            "stock_file_text_blank",
            ("lines", 1, "text"),
            {"line": 2},
        )
    assert kinds(a_file(a_line(text=""))) == {"string_too_short"}
    # Spaces around written text are the text as written, and kept.
    file = StockFileV1.model_validate(a_file(a_line(text="  Куртки  ")))
    assert file.lines[0].text == "  Куртки  "


def test_a_lone_surrogate_is_refused_as_everywhere() -> None:
    # Pydantic's own strict string refuses it before the format's rules do.
    [error] = refusals(a_file(a_line(text="Лоран \ud800")))
    assert (error["type"], error["loc"]) == ("string_unicode", ("lines", 0, "text"))


def test_a_file_is_bounded_in_lines_text_and_bytes() -> None:
    StockFileV1.model_validate(a_file(*numbered(MAX_PART_LINES)))
    assert kinds(a_file(*numbered(MAX_PART_LINES + 1))) == {"too_long"}
    assert kinds({**a_file(), "lines": []}) == {"too_short"}
    assert kinds(a_file(a_line(text="x" * (MAX_LINE_CHARS + 1)))) == {"string_too_long"}

    # Every line within bounds, the text of the file as a whole not.
    longest = MAX_PART_TEXT_CHARS // MAX_LINE_CHARS
    StockFileV1.model_validate(a_file(*numbered(longest, text="x" * MAX_LINE_CHARS)))
    [error] = refusals(a_file(*numbered(longest + 1, text="x" * MAX_LINE_CHARS)))
    assert (error["type"], error["loc"], error["ctx"]) == (
        "stock_file_text_too_long_in_all",
        ("lines", longest, "text"),
        {"line": longest + 1, "limit": MAX_PART_TEXT_CHARS},
    )

    # One character past the limit is past it.
    StockFileV1.model_validate(a_file(*numbered(longest, text="x" * MAX_LINE_CHARS)))
    [error] = refusals(
        a_file(
            *numbered(longest, text="x" * MAX_LINE_CHARS), a_line(photo_line=longest + 1, text="x")
        )
    )
    assert (error["type"], error["ctx"]["line"]) == ("stock_file_text_too_long_in_all", longest + 1)

    # Every line and the text within bounds, the bytes not.
    wide = a_file(*numbered(MAX_PART_LINES, photo=WIDE * 200, model=WIDE * 200))
    [error] = refusals(wide)
    assert error["type"] == "stock_file_too_large"
    assert error["ctx"]["limit"] == MAX_PART_BYTES
    assert error["ctx"]["bytes"] > MAX_PART_BYTES


def _compact(data: Any) -> int:
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode())


def _exactly(size: int) -> dict[str, Any]:
    """A file of exactly `size` bytes as compact UTF-8 JSON.

    Full lines of one cost (four-digit line numbers, wide characters), then
    two lines whose text and note take up what is left to the byte."""

    def full(index: int) -> dict[str, Any]:
        return a_line(photo_line=1000 + index, photo=WIDE * 200, model=WIDE * 50)

    def filler(index: int, extra: int) -> dict[str, Any]:
        text = min(extra, MAX_LINE_CHARS - 1)
        return a_line(
            photo="filler.jpg",
            photo_line=3000 + index,
            text="x" * (1 + text),
            note="y" * (1 + extra - text),
        )

    empty = _compact({**a_file(), "lines": []})
    cost, least = _compact(full(0)), _compact(filler(0, 0))
    count = (size - empty - 2 * least - 1) // (cost + 1)
    extra = size - (empty + count * cost + 2 * least + count + 1)
    assert 0 <= extra <= cost
    lines = [full(index) for index in range(count)]
    lines += [filler(0, extra // 2), filler(1, extra - extra // 2)]
    data = a_file(*lines)
    assert len(lines) <= MAX_PART_LINES
    assert _compact(data) == size
    return data


def test_the_body_stays_under_the_edge() -> None:
    """ADR-0014 §11: the largest file part, in the largest envelope, written
    at four bytes a character, stays under what the phone sends (990 000),
    which stays under what the edge takes (1MB = 1 000 000 bytes)."""
    envelope = {
        "command_id": str(uuid.uuid4()),
        "store_id": str(uuid.uuid4()),
        "location_id": str(uuid.uuid4()),
        "source_document_ref": WIDE * 300,
        "captured_at": WIDE * 40,
        "file_name": WIDE * 200,
        "lines": None,
        "file": None,
    }
    around = len(json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode())
    largest_body = around - len("null") + MAX_PART_BYTES
    assert largest_body < PHONE < EDGE

    # A file of exactly the limit is taken, and one byte more is not.
    at_limit = StockFileV1.model_validate(_exactly(MAX_PART_BYTES))
    assert len(canonical_bytes(at_limit)) == MAX_PART_BYTES
    assert kinds(_exactly(MAX_PART_BYTES + 1)) == {"stock_file_too_large"}

    # A file at every limit at once is refused, never stored past the bound.
    worst = a_file(
        *[
            a_line(
                text=WIDE * 100,
                photo=WIDE * 200,
                photo_line=number,
                model=WIDE * 200,
                colours=[WIDE * 60] * 10,
                size_counts=[
                    {"size": f"{size}{WIDE * 17}", "count": 10_000} for size in range(100, 110)
                ],
                count=10_000,
                price=WIDE * 40,
                note=WIDE * 200,
            )
            for number in range(1, MAX_PART_LINES + 1)
        ],
        source=WIDE * 300,
        counted_on=WIDE * 40,
        parser=WIDE * 100,
        price_kind="purchase",
    )
    assert "stock_file_too_large" in kinds(worst)


def test_each_refusal_names_its_line() -> None:
    """In `ctx.line`, 1-based, besides the index `loc` holds (ADR-0014 §13)."""
    errors = refusals(
        a_file(
            a_line(),
            a_line(photo_line=2, text="Лоран\nM-1"),
            a_line(photo_line=3, count="3"),
            a_line(photo_line=4, sizes=["M"], size_counts=[{"size": "M", "count": 1}]),
            a_line(photo_line=5, qty=1),
            a_line(
                photo_line=6, size_counts=[{"size": "M", "count": 1}, {"size": "m", "count": 2}]
            ),
            a_line(photo_line=7, note=""),
        )
    )

    assert len(errors) == 6
    for error in errors:
        assert error["loc"][0] == "lines"
        assert error["ctx"]["line"] == error["loc"][1] + 1, error
    assert [error["ctx"]["line"] for error in errors] == [2, 3, 4, 5, 6, 7]
    # And when the file is read from its text.
    with pytest.raises(ValidationError) as refused:
        load_stock_file_text(
            json.dumps(a_file(a_line(), a_line(photo_line=2))).replace(
                '"photo_line": 2', '"photo_line": 2, "photo_line": 3'
            )
        )
    [error] = refused.value.errors(include_url=False)
    assert error["ctx"] == {"key": "photo_line", "line": 2}


def test_duplicate_keys_and_float_literals_are_refused_when_loading_text() -> None:
    """Lost once JSON is parsed; the reference validator and the phone see
    the text (ADR-0014 §1, §15)."""
    good = json.dumps(a_file(a_line(count=3, size_counts=[{"size": "M", "count": 3}])))
    assert load_stock_file_text(good).lines[0].count == 3

    for text, kind, loc, context in (
        (
            good.replace('"version": 1', '"version": 1, "version": 1'),
            "stock_file_duplicate_key",
            (),
            {"key": "version"},
        ),
        (
            good.replace('"text": ', '"text": "x", "text": '),
            "stock_file_duplicate_key",
            ("lines", 0),
            {"key": "text", "line": 1},
        ),
        (
            good.replace('"size": "M"', '"size": "M", "size": "L"'),
            "stock_file_duplicate_key",
            ("lines", 0, "size_counts", 0),
            {"key": "size", "line": 1},
        ),
        (
            good.replace('"photo_line": 1', '"photo_line": NaN'),
            "stock_file_not_finite",
            ("lines", 0, "photo_line"),
            {"constant": "NaN", "line": 1},
        ),
        (
            good.replace('"count": 3,', '"count": Infinity,'),
            "stock_file_not_finite",
            ("lines", 0, "count"),
            {"constant": "Infinity", "line": 1},
        ),
        (
            good.replace('"count": 3,', '"count": -Infinity,'),
            "stock_file_not_finite",
            ("lines", 0, "count"),
            {"constant": "-Infinity", "line": 1},
        ),
    ):
        with pytest.raises(ValidationError) as refused:
            load_stock_file_text(text)
        [error] = refused.value.errors(include_url=False)
        assert (error["type"], error["loc"], error["ctx"]) == (kind, loc, context), text

    for literal in ("3.0", "3e0", "3E0", "30e-1"):
        with pytest.raises(ValidationError) as refused:
            load_stock_file_text(good.replace('"count": 3,', f'"count": {literal},'))
        [error] = refused.value.errors(include_url=False)
        assert (error["type"], error["loc"], error["ctx"]) == (
            "int_type",
            ("lines", 0, "count"),
            {"line": 1},
        )
    with pytest.raises(ValidationError) as refused:
        load_stock_file_text("{not json")
    assert [error["type"] for error in refused.value.errors()] == ["json_invalid"]


def test_a_bom_and_escaped_characters_load_like_raw_ones() -> None:
    data = a_file(a_line(text="Лоран шоколад M-1 L-2 «нова»", note="закреслено"))
    raw = json.dumps(data, ensure_ascii=False)
    escaped = json.dumps(data, ensure_ascii=True)
    assert "\\u" in escaped and "\\u" not in raw

    files = [load_stock_file_text(text) for text in (raw, escaped, "﻿" + raw)]
    assert files[0] == files[1] == files[2]
    assert {content_fingerprint_of_file(file) for file in files} == {
        content_fingerprint_of_file(files[0])
    }
    # A lone surrogate written as an escape is refused, as everywhere.
    with pytest.raises(ValidationError) as refused:
        load_stock_file_text(raw.replace("«нова»", "\\ud800"))
    assert [error["type"] for error in refused.value.errors()] == ["string_unicode"]


def test_content_fingerprint_ignores_name_envelope_and_key_order() -> None:
    lines = [a_line(model="Лоран", count=3), a_line(photo_line=2, text="Куртки", note="заголовок")]
    one = StockFileV1.model_validate(a_file(*lines))
    enveloped = StockFileV1.model_validate(
        a_file(
            *lines,
            source="Зошит 2",
            counted_on="зима",
            price_kind="sale",
            parser="p2j 1.0",
            **{"$schema": "x.json"},
        )
    )
    reordered = StockFileV1.model_validate(
        {"lines": [dict(reversed(line.items())) for line in lines], "version": 1}
        | {"format": "birka.stock-list"}
    )
    assert (
        content_fingerprint_of_file(one)
        == content_fingerprint_of_file(enveloped)
        == content_fingerprint_of_file(reordered)
    )

    # What a line says, and their order, are the content.
    for different in (
        [lines[1], lines[0]],
        [a_line(model="Лоран", count=4), lines[1]],
        [a_line(model="Лоран", count=3, photo="IMG_0002.jpg"), lines[1]],
        [lines[0]],
    ):
        other = StockFileV1.model_validate(a_file(*different))
        assert content_fingerprint_of_file(other) != content_fingerprint_of_file(one)


def test_the_content_fingerprint_is_the_documented_canonical_form() -> None:
    """sha256 of `{"kind": ..., "lines": [...]}` as compact JSON, keys sorted,
    characters raw (ADR-0014 §8): what a parser author or a script can
    compute for itself."""

    def documented(kind: str, lines: list[Any]) -> str:
        form = json.dumps(
            {"kind": kind, "lines": lines},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(form.encode("utf-8")).hexdigest()

    data = a_file(a_line(model="Лоран", count=3, note=None), source="Зошит")
    file = StockFileV1.model_validate(data)
    assert content_fingerprint_of_file(file) == documented(
        "FILE",
        [
            {
                "text": "Лоран шоколад M-1 L-2",
                "photo": "IMG_0001.jpg",
                "photo_line": 1,
                "model": "Лоран",
                "count": 3,
            }
        ],
    )
    assert content_fingerprint_of_lines(["Куртки"]) == documented("PASTED", ["Куртки"])


def test_a_pasted_part_never_fingerprints_like_a_file() -> None:
    file = StockFileV1.model_validate(a_file(a_line(text="Куртки")))
    texts = ["Куртки"]

    assert content_fingerprint_of_lines(texts) != content_fingerprint_of_file(file)
    assert content_fingerprint_of_lines(texts) == content_fingerprint_of_lines(list(texts))
    assert content_fingerprint_of_lines(texts) != content_fingerprint_of_lines(["Куртки "])
