# ADR-0002 — Catalog identity and nullable uniqueness

Status: Accepted (planning run 2, supersedes the revision-1 planning proposal)

## Context

Two related stores describe the same coat in different words on different days. The catalog has to absorb that without merging distinct goods, because a wrong merge corrupts stock for products that are physically different — the most expensive failure this system can produce (`known-risks.md`, `constitution.md` §24).

The identity chain is fixed by `CATALOG_ARCHITECTURE.md`:

```text
CanonicalConcept → ProductFamily → ProductVariant → Size
```

with `SourceIdentity` held separately and possibly `UNKNOWN` indefinitely.

Planning revision 1 proposed enforcing family identity with `UNIQUE (organization_id, canonical_concept_id, source_identity_id, garment_type_id)`, and — because PostgreSQL treats `NULL`s as distinct inside a unique index, which would silently disable that constraint — proposed sentinel rows (`SourceIdentity('—')`, `GarmentType('—')`) so the key never contained `NULL`.

Both halves of that proposal were wrong, for the same underlying reason: they let a database mechanism dictate the business model.

1. The unique constraint turns `(concept, source, garment_type)` into absolute business identity. It is not. Two families can legitimately share that triple and still be different products — different construction, cut, season or supplier batch, none of which the current schema models. The constraint would force the second one into the first row: a schema-level silent merge, which is exactly the failure the design exists to prevent.
2. The sentinel rows existed only to make that constraint work. A row labelled `'—'` meaning "no source" is a database workaround wearing a domain costume. It pollutes every query, every join and every UI list with a value the business never uses.

Separately, PostgreSQL 15 introduced `UNIQUE NULLS NOT DISTINCT`, which solves the NULL-in-unique-key problem directly wherever a unique constraint genuinely belongs.

## Decision

### 1. ProductFamily has independent identity

`ProductFamily.id` is a surrogate key. `(organization_id, canonical_concept_id, source_identity_id, garment_type_id)` is indexed **non-uniquely** and used as a candidate key and strong matching signal — never as business identity.

```sql
CREATE INDEX ix_family_signature ON product_family
  (organization_id, canonical_concept_id, source_identity_id, garment_type_id);
```

- Several families may share the signature.
- Creating a second family with an identical signature is allowed but never automatic: it requires a `NEW_MODEL` decision confirmed by a human, and `distinction_note` becomes mandatory on the new row.
- Automatic merge is forbidden. Merge is explicit, permissioned (`catalog:merge`), writes `merged_into_id`, is audited, and never rewrites historical `SaleItem` snapshots. *Amended by [ADR-0008](ADR-0008-catalog-correction.md) §10 (owner, 2026-10-03): a merge cannot be undone; it is previewed and confirmed instead.*

### 2. Sentinel rows only for genuine domain states

A sentinel row is legitimate only when the business actually has that state.

| Value | Verdict | Reason |
|---|---|---|
| `Size('UNKNOWN')` in an `UNSPECIFIED` size system | **Keep** | Legacy stock genuinely exists without a known size. It must be countable, sellable and reconcilable. A real business state |
| `SourceIdentity.semantic_type = UNKNOWN` | **Keep** | The business genuinely has not decided whether Belardi is a brand, supplier or factory |
| `SourceIdentity('—')`, `GarmentType('—')` placeholder rows | **Drop** | Pure database workaround. Plain `NULL` now means "not stated", and nothing depends on them since the family constraint is gone |

### 3. `NULLS NOT DISTINCT` where a unique constraint genuinely belongs

`ProductVariant` is the one place where attribute equality really does define identity: within a family, a variant *is* its attribute combination. A `NULL` attribute means "not applicable or unknown" and must collapse to a single row rather than allowing unlimited near-duplicates.

```sql
ALTER TABLE product_variant ADD CONSTRAINT uq_variant_attributes
  UNIQUE NULLS NOT DISTINCT
  (product_family_id, color_term_id, material_term_id, texture_term_id,
   fur_term_id, collar_term_id, length_cm);
```

`attributes` JSONB is descriptive, not part of identity, in Milestone 1. If a JSONB attribute turns out to define a distinct sellable item, that is the promotion trigger under `skills/taxonomy-evolution-guardian.md` — an additive migration that adds a column and extends this constraint.

### 4. Minimum PostgreSQL version

**PostgreSQL 15 or newer.** Docker Compose pins **17** (M1-002). CI runs integration tests against the same version (M1-003).

## Alternatives considered

- **Keep the unique constraint on the family triple.** Rejected: it is a schema-level silent merge. Rejected by the product owner at conceptual approval.
- **Keep sentinel rows everywhere for consistency.** Rejected: it makes every query filter out `'—'` forever and disguises a database limitation as domain vocabulary.
- **Application-level uniqueness check for variants instead of a constraint.** Rejected: races produce duplicate variants, which fragments inventory for the same physical product. The database should hold this one.
- **`COALESCE`-based functional unique index** (`UNIQUE (family_id, COALESCE(color_id, '00000000-…'))`). Rejected: it is the sentinel hack moved into the index definition, unreadable and error-prone across seven columns.
- **Hash the attribute set into a generated `variant_signature` column and make that unique.** Rejected for M1: it makes every JSONB change a new identity, fragmenting variants; revisit only if promoted columns prove insufficient.
- **Require PostgreSQL 14 compatibility.** Rejected: nothing in this project needs it; the deployment is new, and PostgreSQL 17 is the current stable line.

## Consequences

Positive:

- Family identity is a human/business decision, recorded and reversible, instead of a schema accident.
- Two families that look identical on paper can coexist while the business decides — the `AMBIGUOUS` path has somewhere to land.
- No placeholder rows leak into search results, dropdowns or reports.
- Variant proliferation stays under a real database constraint.

Negative — and this is the real cost:

- **The database can no longer prevent accidental duplicate families.** Invariant I14 ("uncertain interpretation never merges products") drops from an accidental `DB_ENFORCED` backstop to `SERVICE_ENFORCED` + `RECONCILIATION_DETECTED`. Mitigations, all in task M1-021: the matcher must return `AMBIGUOUS` rather than creating a family when the signature already exists; `NEW_MODEL` requires human confirmation and a `distinction_note`; a duplicate-signature report lists families sharing a signature for periodic review; a confirmed duplicate is merged, after a preview and an explicit confirmation (a merge cannot be undone — ADR-0008 §10).
- `NULLS NOT DISTINCT` is unfamiliar to many developers and must be commented in the migration, or someone will "fix" it later.
- Pinning PostgreSQL ≥ 15 rules out older managed instances. Acceptable — nothing is deployed yet.

## Operational impact

- **Deployment:** `postgres:17` in Docker Compose; the same major version in CI and production. A version mismatch is a release blocker, since `NULLS NOT DISTINCT` fails to parse below 15.
- **Migration:** both rules land in the M1-010 migration, with a comment explaining `NULLS NOT DISTINCT`. Migration tests must prove (a) two families with an identical signature can coexist, and (b) two variants differing only by a `NULL` attribute cannot.
- **Monitoring:** the duplicate-signature report is a scheduled query surfaced in the catalog review queue, not a silent log line.
- **Rollback:** adding a unique constraint later is possible but would fail on existing legitimate duplicates — treat any future attempt to "tighten" the family signature as a new ADR, never as a routine migration.
- **Verification status:** `NOT VERIFIED` — `NULLS NOT DISTINCT` behaviour on PostgreSQL 17 is asserted from documentation and must be proven by the M1-010 migration test before this ADR is considered validated in practice.
