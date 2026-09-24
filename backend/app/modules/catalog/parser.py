"""Versioned, state-free catalog evidence extraction; never an identity decision.

Version 1.0.0 has a deliberately small frozen vocabulary. Changing its vocabulary
or interpretation requires a new parser version, not learned catalog state.
Spans are Python string offsets into the exact original input.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, replace
from typing import Literal

PARSER_VERSION = "1.0.0"
MAX_INPUT_LENGTH = 2000
Confidence = Literal["EXPLICIT", "AMBIGUOUS"]


@dataclass(frozen=True)
class Evidence:
    start: int
    end: int
    text: str


@dataclass(frozen=True)
class FieldCandidate:
    value: str
    confidence: Confidence
    evidence: tuple[Evidence, ...]


@dataclass(frozen=True)
class OptionGroup:
    start: int
    end: int
    text: str
    candidates: tuple[str, ...]


@dataclass(frozen=True)
class UnknownDescriptor:
    start: int
    end: int
    text: str
    kind: str


@dataclass(frozen=True)
class ParsePreview:
    raw_text: str
    normalized_text: str
    parser_version: str
    fields: dict[str, tuple[FieldCandidate, ...]]
    option_groups: tuple[OptionGroup, ...]
    unclassified_descriptors: tuple[UnknownDescriptor, ...]
    review_reasons: tuple[str, ...]
    quantity_distribution: Literal["NOT_APPLICABLE", "UNKNOWN_DISTRIBUTION"]

    def to_dict(self) -> dict[str, object]:
        # Round-trip converts immutable tuples to JSON lists for an API/fixture.
        result: dict[str, object] = json.loads(self.to_json())
        return result

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


# Explicit lexical evidence only: these are neither product aliases nor brands.
_VOCABULARY: dict[str, dict[str, str]] = {
    "garment_type": {
        "куртка": "jacket",
        "куртки": "jacket",
        "бомбер": "bomber",
        "парка": "parka",
        "пуховик": "down_jacket",
        "пуховики": "down_jacket",
        "дубленка": "shearling_coat",
        "дублёнка": "shearling_coat",
        "дублянка": "shearling_coat",
        "шуба": "fur_coat",
        "жакет": "blazer",
        "пальто": "coat",
        "косуха": "biker_jacket",
    },
    "color": {
        "чёрный": "black",
        "черный": "black",
        "чёрная": "black",
        "черная": "black",
        "чорний": "black",
        "чорна": "black",
        "белый": "white",
        "белая": "white",
        "білий": "white",
        "біла": "white",
        "шоколад": "chocolate",
        "шоколадный": "chocolate",
        "шоколадна": "chocolate",
        "бордо": "burgundy",
        "молочный": "milk",
        "молочний": "milk",
        "молочная": "milk",
        "графит": "graphite",
        "графіт": "graphite",
        "бежевая": "beige",
        "бежевый": "beige",
        "бежева": "beige",
        "бежевий": "beige",
        "персик": "peach",
        "butter": "butter",
        "виски": "whiskey",
        "орех": "walnut",
    },
    "material": {"замш": "suede", "замша": "suede", "шерсть": "wool", "вовна": "wool"},
    "texture": {
        "зернистый": "grained",
        "зернистий": "grained",
        "зернистая": "grained",
        "зерниста": "grained",
        "гладкая": "smooth",
        "гладка": "smooth",
    },
    "concept": {"мышка": "мышка", "мишка": "мишка", "ботега": "ботега", "лоран": "лоран"},
}
_SIZES = {
    "xs": "XS",
    "s": "S",
    "m": "M",
    "l": "L",
    "xl": "XL",
    "xxl": "XXL",
    "хс": "XS",
    "с": "S",
    "м": "M",
    "л": "L",
    "хл": "XL",
}
_TOKEN = re.compile(r"\w+(?:[’'\-]\w+)*", re.UNICODE)


def parse_catalog_line(raw_text: str, parser_version: str = PARSER_VERSION) -> ParsePreview:
    """Extract tentative evidence with no database, matching, or stock effects."""
    if parser_version != PARSER_VERSION:
        raise ValueError("Unsupported parser version")
    if not isinstance(raw_text, str):
        raise ValueError("raw_text must be a string")
    if any(0xD800 <= ord(char) <= 0xDFFF for char in raw_text):
        raise ValueError("raw_text must contain valid Unicode scalar values")
    if not raw_text.strip() or "\x00" in raw_text or len(raw_text) > MAX_INPUT_LENGTH:
        raise ValueError("raw_text must contain 1..2000 characters and no NUL")

    covered: set[int] = set()
    extracted: dict[str, list[FieldCandidate]] = {}
    reasons: set[str] = set()

    def add(field: str, value: str, start: int, end: int) -> None:
        evidence = Evidence(start, end, raw_text[start:end])
        negated = re.search(r"(?<!\w)(?:не|not)\s*$", raw_text[:start], re.IGNORECASE)
        if negated:
            reasons.add("NEGATED_DESCRIPTOR")
        extracted.setdefault(field, []).append(
            FieldCandidate(value, "AMBIGUOUS" if negated else "EXPLICIT", (evidence,))
        )
        covered.update(range(start, end))

    # Structured numbers require an explicit unit, and never consume bare codes.
    for field, pattern in (
        ("length_cm", r"(?<![\w.,+\-])(\d+(?:[.,]\d+)?)\s*(?:см|cm)(?!\w)"),
        ("quantity", r"(?<![\w.,+\-])(\d+)\s*(?:шт(?:ук(?:и)?)?|од(?:иниц[яіь])?)(?!\w)"),
    ):
        for match in re.finditer(pattern, raw_text, re.IGNORECASE):
            # Reject numeric suffixes of signs, ranges, fractions and decimals;
            # whitespace between the punctuation and number is immaterial.
            prefix = raw_text[: match.start()].rstrip()
            if prefix.endswith(("-", "+", "−", "–", "—", "/", ".", ",")):
                reasons.add("AMBIGUOUS_NUMERIC_EXPRESSION")
                continue
            value = match[1].replace(",", ".")
            if field == "quantity" and int(value) == 0:
                reasons.add("INVALID_QUANTITY")
                continue
            add(field, value, match.start(), match.end())

    for field, value, pattern in (
        ("fur", "fox", r"(?<!\w)(?:с\s+лисой|з\s+лисицею)(?!\w)"),
        ("fur", "mink", r"(?<!\w)(?:с\s+норкой|з\s+норкою)(?!\w)"),
        ("collar", "stand", r"(?<!\w)(?:стойка|стійка)(?!\w)"),
        ("concept", "4 кармана", r"(?<!\w)4\s*(?:кармана|кишені)(?!\w)"),
        ("hood", "present", r"(?<!\w)(?:с\s+капюшоном|з\s+капюшоном)(?!\w)"),
        ("hood", "absent", r"(?<!\w)без\s+капюшона?(?!\w)"),
        ("pockets", "patch", r"(?<!\w)(?:накладной\s+карман|накладні\s+кишені)(?!\w)"),
    ):
        for match in re.finditer(pattern, raw_text, re.IGNORECASE):
            add(field, value, match.start(), match.end())

    tokens = list(_TOKEN.finditer(raw_text))
    for token in tokens:
        if any(index in covered for index in range(token.start(), token.end())):
            continue
        normalized = token[0].casefold()
        for field, words in _VOCABULARY.items():
            if normalized in words:
                add(field, words[normalized], token.start(), token.end())
                break
        else:
            # Lowercase Cyrillic "с" is a preposition, not a size.
            # Other size aliases are exact token mappings, never transliteration.
            if normalized in _SIZES and (normalized != "с" or token[0].isupper()):
                next_token = next((t for t in tokens if t.start() > token.end()), None)
                if normalized == "с" and next_token is not None:
                    continue
                add("size", _SIZES[normalized], token.start(), token.end())

    groups: list[OptionGroup] = []
    # Preserve each contiguous slash enumeration literally. No claim that its
    # members are aliases, and no inferred assignment of shared descriptors.
    for match in re.finditer(r"[^\s/]+(?:\s*/\s*[^\s/]+)+", raw_text):
        groups.append(
            OptionGroup(
                match.start(),
                match.end(),
                match[0],
                tuple(part.strip() for part in match[0].split("/")),
            )
        )
        reasons.add("SLASH_OPTIONS_REQUIRE_REVIEW")
    if "/" in raw_text and not groups:
        reasons.add("SLASH_OPTIONS_REQUIRE_REVIEW")

    fields: dict[str, tuple[FieldCandidate, ...]] = {}
    for field in sorted(extracted):
        by_value: dict[str, FieldCandidate] = {}
        for candidate in extracted[field]:
            old = by_value.get(candidate.value)
            by_value[candidate.value] = (
                candidate
                if old is None
                else replace(
                    old,
                    evidence=old.evidence + candidate.evidence,
                    confidence=(
                        "AMBIGUOUS"
                        if "AMBIGUOUS" in (old.confidence, candidate.confidence)
                        else "EXPLICIT"
                    ),
                )
            )
        conflicting = len(by_value) > 1
        if conflicting:
            reasons.add(f"CONFLICTING_{field.upper()}")
        if field == "concept":
            reasons.add("CONCEPT_REQUIRES_REVIEW")
        fields[field] = tuple(
            replace(
                candidate,
                confidence=(
                    "AMBIGUOUS"
                    if conflicting
                    or candidate.confidence == "AMBIGUOUS"
                    or field == "concept"
                    or any(
                        evidence.start < group.end and evidence.end > group.start
                        for evidence in candidate.evidence
                        for group in groups
                    )
                    else "EXPLICIT"
                ),
            )
            for candidate in by_value.values()
        )

    unknown = tuple(
        UnknownDescriptor(
            token.start(),
            token.end(),
            token[0],
            "possible_item_code" if token[0].isdigit() else "unknown",
        )
        for token in tokens
        if not all(index in covered for index in range(token.start(), token.end()))
    )
    if unknown:
        reasons.add("UNCLASSIFIED_DESCRIPTORS")
    if not fields:
        reasons.add("NO_RECOGNIZED_FIELDS")
    distribution: Literal["NOT_APPLICABLE", "UNKNOWN_DISTRIBUTION"] = "NOT_APPLICABLE"
    if groups:
        distribution = "UNKNOWN_DISTRIBUTION"
        reasons.add("UNKNOWN_DISTRIBUTION")
    return ParsePreview(
        raw_text,
        " ".join(raw_text.casefold().split()),
        parser_version,
        fields,
        tuple(groups),
        unknown,
        tuple(sorted(reasons)),
        distribution,
    )
