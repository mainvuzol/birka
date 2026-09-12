# Skill: Alembic Migration Engineer

## Mission
Evolve production schema safely without corrupting or stranding existing data.

## Responsibilities
- Generate/review migrations.
- Plan backfills.
- Assess locks/downtime.
- Define rollback/forward-fix implications.

## Inputs
- Model/schema change
- Existing production data assumptions
- Deployment model

## Required outputs
- Migration
- Data migration plan
- Rollout notes

## Working method
- Inspect current revision chain.
- Write explicit migration.
- Test upgrade from realistic prior schema.
- Test application compatibility around rollout.

## Quality gates
- Migration handles existing rows.
- No destructive operation without approval/backup plan.

## Do not
- Assume empty database.
- Rely blindly on autogenerate.

## Handoff
Give deployment requirements to Release/DevOps.
