# PostgreSQL 17 verification of M1-029 — 2026-09-17

Isolated Docker run of the stock re-key change set. Commands and results, in order.

## Environment

- Portable Lima 2.2.0, `lima-2.2.0-Darwin-arm64.tar.gz`, sha256
  `bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3` — byte-identical to the
  archive used on 2026-09-16, whose digest is recorded in that report.
- macOS VZ VM, 2 CPU / 4 GiB / 20 GiB sparse disk, instance `birka-pg17`, dedicated `LIMA_HOME`
  under `/private/tmp/birka-docker-verify-20260917`.
- `--mount-none`: `mount | grep -E "virtiofs|9p"` returned nothing inside the guest. No host
  path is reachable from the VM; source was copied in as a 198 KB tarball of `backend/`,
  `infra/` and `.pre-commit-config.yaml` (142 files, no `data/`, no `.git`, no `output/`).
- Rootless Docker 29.8.1, Compose v5.5.1, Linux arm64, Ubuntu 26.04 guest.
- Compose project `birka-pg17-20260917`, disposable credentials generated in the guest.
- No host Docker context, PATH, shell profile or certificate trust was touched; the host has no
  Docker at all.

## Database

```
postgres:17-alpine → postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
PostgreSQL 17.11 on aarch64-unknown-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
datlocprovider=i  datlocale=uk-UA  datcollate=C  datctype=C.UTF-8  encoding=UTF8
lower('ОЛЯ') = 'оля'   upper('оля') = 'ОЛЯ'
```

The project's own `docker-compose.yml` and its `POSTGRES_INITDB_ARGS`; no override.

## Migrations

```
alembic upgrade head      6 revisions applied to an empty PostgreSQL 17 database
alembic check             No new upgrade operations detected.
```

Round trip on a second, separate database:

```
upgrade head    6
downgrade base  6
upgrade head    6
alembic check   No new upgrade operations detected.
```

## Full suite

Disposable test container from the built API image, dev dependencies installed inside it only,
source copied in, `BIRKA_TEST_DATABASE_URL` pointing at the PostgreSQL 17 service:

```
394 passed, 2 warnings in 19.22s
```

Zero skips. The two warnings are pre-existing dependency deprecations. See `tests.log`.

## Invariant sweep on the database the suite left behind

```
negative inventory: 0
movements with no warehouse: 0
movements with no acting store (non-transfer): 0
sale lines with no source warehouse: 0
refund destination disagreeing with restock: 0
cross-tenant ledger rows: 0
append-only trigger enabled: O
append-only tables with a trigger: 4
ledger divergence: 5
ledger divergence: 7
```

The two divergences are the deliberate I3 detection injectors, identical to the local run. The
append-only trigger is enabled on all four protected tables after `0006` suspended and restored
it.

## API

```
compose up -d api
GET /api/v1/health -> 200 {"status":"ok","environment":"local"}
```

The production image boots against PostgreSQL 17 and serves traffic.

## Not covered by this run

Caddy, TLS, the frontend build and the Telegram E2E flow were exercised on 2026-09-16 and were
not repeated: nothing in M1-029 touches them. `POST /sales` p95 was not measured here either —
the budget needs a load profile, not a functional run.

## Cleanup

`limactl stop` + `limactl delete` for the instance, then removal of the whole
`/private/tmp/birka-docker-verify-20260917` tree, including the Lima binaries, the VM disk, the
source tarball and the generated credentials. Only this report and `tests.log` remain.
