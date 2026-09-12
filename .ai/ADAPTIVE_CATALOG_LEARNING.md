# Adaptive Catalog Learning Model

## Principle

The system should learn the language of these specific stores over time without allowing an LLM to silently rewrite catalog identity or stock.

**Learning may become more helpful automatically. Authority may not become stronger automatically without evidence.**

## Matching pipeline

```text
raw input
 -> normalize
 -> extract obvious structured attributes
 -> verified exact aliases
 -> lexical/fuzzy retrieval
 -> semantic retrieval when useful
 -> top candidates
 -> attribute compatibility checks
 -> optional LLM rerank/parse
 -> confidence policy
 -> automatic / one-tap confirmation / manual review
 -> feedback evidence
```

## Decision types

Every match must resolve to one of:
- `SAME_VARIANT`
- `NEW_VARIANT`
- `NEW_MODEL`
- `NEW_CATEGORY`
- `AMBIGUOUS`

Do not reduce the decision to only `existing product` vs `new product`.

## Confidence is per field

Store confidence separately for model/concept, source, color, size, length, garment type and other extracted fields. A line may have a certain model and size while garment type remains uncertain.

## Candidate margin

A high top score is not sufficient if the second candidate is almost equal. Automatic matching requires both adequate top confidence and adequate separation from competing candidates.

## Structured conflicts override semantic similarity

Semantic similarity must not merge variants when strong structured evidence conflicts, such as different length/color/size/source identity where those fields define a different family or variant.

## Alias evidence

Repeated human confirmations may promote a normalized phrase from `NEW` -> `LEARNING` -> `VERIFIED`. Rejections lower trust. Conflicting mappings produce `AMBIGUOUS`, not forced automation.

## Human-in-the-loop

- High confidence + no conflicts + strong margin: may auto-match according to calibrated policy.
- Medium confidence: show 2–3 candidates for one-tap confirmation.
- Low confidence or conflicting evidence: manual selection or new item flow.

## Feedback

Store predicted target, actual confirmed target, model/matcher version, per-field scores, user correction, timestamp and source store. Feedback is training/evaluation data and immediate retrieval memory.

## No online fine-tuning

Do not retrain/deploy model weights after each correction. Improve immediately via verified aliases, statistics and retrieval memory. Fine-tuning is optional later, offline, versioned, evaluated and rollback-capable.

## Evaluation before increasing automation

Before lowering human-confirmation rates, measure precision on a held-out, human-confirmed dataset. False merge is more dangerous than asking one extra confirmation.
