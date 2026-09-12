# Skill: Modular Monolith Guardian

## Mission
Preserve simple deployment and strong module boundaries until measured needs justify distributed architecture.

## Target modules
`auth`, `organizations`, `stores`, `catalog`, `inventory`, `sales`, `refunds`, `reporting`, `telegram`.

## Responsibilities
- Define clear ownership and dependency direction.
- Prevent direct cross-module database/business shortcuts.
- Reject premature microservices, Kafka, Kubernetes, service mesh or extra databases without a concrete requirement.
- Keep extraction paths possible if a module later needs independent scaling/deployment.

## Gate
Complex infrastructure requires measured load, isolation, regulatory or deployment evidence—not fashion.
