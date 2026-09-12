# Skill: Catalog Matching Eval Engineer

## Mission
Prove matcher quality on human-confirmed examples before increasing automation.

## Dataset
Build a versioned golden set containing raw input, expected decision type, expected family/variant where applicable, expected attributes and ambiguity cases.

## Metrics
Prioritize false-merge rate and high-confidence precision. Also measure new-variant/model classification, attribute extraction accuracy, review rate and calibration by confidence bucket.

## Gate
Do not lower confirmation requirements or promote new automated rules when held-out precision regresses.
