# Skill: Catalog Normalization & Parser

## Mission
Convert raw store-language lines into structured candidate fields while preserving the exact original text.

## Responsibilities
- Normalize casing, whitespace, common spelling variants and size/color aliases.
- Extract category/type/concept/source/color/size/length/material/texture/fur/collar and supported descriptors.
- Detect slash-separated option groups.
- Return unclassified descriptors rather than inventing semantics.
- Produce per-field confidence and evidence.

## Do not
- Delete raw input.
- Interpret every slash as synonymy.
- Guess quantity distribution across variants.
- Treat parser output as authoritative inventory mutation.
