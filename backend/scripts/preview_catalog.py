"""Read one raw catalog line from stdin; print candidates without database access."""

from __future__ import annotations

import sys

from app.modules.catalog.parser import MAX_INPUT_LENGTH, parse_catalog_line


def main() -> int:
    # Read at most one character beyond the limit, never an unbounded input file.
    raw = sys.stdin.read(MAX_INPUT_LENGTH + 1)
    try:
        preview = parse_catalog_line(raw)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(preview.to_json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
