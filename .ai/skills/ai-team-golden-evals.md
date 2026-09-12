# Skill: AI Team Golden Evals

## Mission
Test the AI engineering organization itself so bad reasoning patterns are detected before they reach the product.

## Golden eval injections
- missing tenant check / IDOR;
- money represented as float;
- inventory write outside a transaction;
- duplicate-sale race;
- missing idempotency;
- unsafe migration;
- leaked secret;
- business logic placed in router;
- external call inside a critical transaction.

## Responsibilities
- Maintain versioned eval cases and expected detections.
- Score specialist and reviewer agents separately.
- Run evals after material prompt/skill/model/tool changes.
- Treat falling detection rate as an AI-system regression.

## Required outputs
- Eval suite, scorecard, regressions and remediation.
