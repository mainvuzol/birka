# M1-020 — deterministic catalog parser v1

Implemented locally on 2026-09-24, baseline `0ca537b`. No push or merge.

## Scope and contract

`app.modules.catalog.parser.parse_catalog_line(raw_text, parser_version="1.0.0")`
is a pure function. It returns typed candidate fields, exact raw evidence spans,
normalized text, unknown descriptors, lexical slash groups and review reasons.
`to_json()` serializes deterministically, including across different hash seeds.
Unsupported versions and empty, oversized, NUL or surrogate input are refused.

Recognized vocabulary covers common RU/UK garment types, colors, alpha sizes,
explicit length/quantity units, material/texture, some fur/collar/hood/pocket
phrases and tentative concept words. Vocabulary is code-versioned; it never
reads aliases, catalog rows or learned state. Import contracts enforce the
boundary. `EXPLICIT` means exact lexical evidence, not calibrated correctness
probability or permission to apply a product/stock change. Concept hints,
negation, conflicts and slash-intersecting candidates require review.

- Original text and offsets are retained, including capitalization/whitespace.
- Every alphanumeric character remains represented in evidence, unknown text or
  an option group. Partially recognized compounds do not lose their suffixes.
- `Куртка 1636` keeps the rare possible item code without guessing issuer,
  uniqueness, quantity, price or size. This respects the owner's explanation.
- `4 кармана` is a tentative concept, never quantity.
- `3 шт` can express quantity without inventing a product; `3 куртки` is left
  conservative. Negative/fractional counts and range suffixes are not made positive.
- Slash groups never become aliases or allocate a total among variants.
- No database writes, identity matching, merges, stock changes or HTTP endpoint.
  Persistence/processing orchestration belongs to later catalog intake work.

The read-only CLI accepts one raw line from stdin:

```sh
# From backend, with the project Python environment active:
printf '%s' 'Куртка 1636' | python -m scripts.preview_catalog
```

The CLI prints JSON only; it cannot create inventory or catalog records.

## Evidence

`backend/tests/fixtures/catalog_store_rows_v1.json` contains 44 product-only rows
transcribed from the user's attached photo. Repetitions and typo uncertainty
(e.g. `серный`) are retained. Expected candidate assertions cover clear semantic
facts; these are not owner-approved product identities or a calibrated matcher
benchmark. The original photo/PDF is not committed.

- **290 unit tests passed**, no skips; 125 belong to the parser/CLI suite.
- Two existing dependency deprecation warnings; no application warning failures.
- `ruff check .` passed; `ruff format --check .`: 122 files formatted.
- Exact CI command `mypy app scripts`: 69 source files passed.
- All **12 import contracts** passed, including the new state-free parser boundary.
- Independent reviewer exercised 20 adversarial inputs and evidence coverage.
  Findings fixed: partial-token loss, signed/range suffix extraction, slash
  confidence, direct negation, and punctuation-only empty interpretation.

Logs and 44 complete sample outputs are under
`output/verification/2026-09-24-parser/`. No database was started or changed for
this pure-function change. Integration/E2E suites were not rerun: this slice adds
no route, schema or existing workflow behavior. Previous evidence is not counted
as verification of new code.

## Limits and next step

Vocabulary is intentionally incomplete. Source/brand/category semantics,
unrecognized model words and optional numeric identifiers remain unclassified.
Slash grouping is lexical, not complete multiword variant interpretation; no
unit propagation, stock allocation or automatic choice is inferred.

M1-020 implementation is complete within that conservative scope. M1-021 comes
next: deterministic candidate matching, structured-conflict checks, explicit
AMBIGUOUS results and duplicate-family reporting. No confirmation threshold
should be lowered based solely on this extraction corpus. M1-022 feedback and
M1-023 legacy opening balances remain unimplemented. Real Telegram device checks
and the remaining M1D seller flows also remain open.
