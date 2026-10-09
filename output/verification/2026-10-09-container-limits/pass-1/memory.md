# Memory under the heaviest work, inside the limits


```sh
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists birka_perf'
```

exit 0

```

```

```sh
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists birka_json_perf'
```

exit 0

```
NOTICE:  database "birka_json_perf" does not exist, skipping
```

## 1. the hot path, six sellers

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" birka_perf'
```

exit 0

```

```

```sh
docker compose run -d --name birka-limits-perf-api --no-deps -e BIRKA_APP_ENV=ci -e BIRKA_LOG_LEVEL=WARNING -e BIRKA_DATABASE_URL=postgresql+asyncpg://birka:$(grep ^POSTGRES_PASSWORD= /Users/nikitahlushak/.cache/birka-runtime/limits/.env | cut -d= -f2-)@db:5432/birka_perf api sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 58043 --no-access-log"
```

exit 0

```
85869895324dcd44b5eb69e5d074ce3042a265f0080d9828bba39982e30aa346
 Container birka-limits-perf-api Creating 
 Container birka-limits-perf-api Created
```

```sh
docker compose --profile measure run --rm --no-deps -e BIRKA_PERF_DATABASE_URL=postgresql+asyncpg://birka:$(grep ^POSTGRES_PASSWORD= /Users/nikitahlushak/.cache/birka-runtime/limits/.env | cut -d= -f2-)@db:5432/birka_perf -e BIRKA_PERF_API_URL=http://birka-limits-perf-api:58043 -e BIRKA_PERF_GATE=all measure python -m scripts.measure_hot_path
```

exit 0

```
    "concurrency": 1,
    "n": 200,
    "p50": 11.544499999985192,
    "p95": 19.528292000018155,
    "p99": 66.36070799999061,
    "max": 76.23491700002205,
    "budget": 500.0,
    "verdict": "pass",
    "gated": true
  },
  {
    "case": "POST /sales \u00b7 paid in parts (6 sellers)",
    "concurrency": 6,
    "n": 300,
    "p50": 45.770083000007844,
    "p95": 71.55220800001416,
    "p99": 124.70220799997378,
    "max": 160.60295800002677,
    "budget": 500.0,
    "verdict": "pass",
    "gated": true
  }
]
 Container birka-limits-try-measure-run-3373078a1b56 Creating 
 Container birka-limits-try-measure-run-3373078a1b56 Created
```

```sh
/Users/nikitahlushak/.docker/bin/docker inspect -f '{{.State.OOMKilled}} {{.State.Status}}' birka-limits-perf-api
```

exit 0

```
false running
```

The hot path's API: OOMKilled, status: `false running`.

```sh
/Users/nikitahlushak/.docker/bin/docker rm -f birka-limits-perf-api
```

exit 0

```
birka-limits-perf-api
```

## 2. an opening list's approval, 2 000 to 10 000 answers

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" birka_json_perf'
```

exit 0

```

```

```sh
docker compose --profile measure run --rm --no-deps -v /Users/nikitahlushak/.cache/birka-runtime/limits/approval:/out -e BIRKA_PERF_OUTPUT=/out -e BIRKA_PERF_DATABASE_URL=postgresql+asyncpg://birka:$(grep ^POSTGRES_PASSWORD= /Users/nikitahlushak/.cache/birka-runtime/limits/.env | cut -d= -f2-)@db:5432/birka_json_perf measure python -m scripts.measure_opening_approval
```

exit 0

```
  run 3: approve 3.25 s, 14045 statements, slowest 0.115 s, reply 1131 bytes
  2000: slowest approval 3.25 s, slowest statement 0.115 s -> PASS; adding a 1 000-line file 0.29 s, removing it 0.05 s; pages GET /snapshots/{id} 0.042 s, GET lines, last page 0.014 s, GET parts 0.007 s, GET application, first 500 0.013 s

5000 allocations, 3 runs
  run 1: built 5000 lines in 61.2 s (slowest part added through the service 0.29 s)
2026-10-09 19:46:39 [info     ] inventory.movements_applied    [app.modules.inventory.service] lines=5000 organization_id=0e9c57b1-5bff-4923-ad0b-4ed15eace5ee types=['OPENING_BALANCE']
  run 1: approve 8.14 s, 35048 statements, slowest 0.312 s, reply 1131 bytes
  run 2: built 5000 lines in 63.4 s (slowest part added through the service 0.29 s)
2026-10-09 19:47:50 [info     ] inventory.movements_applied    [app.modules.inventory.service] lines=5000 organization_id=0e9c57b1-5bff-4923-ad0b-4ed15eace5ee types=['OPENING_BALANCE']
  run 2: approve 8.18 s, 35048 statements, slowest 0.269 s, reply 1131 bytes
  run 3: built 5000 lines in 62.2 s (slowest part added through the service 0.29 s)
2026-10-09 19:49:01 [info     ] inventory.movements_applied    [app.modules.inventory.service] lines=5000 organization_id=0e9c57b1-5bff-4923-ad0b-4ed15eace5ee types=['OPENING_BALANCE']
  run 3: approve 8.52 s, 35048 statements, slowest 0.278 s, reply 1131 bytes
  5000: slowest approval 8.52 s, slowest statement 0.312 s -> PASS; adding a 1 000-line file 0.33 s, removing it 0.06 s; pages GET /snapshots/{id} 0.047 s, GET lines, last page 0.013 s, GET parts 0.009 s, GET application, first 500 0.076 s

10000 allocations, 3 runs
  run 1: built 10000 lines in 155.7 s (slowest part added through the service 0.30 s)
2026-10-09 19:51:46 [error    ] request.unhandled_error        [app.core.correlation] error=DBAPIError method=POST path=/api/v1/snapshots/3ae9a2c1-4cb6-4111-8848-b251ac845493/approve
  run 1: approve REFUSED after 7.74 s, 40041 statements: HTTP 500 {"code": "INTERNAL_ERROR", "message": "Внутрішня помилка сервера.", "details": {}}
  not repeated: the refusal does not depend on the run
  10000: refused, slowest approval 7.74 s, slowest statement 0.021 s -> FAIL; adding a 1 000-line file 0.28 s, removing it 0.07 s; pages GET /snapshots/{id} 0.047 s, GET lines, last page 0.014 s, GET parts 0.014 s

largest size that passes: 5000
 Container birka-limits-try-measure-run-e2e78af1dd7c Creating 
 Container birka-limits-try-measure-run-e2e78af1dd7c Created
```

The approval's measurement exited 0 (137 would be a kill for memory).

## 3. the night's backup and drill of the largest database

```sh
docker compose --profile ops run --rm -e BIRKA_DATABASE_URL=postgresql+asyncpg://birka:$(grep ^POSTGRES_PASSWORD= /Users/nikitahlushak/.cache/birka-runtime/limits/.env | cut -d= -f2-)@db:5432/birka_json_perf ops
```

exit 0

```
{"started_at": "2026-10-09T19:51:49.273751+00:00", "ok": true, "problems": [], "archive": "birka-20261009T195149Z.dump.age", "bytes": 16663967, "rows": 271191, "drill": {"ok": true, "restore_seconds": 1.353, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T19:51:51.889277+00:00"}
 Container birka-limits-try-db-1 Running 
 Container birka-limits-try-db-1 Waiting 
 Container birka-limits-try-db-1 Healthy 
 Container birka-limits-try-ops-run-73521dca2eee Creating 
 Container birka-limits-try-ops-run-73521dca2eee Created
```

## 4. at rest

```sh
/Users/nikitahlushak/.docker/bin/docker ps -a --filter label=com.docker.compose.project=birka-limits-try --format '{{.Names}}' | xargs -I{} /Users/nikitahlushak/.docker/bin/docker inspect -f '{{.Name}} OOMKilled={{.State.OOMKilled}} {{.State.Status}}' {}
```

exit 0

```
/birka-limits-try-caddy-1 OOMKilled=false running
/birka-limits-try-backup-watch-1 OOMKilled=false running
/birka-limits-try-api-1 OOMKilled=false running
/birka-limits-try-web-1 OOMKilled=false exited
/birka-limits-try-db-1 OOMKilled=false running
```

```
/birka-limits-try-caddy-1 OOMKilled=false running
/birka-limits-try-backup-watch-1 OOMKilled=false running
/birka-limits-try-api-1 OOMKilled=false running
/birka-limits-try-web-1 OOMKilled=false exited
/birka-limits-try-db-1 OOMKilled=false running
```

## Peaks, MiB (sampled every second, 9 minutes)

| container | peak | limit |
|---|---|---|
| birka-limits-perf-api | 234 | 3072 |
| birka-limits-try-api-1 | 235 | 3072 |
| birka-limits-try-backup-watch-1 | 191 | 3072 |
| birka-limits-try-caddy-1 | 21 | 3072 |
| birka-limits-try-db-1 | 256 | 3072 |
| birka-limits-try-measure-run-3373078a1b56 | 70 | 3072 |
| birka-limits-try-measure-run-e2e78af1dd7c | 300 | 3072 |
| birka-limits-try-ops-run-73521dca2eee | 181 | 3072 |

## By phase

- 1. the hot path, six sellers: birka-limits-perf-api 234, birka-limits-try-api-1 221, birka-limits-try-backup-watch-1 190, birka-limits-try-caddy-1 19, birka-limits-try-db-1 136, birka-limits-try-measure-run-3373078a1b56 70
- 2. an opening list's approval, 2 000 to 10 000 answers: birka-limits-try-api-1 235, birka-limits-try-backup-watch-1 191, birka-limits-try-caddy-1 21, birka-limits-try-db-1 256, birka-limits-try-measure-run-e2e78af1dd7c 300
- 3. the night's backup and drill of the largest database: birka-limits-try-api-1 221, birka-limits-try-backup-watch-1 189, birka-limits-try-caddy-1 20, birka-limits-try-db-1 182, birka-limits-try-ops-run-73521dca2eee 181
- 4. at rest: birka-limits-try-api-1 222, birka-limits-try-backup-watch-1 190, birka-limits-try-caddy-1 20, birka-limits-try-db-1 197
