# Workflow — Critical Stock / Money / Permission Change

Mandatory chain:

`Product -> Requirements -> Retail Domain -> Architect -> Threat Model -> DB/Concurrency -> Backend -> Frontend -> Integration Tests -> Concurrency Tests -> Security Review -> Adversarial Review -> E2E -> Release Gate`

Required properties:
- domain invariant stated;
- transaction boundary explicit;
- idempotency behavior explicit;
- rollback behavior explicit;
- authorization/tenant boundary explicit;
- observability/logging explicit;
- concurrency test included;
- release rollback plan documented.
