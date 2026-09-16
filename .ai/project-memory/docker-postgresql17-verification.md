# Isolated Docker / PostgreSQL17 verification — 2026-09-16

Status: PASS. Previously unexecuted Compose stack and pinned PostgreSQL major version were exercised locally, using working-tree code at main7f761c6 plus the pending validation-handler fix. No production deployment or Telegram client E2E is claimed.

## Isolation

Portable Lima2.2.0 (official release SHA256 bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3), macOS VZ VM,2CPU/3GiB RAM/20GiB sparse disk. Dedicated LIMA_HOME under /private/tmp/birka-docker-verify-20260916. No host filesystem mounts (`--mount-none`, confirmed no virtiofs mounts); no SSH-agent forwarding or host SSH-public-key loading. App port forwarding disabled. Docker installed only inside guest; no host PATH, shell profile, default Docker context, login service or certificate-trust changes.

Copied only tracked backend/frontend/infra files (working-tree contents), plus pre-commit config required by a toolchain test. No work directories or real .env/private datasets copied. Random disposable credentials and synthetic Telegram token. Rootless Docker29.8.1, Compose5.5.1, Linux arm64. Project name birka-verify-20260916. Only Compose override: Caddy ports bound to guest127.0.0.1:18080/18443 instead of privileged80/443; inaccessible via app port forwarding from host. All image builds/downloads and volumes inside guest.

## Results

- Original backend/frontend Dockerfiles build successfully. Frontend builds with Node24 image and npm ci.
- `docker compose config --quiet`:pass.
- `compose up -d --wait db`:healthy; actual postgres:17-alpine version17.11.
- PostgreSQL image digest:sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73.
- Original Compose initdb settings used: ICU uk-UA / libc C.UTF-8; catalog datlocprovider=i,datlocale=uk-UA; lower('ОЛЯ')='оля'.
- `compose run --rm --no-deps api alembic upgrade head`:all4 revisions applied to empty database. `alembic check`:no new upgrade operations.
- `compose up -d`:API/Caddy running, database healthy, one-shot web exited0 as designed.
- HTTPS /api/v1/health and frontend HTML served by Caddy. Final TLS request used `curl --cacert` with guest-only Caddy test CA, without disabling verification or modifying macOS trust. Public ACME/domain setup remains untested.
- Real HTTP synthetic flow: signed Telegram initData authentication → /me → product → receipt2units → sale1unit at300−20=280UAH → refund1/restock → refund with new idempotency key but same command. Exact response replay; final stock2; refund280UAH.
- Full backend suite inside API-based disposable test container, actual PostgreSQL17: **361passed,0skipped**,2existing dependency deprecation warnings. Tests mounted read-only from copied guest source; dev dependencies installed only in disposable test container.
- First full run:360passed/1failed because production image has no root pre-commit config. Corrected the test harness by copying that tracked file read-only; no code changes or weakened tests.
- Separate disposable database:upgrade head → downgrade base → upgrade head → alembic check:pass; database removed.

Representative commands inside guest, using the project-specific wrapper:
```
docker compose -p birka-verify-20260916 --env-file test.env -f docker-compose.yml -f verify.override.yml build
# Start db, explicitly migrate, then start API/Caddy; migrations are not automatic.
compose up -d --wait db
compose run --rm --no-deps api alembic upgrade head
compose run --rm --no-deps api alembic check
compose up -d
# Separate test container with copied tests and root config mounted read-only:
BIRKA_TEST_DATABASE_URL="$BIRKA_DATABASE_URL" pytest -q
```

Evidence logs/scripts: output/verification/2026-09-16-docker/. Test credentials are not in these artifacts. Rootless docker compose cp hit a guest permission limitation for copying the CA; docker exec cat retrieved the public test CA successfully instead. No product change required.

## Limits

This closes the local Compose startup and PostgreSQL17 evidence gap. It does not prove public HTTPS issuance, production backup/restore, uptime, capacity, seller UI or Telegram E2E. Shared warehouses/payment extensions remain unimplemented. No migration/code changes were needed for this verification; only report/status documentation was updated. Existing pending handler fixes remain uncommitted; no push performed.

## Cleanup completed

`limactl stop birka-check` and `limactl delete birka-check` completed; private instance list is empty. Removed the dedicated temporary runtime/state/source copy and credentials. Lima placed its downloaded Ubuntu image in the standard macOS cache despite XDG_CACHE_HOME; removed only that exact URL-cache entry after verifying it was created during this run. Other cache entries/directories were not removed. All guest Docker images, containers, volumes and synthetic databases disappeared with the deleted VM. No global Docker prune/delete commands used. Only verification documentation/logs remain in the Birka repository.
