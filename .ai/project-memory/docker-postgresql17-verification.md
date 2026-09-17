# Isolated Docker / PostgreSQL 17 verification

Two runs: **2026-09-16** (the pre-M1-029 baseline, full stack) and **2026-09-17** (the M1-029 stock re-key). The second is at the bottom.

# Run 1 — 2026-09-16

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


# Run 2 — 2026-09-17 — the M1-029 stock re-key

Status: **PASS.** The change set that moves the stock key from the selling store to the warehouse
was exercised on real PostgreSQL 17, which run 1 did not cover: that run predates `0005`/`0006`
and its 361 tests are a different suite.

## Isolation

Same shape as run 1, and deliberately so. Portable Lima 2.2.0, the same archive — sha256
`bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3`, matching the digest recorded
above, so the tool is byte-identical to the one already vouched for. macOS VZ VM, 2 CPU / 4 GiB /
20 GiB sparse disk, dedicated `LIMA_HOME` under `/private/tmp/birka-docker-verify-20260917`,
instance `birka-pg17`, Ubuntu 26.04 guest, rootless Docker 29.8.1 with Compose v5.5.1.

`--mount-none`, confirmed: `mount | grep -E "virtiofs|9p"` finds nothing in the guest. Source went
in as a 198 KB tarball of `backend/`, `infra/` and `.pre-commit-config.yaml` — 142 files, no
`data/`, no `.git`, no `output/`, no real credentials. Compose project `birka-pg17-20260917`,
disposable passwords and a synthetic bot token generated inside the guest. No host Docker context,
PATH, shell profile or certificate trust touched; the host still has no Docker installed.

## Results

- `postgres:17-alpine` → digest `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`,
  the same image as run 1. `PostgreSQL 17.11 on aarch64-unknown-linux-musl`.
- Project `docker-compose.yml` unmodified, no override. `docker compose config --quiet` passes;
  `db` reaches healthy. Catalog `datlocprovider=i`, `datlocale=uk-UA`, `datctype=C.UTF-8`;
  `lower('ОЛЯ')='оля'`, so the ICU behaviour the matcher depends on is real here.
- `alembic upgrade head`: **all 6 revisions** apply to an empty PostgreSQL 17 database, including
  `0006_stock_rekey` with its preflight, its per-row backfill assertions and its suspend/restore of
  the append-only ledger trigger. `alembic check`: no new upgrade operations.
- Separate disposable database: `upgrade head` → `downgrade base` → `upgrade head` = 6 / 6 / 6,
  `alembic check` clean afterwards, database dropped.
- Full backend suite in a disposable test container built from the production API image, dev
  dependencies installed only there, against the PostgreSQL 17 service: **394 passed, 0 skipped**,
  the two known dependency deprecation warnings. Every migration test that creates its own scratch
  databases ran here too.
- Invariant sweep on the database the suite left: no negative balances, no movement without a
  warehouse, no non-transfer movement without an acting store, no sale line without a source
  warehouse, no refund destination disagreeing with `restock`, no cross-tenant ledger row. The
  append-only trigger is enabled on all four protected tables. Ledger divergences are exactly the
  two deliberate I3 detection injectors, identical to the local 16.2 run.
- `compose up -d api` then `GET /api/v1/health` → `200 {"status":"ok","environment":"local"}`: the
  production image boots against PostgreSQL 17.

One change was needed to run at all, and it is a real portability fix rather than a concession:
the migration tests derived their maintenance connection only from a Unix-socket URL, so they
would have failed against any TCP PostgreSQL — including CI. They now read either shape.

## Limits

Caddy, TLS, the frontend build and the Telegram E2E flow were verified in run 1 and not repeated;
nothing in M1-029 touches them. `POST /sales` p95 is still unmeasured — a functional run is not a
load profile. This says nothing about production deployment, backup/restore, uptime or capacity.

## Cleanup completed

`limactl stop -f` + `limactl delete -f`; instance list empty. The whole
`/private/tmp/birka-docker-verify-20260917` tree removed — Lima binaries, VM disk, source tarball,
generated credentials. Lima again cached the Ubuntu image under the standard macOS cache despite
`XDG_CACHE_HOME`; that single URL entry was created during this run and only it was removed, after
checking its `url` file and timestamp. No global Docker prune. Evidence kept in
`output/verification/2026-09-17-pg17-docker/`.
