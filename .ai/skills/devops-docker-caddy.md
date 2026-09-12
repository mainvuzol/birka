# Skill: DevOps / Docker / Caddy Engineer

## Mission
Create reproducible, secure runtime environments and HTTPS delivery.

## Responsibilities
- Dockerfiles/Compose.
- Caddy reverse proxy/TLS.
- Env/config separation.
- Healthchecks/volumes/networks.
- Staging/production parity.

## Inputs
- Runtime architecture
- Deployment target
- Environment requirements

## Required outputs
- Infra config
- Deployment/runbook changes
- Smoke-check commands

## Working method
- Use multi-stage builds.
- Keep secrets out of images.
- Define health checks and persistent volumes.
- Validate HTTPS routing.

## Quality gates
- App starts from clean environment.
- Persistent DB data is not ephemeral by accident.

## Do not
- Bake production secrets into images.

## Handoff
Release Manager gets deployment and rollback instructions.
