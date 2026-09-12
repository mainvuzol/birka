# Workflow: Catalog Ingestion

`raw entry -> persist raw -> normalize -> parse -> retrieve candidates -> compatibility checks -> decision -> human confirmation if needed -> catalog mutation -> evidence update -> verify`

## Mandatory rules
- Persist raw input before interpretation.
- Do not mutate inventory from an unresolved catalog match.
- New variants/families must preserve provenance.
- Unknown descriptors survive the workflow.
