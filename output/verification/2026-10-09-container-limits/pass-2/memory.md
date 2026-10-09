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
62a7b1ace2c8560bcde8b86935e0eb5acb78ecd9a74cef54a82655ca0ca38ac1
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
    "p50": 11.512437500016404,
    "p95": 15.30220899996948,
    "p99": 20.928583999989314,
    "max": 25.54091700005756,
    "budget": 500.0,
    "verdict": "pass",
    "gated": true
  },
  {
    "case": "POST /sales \u00b7 paid in parts (6 sellers)",
    "concurrency": 6,
    "n": 300,
    "p50": 50.55045799997515,
    "p95": 160.73170900006062,
    "p99": 294.2449590000251,
    "max": 394.65970899993863,
    "budget": 500.0,
    "verdict": "pass",
    "gated": true
  }
]
 Container birka-limits-try-measure-run-ab422e3a99dc Creating 
 Container birka-limits-try-measure-run-ab422e3a99dc Created
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
  run 3: approve 3.27 s, 14045 statements, slowest 0.116 s, reply 1131 bytes
  2000: slowest approval 3.27 s, slowest statement 0.116 s -> PASS; adding a 1 000-line file 0.29 s, removing it 0.05 s; pages GET /snapshots/{id} 0.040 s, GET lines, last page 0.013 s, GET parts 0.007 s, GET application, first 500 0.011 s

5000 allocations, 3 runs
  run 1: built 5000 lines in 65.1 s (slowest part added through the service 0.28 s)
2026-10-09 19:56:44 [info     ] inventory.movements_applied    [app.modules.inventory.service] lines=5000 organization_id=ef9b1b84-7a41-4ed6-a82b-5bdba0400284 types=['OPENING_BALANCE']
  run 1: approve 8.37 s, 35048 statements, slowest 0.259 s, reply 1131 bytes
  run 2: built 5000 lines in 62.1 s (slowest part added through the service 0.28 s)
2026-10-09 19:57:54 [info     ] inventory.movements_applied    [app.modules.inventory.service] lines=5000 organization_id=ef9b1b84-7a41-4ed6-a82b-5bdba0400284 types=['OPENING_BALANCE']
  run 2: approve 8.14 s, 35048 statements, slowest 0.270 s, reply 1131 bytes
  run 3: built 5000 lines in 61.1 s (slowest part added through the service 0.30 s)
2026-10-09 19:59:04 [info     ] inventory.movements_applied    [app.modules.inventory.service] lines=5000 organization_id=ef9b1b84-7a41-4ed6-a82b-5bdba0400284 types=['OPENING_BALANCE']
  run 3: approve 8.14 s, 35048 statements, slowest 0.274 s, reply 1131 bytes
  5000: slowest approval 8.37 s, slowest statement 0.274 s -> PASS; adding a 1 000-line file 0.32 s, removing it 0.06 s; pages GET /snapshots/{id} 0.041 s, GET lines, last page 0.013 s, GET parts 0.009 s, GET application, first 500 0.016 s

10000 allocations, 3 runs
  run 1: built 10000 lines in 153.9 s (slowest part added through the service 0.29 s)
2026-10-09 20:01:47 [error    ] request.unhandled_error        [app.core.correlation] error=DBAPIError method=POST path=/api/v1/snapshots/a92f96dd-45b6-4ce9-9b6d-187bdbb845ac/approve
  run 1: approve REFUSED after 7.66 s, 40041 statements: HTTP 500 {"code": "INTERNAL_ERROR", "message": "Внутрішня помилка сервера.", "details": {}}
  not repeated: the refusal does not depend on the run
  10000: refused, slowest approval 7.66 s, slowest statement 0.067 s -> FAIL; adding a 1 000-line file 0.34 s, removing it 0.07 s; pages GET /snapshots/{id} 0.049 s, GET lines, last page 0.016 s, GET parts 0.015 s

largest size that passes: 5000
 Container birka-limits-try-measure-run-75fb9a2206dc Creating 
 Container birka-limits-try-measure-run-75fb9a2206dc Created
```

The approval's measurement exited 0 (137 would be a kill for memory).

## 3. the night's backup and drill of the largest database

```sh
docker compose --profile ops run --rm -e BIRKA_DATABASE_URL=postgresql+asyncpg://birka:$(grep ^POSTGRES_PASSWORD= /Users/nikitahlushak/.cache/birka-runtime/limits/.env | cut -d= -f2-)@db:5432/birka_json_perf ops
```

exit 0

```
{"started_at": "2026-10-09T20:01:49.676710+00:00", "ok": true, "problems": [], "archive": "birka-20261009T200149Z.dump.age", "bytes": 16660029, "rows": 271191, "drill": {"ok": true, "restore_seconds": 1.273, "failed": [], "dropped_leftovers": []}, "pruned": [], "finished_at": "2026-10-09T20:01:52.200102+00:00"}
 Container birka-limits-try-db-1 Running 
 Container birka-limits-try-db-1 Waiting 
 Container birka-limits-try-db-1 Healthy 
 Container birka-limits-try-ops-run-5dfc9a63cc15 Creating 
 Container birka-limits-try-ops-run-5dfc9a63cc15 Created
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
/birka-limits-try-db-1 OOMKilled=false running
/birka-limits-try-web-1 OOMKilled=false exited
```

```
/birka-limits-try-caddy-1 OOMKilled=false running
/birka-limits-try-backup-watch-1 OOMKilled=false running
/birka-limits-try-api-1 OOMKilled=false running
/birka-limits-try-db-1 OOMKilled=false running
/birka-limits-try-web-1 OOMKilled=false exited
```

## Peaks, MiB (sampled every second, 9 minutes)

| container | peak | limit |
|---|---|---|
| birka-limits-perf-api | 233 | 768 |
| birka-limits-try-api-1 | 234 | 768 |
| birka-limits-try-backup-watch-1 | 190 | 512 |
| birka-limits-try-caddy-1 | 19 | 256 |
| birka-limits-try-db-1 | 233 | 1024 |
| birka-limits-try-measure-run-75fb9a2206dc | 298 | 768 |
| birka-limits-try-measure-run-ab422e3a99dc | 70 | 768 |
| birka-limits-try-ops-run-5dfc9a63cc15 | 196 | 512 |

## By phase

- 1. the hot path, six sellers: birka-limits-perf-api 233, birka-limits-try-api-1 221, birka-limits-try-backup-watch-1 189, birka-limits-try-caddy-1 18, birka-limits-try-db-1 104, birka-limits-try-measure-run-ab422e3a99dc 70
- 2. an opening list's approval, 2 000 to 10 000 answers: birka-limits-try-api-1 234, birka-limits-try-backup-watch-1 190, birka-limits-try-caddy-1 19, birka-limits-try-db-1 233, birka-limits-try-measure-run-75fb9a2206dc 298
- 3. the night's backup and drill of the largest database: birka-limits-try-api-1 220, birka-limits-try-backup-watch-1 189, birka-limits-try-caddy-1 18, birka-limits-try-db-1 168, birka-limits-try-ops-run-5dfc9a63cc15 196
- 4. at rest: birka-limits-try-api-1 221, birka-limits-try-backup-watch-1 189, birka-limits-try-caddy-1 19, birka-limits-try-db-1 169
