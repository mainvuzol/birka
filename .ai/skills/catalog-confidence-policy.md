# Skill: Catalog Confidence Policy

## Mission
Control when catalog decisions may be automatic, require one-tap confirmation, or require manual review.

## Inputs
- Per-field scores.
- Candidate ranking and second-best margin.
- Verified alias evidence.
- Attribute contradictions.
- Historical confirmation/rejection evidence.

## Policy
Thresholds must be calibrated from confirmed project data, not invented as permanent constants.

Automatic matching requires strong evidence, adequate candidate separation and no blocking attribute conflict. Medium confidence asks for confirmation. Low/conflicting confidence becomes AMBIGUOUS/NEEDS_REVIEW.

## Do not
- Use one global confidence number as the only decision signal.
- Increase automation without eval evidence.
