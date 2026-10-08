"""Check a parser's file against Birka's format, `birka.stock-list` version 1.

The reference validator of the format package (`formats/birka-stock-list/`,
ADR-0014 §1). It reads a file exactly as strictly as Birka does, through the
server's own model (`StockFileV1`), and adds what JSON parsing would hide:
bytes that are not UTF-8, a key written twice, a number such as `3.0` or
`NaN` where an integer belongs. So a file it passes is one the app accepts,
and the phone refuses everything it refuses.

Run from backend:

    python -m scripts.check_stock_file FILE.json [FILE.json ...]
    python -m scripts.check_stock_file --schema

Exit 0 when every file is valid, 1 when any is not (each problem printed with
its line), 2 when it was called wrongly. `--schema` prints the JSON Schema the
package publishes: the model's own, generated, never edited by hand.

It imports nothing of the app but the format itself: no database, no
settings.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.modules.snapshots.stock_file import (
    FORMAT,
    VERSION,
    StockFileV1,
    load_stock_file_text,
)

# The fields as the app names them in Ukrainian (ADR-0014 §15). The keys
# themselves stay English in the file.
FIELDS = {
    "text": "текст",
    "photo": "фото",
    "photo_line": "номер рядка на фото",
    "count": "кількість",
    "size_counts": "кількість по розмірах",
    "size": "розмір",
    "sizes": "розміри",
    "colours": "кольори",
    "price": "ціна",
    "note": "примітка",
    "model": "модель",
    "source": "звідки",
    "counted_on": "коли перелічено",
    "price_kind": "вид цін",
    "parser": "парсер",
    "format": "формат",
    "version": "версія",
    "lines": "рядки",
    "$schema": "$schema",
}

# Pydantic's own refusals, as the app words them.
PROBLEMS = {
    "missing": "немає",
    "extra_forbidden": "невідоме поле",
    "int_type": "має бути цілим числом",
    "string_type": "має бути текстом",
    "string_unicode": "має символ, якого не може бути в тексті",
    "list_type": "має бути списком",
    "model_type": "має бути об’єктом",
    "dict_type": "має бути об’єктом",
    "string_too_short": "порожнє",
    "too_short": "порожнє",
    "string_too_long": "задовге",
    "too_long": "задовге",
    "greater_than_equal": "поза межами",
    "less_than_equal": "поза межами",
    "literal_error": "недопустиме значення",
}

# The format's own refusals (`stock_file.MESSAGES`), as the app words them.
REFUSALS = {
    "stock_file_text_blank": "текст порожній",
    "stock_file_control_character": (
        "у полі «{field}» є службовий символ (перенесення рядка чи табуляція)"
    ),
    "stock_file_photo_line_repeated": "те саме фото й рядок, що в рядку {first_line}",
    "stock_file_sizes_and_size_counts": "або розміри, або кількість по розмірах — не обидва",
    "stock_file_size_repeated": "розмір «{size}» двічі",
    "stock_file_text_too_long_in_all": "у файлі забагато тексту: не більше {limit} символів",
    "stock_file_too_large": (
        "файл завеликий ({bytes} байтів, можна не більше {limit}) — розділіть його на два"
    ),
    "stock_file_duplicate_key": "ключ «{key}» повторюється",
    "stock_file_not_finite": "{constant} — не число, яке може бути у файлі",
    "json_invalid": "це не JSON-файл, або він пошкоджений ({error})",
}


def _lines(count: int) -> str:
    """«1 рядок», «2 рядки», «5 рядків»."""
    if count % 10 == 1 and count % 100 != 11:
        return f"{count} рядок"
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return f"{count} рядки"
    return f"{count} рядків"


def _field(location: Sequence[str | int]) -> str:
    names = [part for part in location if isinstance(part, str)]
    return FIELDS.get(names[-1], names[-1]) if names else "файл"


def describe(error: Any) -> str:
    """One refusal, as «рядок N: type: what is wrong» or «файл: type: …».

    `error` is one entry of `ValidationError.errors()`: its `type` is stable,
    and its line, 1-based, is `ctx.line` whenever it stands inside `lines`.
    """
    kind: str = error["type"]
    location: Sequence[str | int] = error.get("loc", ())
    context: dict[str, Any] = dict(error.get("ctx") or {})
    line = context.get("line")
    if kind in REFUSALS:
        if "field" in context:
            context["field"] = FIELDS.get(context["field"], context["field"])
        text = REFUSALS[kind].format(**context)
    elif kind == "literal_error" and tuple(location) == ("format",):
        text = f"це не файл формату Бірки («{FORMAT}»)"
    elif kind == "literal_error" and tuple(location) == ("version",):
        text = f"версія формату {error.get('input')} не підтримується: Бірка читає версію {VERSION}"
    elif kind == "extra_forbidden" and location:
        text = f"невідоме поле «{location[-1]}»"
    else:
        problem = PROBLEMS.get(kind, error.get("msg", kind))
        text = f"{_field(location)} — {problem}"
    where = f"рядок {line}" if line is not None else "файл"
    return f"{where}: {kind}: {text}"


def check(path: Path) -> tuple[StockFileV1 | None, list[str]]:
    """The file, or every problem with it, each as `describe` words it."""
    try:
        raw = path.read_bytes()
    except OSError as unreadable:
        return None, [f"файл: unreadable: файл не прочитано ({unreadable.strerror})"]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as broken:
        return None, [
            f"файл: not_utf8: файл не в кодуванні UTF-8 (байт {broken.start}). "
            "Збережіть його як UTF-8."
        ]
    try:
        return load_stock_file_text(text), []
    except ValidationError as refused:
        return None, [describe(error) for error in refused.errors(include_url=False)]


def schema_text() -> str:
    """The published schema, byte for byte: the model's, pretty-printed."""
    schema = StockFileV1.model_json_schema(by_alias=True)
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.check_stock_file",
        description="Check a parser's file against birka.stock-list, version 1.",
    )
    parser.add_argument("files", nargs="*", type=Path, help="the JSON files to check")
    parser.add_argument("--schema", action="store_true", help="print the JSON Schema and exit")
    args = parser.parse_args(argv)
    if args.schema:
        sys.stdout.write(schema_text())
        return 0
    if not args.files:
        parser.print_usage(sys.stderr)
        return 2
    valid = True
    for path in args.files:
        file, problems = check(path)
        if file is None:
            valid = False
            for problem in problems:
                print(f"{path}: {problem}")
            continue
        photos = len({line.photo for line in file.lines})
        print(f"OK: {path}: {_lines(len(file.lines))}, {photos} фото")
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
