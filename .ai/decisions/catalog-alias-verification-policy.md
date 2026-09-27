# Proposed catalog alias verification policy

Date: 2026-09-27. Status: **proposal and implementation preconditions only**.
This document does not authorize promotion, adopt a threshold, or change runtime
behavior. It supplements [adaptive learning](../ADAPTIVE_CATALOG_LEARNING.md).

## Current authority and evidence

All matcher outcomes require human confirmation. `SAME_VARIANT` is an advisory
proposal, not a merge, an applied decision, or a stock operation. A false
`SAME_VARIANT` proposal is a dangerous recommendation; it must not be reported as
an actual false merge. Lexical scores and candidate margins are retrieval signals,
not calibrated probabilities of identity correctness.

Explicit alias feedback currently collects confirmations and rejections, updates
counters and may reduce trust. It never promotes a mapping to `VERIFIED`.
Consistent historical `VERIFIED` mappings can remain verified, but their existence
is not evidence that this proposal's future verification requirements were met.
Verified status strengthens retrieval only; it must not independently authorize
automatic resolution, identity merging, stock changes or financial operations.

At this stage, the committed evaluation material contains **zero independently
human-confirmed identity examples**. Real source text, the parser's real-input
corpus, synthetic catalog fixtures, and developer-authored expected outcomes do
not fill that gap. No production precision or promotion readiness is established.
The count describes the reviewed repository evaluation dataset, not an assertion
about unseen production databases or every historical human decision.

## Required provenance

An evaluation or verification record must retain the original raw-input reference
and exact text (or a governed private reference), source store and organization,
decision and feedback identifiers, original proposed candidates, actual reviewed
target, reviewer and review time, and any correction or rejection reason. Preserve
parser/matcher versions, knowledge revision, dataset version and catalog snapshot
identity so an evaluation can be reproduced without future knowledge leaking in.

Keep the normalization rule explicit: casefold plus whitespace collapse; do not
strip descriptors, split slash-separated alternatives or infer source semantics.
Keep normalized phrase, target type and target identity distinct. Organization
scope is mandatory. Names or equal family signatures are not identity proofs.

A labeled example must distinguish an unambiguous existing variant from a new
variant, new model, new category or unresolved identity. Human uncertainty remains
unresolved; an evaluator must not guess a gold target to improve coverage. An
applied decision alone does not prove independent ground truth: a reviewer may
have accepted the suggestion shown to them. Record how identity was checked and
whether the label was obtained independently of the matcher being evaluated.

Private source material stays outside committed fixtures unless its disclosure
is explicitly authorized. Sanitization must preserve the semantics being tested
and retain a controlled provenance link; invented replacement data stays marked
synthetic.

## Evaluation before stronger authority

Separate data used to build aliases, tune rules or choose thresholds from the
held-out evaluation set. Assign connected groups to one split: rows sharing a
normalized phrase **or** family identity must not cross development and holdout.
Include linked variants, repeated source rows and known equivalent phrases in the
grouping review. Split before tuning and prevent aliases learned from held-out
rows from entering the evaluated knowledge snapshot. Record and check split
manifests; a new UUID does not make repeated evidence independent.

Report synthetic regression results separately from human-confirmed held-out
results. Synthetic cases can expose wrong decisions and regressions, but passing
them cannot estimate real-world precision. Publish sample counts, exclusions,
coverage, decision-class distribution, abstentions, false `SAME_VARIANT`
proposals and their denominators. Report identity correctness against the actual
target, not merely agreement on the decision-type string. Missing labels,
incomplete candidate pools and zero denominators must not appear as perfect
accuracy. Include uncertainty and relevant hard cases, such as contradictory
attributes, competing aliases and distinct families with similar descriptions.

Evaluation output must identify what was actually measured: stored historical
proposals versus a replay of a particular matcher against a fixed catalog. A
historical-proposal report is not evidence that current matcher behavior was run.
No acceptable error budget or numeric promotion threshold is adopted here. Any
future threshold and release criterion require a separately reviewed evaluation
with representative human-confirmed data; false identity assertions matter more
than reducing manual review.

## Preconditions for a future manual verification command

Confirmation counts alone must never grant `VERIFIED`. Counts are observations,
not independent reviewers or independent examples. Retries, duplicated raw rows,
new decision UUIDs and repeated activity by one person cannot substitute for
identity evidence.

A future command must require all of the following:

- An explicitly authorized reviewer chooses a concrete mapping and records the
  evidence and rationale. The permission policy must be specified and enforced
  server-side; existing `catalog:confirm` access must not silently acquire new
  verification authority through this document.
- The target is active and its complete identity chain belongs to the current
  organization. Preserve raw evidence and all competing mappings.
- All mappings for the normalized phrase are examined across target types.
  Competing positive targets, unresolved rejections, ambiguous history, or
  structured contradictions block verification. A larger count does not resolve
  a conflict. A separate explicit conflict-resolution workflow must explain any
  superseded interpretation without rewriting old evidence.
- A permanent command identifier and canonical request bind retries to the same
  action. Replays return its recorded result without recounting evidence;
  changed requests conflict. Recheck current authorization before replay.
- Phrase-level concurrency control, target protection, current evidence checks,
  status update, audit record and knowledge-revision invalidation commit in one
  transaction. Define lock order against existing feedback and catalog writers
  and prove concurrent verification/rejection behavior with database tests.
- Audit records preserve previous and resulting status, actor, command identity,
  evidence references and reason. Failure leaves no partial promotion, and
  verification does not resolve a pending decision, learn another alias or write
  inventory as a side effect.

Implementing manual verification and increasing automatic matching authority are
separate changes. Neither is enabled by shipping an evaluator or this proposal.

## Demotion and correction

Retain the current conservative feedback behavior: negative-only evidence may
become `REJECTED`; mixed confirmation/rejection or competing positive mappings
become `AMBIGUOUS`. Existing verified mappings participate in conflict detection
even when their historical counters are zero. Historical `AMBIGUOUS` remains
ambiguous on later feedback; additional confirmations must not erase it.

Demotion invalidates catalog knowledge for subsequent matching. It must not
rewrite immutable source input, past decisions, historical sale descriptions,
stock movements or prior audit/evidence rows. If an earlier applied identity is
suspected to be wrong, open a separately authorized correction workflow rather
than silently moving inventory or merging products.

## Unresolved work

Human-confirmed identity dataset collection, independent labeling procedure,
representative holdout size, accepted error budget, reviewer permission policy,
explicit conflict resolution, manual verification API/UI and operational
monitoring are not supplied by this document. Promotion and automatic matching
remain disabled pending their own design, implementation and verification.
