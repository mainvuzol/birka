# How large an opening list may be: the approval, measured (2026-10-08)

ADR-0014 §10. The owner decided that several files fill one warehouse's list
and that its limits are raised (business-rules.md, 2026-10-08). The approval
is the bound: it writes the whole list in one transaction, holding the
warehouse exclusively (ADR-0005 §4, §5). The 5 000 answers a list took before
had never been measured.

## Verdict

| Answers (allocations) | Approvals (3 runs) | Statements | Slowest statement | Verdict |
|---|---|---|---|---|
| 2 000 | 2.76 s, 2.70 s, 2.68 s | 14 042 | 0.073 s | **PASS** |
| 5 000 | 7.07 s, 7.62 s, 7.63 s | 35 045 | 0.150 s | **PASS** |
| 10 000 | refused: HTTP 500 after 7.30 s, at statement 40 039 | — | 0.090 s | **FAIL** |

**`MAX_LIST_ALLOCATIONS` stays 5 000**: the largest size that passes. So
`MAX_LIST_LINES` = 2 500 and `MAX_LIST_ROWS` = 7 500 (ADR-0014 §10).

> **Changed on 2026-10-09, after this run:** `MAX_LIST_LINES` = 5 000 (as
> many lines as answers) and `MAX_LIST_ROWS` = 10 000. The owner had heard
> the limit as 5 000 lines of one size, and this run approved exactly that:
> 5 000 lines of one answer each, plus a 1 000-line file added and removed
> (6 000 rows). The figures below are unchanged.

**10 000 cannot be approved at all, at any speed.** The ledger reads every
allocation's reservation in one statement (`inventory.repository.
reserved_quantities`, a row-value `IN` of one `(location, variant, size)`
tuple per allocation). PostgreSQL 16 refuses it as too complex
(`stack depth limit exceeded`, `max_stack_depth` 2048kB): bisected on the same
cluster, it works at 6 523 tuples and fails at 6 562. Any list above about
6 500 answers is refused by the approval, whatever the timing; raising the
cap needs that read batched (or `= ANY(array)`) in `inventory` first, under
its own review (ADR-0014 §10: "the opening path is batched in `inventory`
under its own review"). See `server-error-10000.txt`.

Every other figure passes its rule with room:

| Size | Adding a 1 000-line file to the full list | Removing it | `GET /snapshots/{id}` | Last page of lines (50) | `GET …/parts` | First page of what it became (500) |
|---|---|---|---|---|---|---|
| 2 000 | 0.29 s | 0.05 s | 0.042 s | 0.017 s | 0.008 s | 0.012 s (150 KB) |
| 5 000 | 0.25 s | 0.05 s | 0.055 s | 0.118 s | 0.011 s | 0.018 s (150 KB) |
| 10 000 | 0.33 s | 0.06 s | 0.043 s | 0.013 s | 0.014 s | — (not applied) |

Rules: adding a part ≤ 5 s, a page ≤ 0.5 s. The approval's reply is 1 108
bytes at every size: it carries `application {units, allocations}`, not one
entry per allocation (ADR-0014 §10).

## Method

`backend/scripts/measure_opening_approval.py`, on a disposable database
(`birka_json_perf`, created for the run and dropped after it) on the local
PostgreSQL 16 test cluster. For each size, three times, on a fresh empty
warehouse:

1. the list built through the service in parts of 1 000 lines, each a
   parser's file: the first through `import_snapshot`, the rest through
   `add_part`;
2. every line answered `STATED`, one allocation, through `resolve_row`; each
   allocation its own stock key — the worst case: N/4 models × 4 sizes;
3. once per size, through the app: the list, its last page of lines, a
   further 1 000-line file added to the full list and removed again (so the
   approval also passes a removed file's lines), its parts;
4. the approval, through the app: `POST /snapshots/{id}/approve`;
5. once per size, through the app: the first page of what the list became.

Through the real app in process (`httpx.ASGITransport`), on the app's own
engine (`app.core.db.create_engine`: its 30 s statement timeout included).
Every SQL statement is counted and timed at the cursor. The service's caps
are raised for the run only (`MAX_LIST_ALLOCATIONS` 10 000, `MAX_LIST_LINES`
and `MAX_LIST_ROWS` 11 000) so every size can be built; the code's own are
unchanged. A refused approval fails its size; its further runs are not made.

Files: `run.txt` (the log, with the environment), `summary.json` (every
figure), `server-error-10000.txt` (the refusal's cause), `earlier-runs.txt`.

## Machine

- Apple M5, 10 CPUs, 32 GiB, macOS 26.7.1 (arm64); harness, app and database
  on one machine.
- Python 3.12.14 (CPython).
- PostgreSQL 16.2 (pgserver), `fsync` on, `synchronous_commit` on,
  `shared_buffers` 128MB, `work_mem` 4MB, `max_wal_size` 1GB.

**Not the server.** The server runs PostgreSQL 17 on hardware not yet chosen
(release checklist row 16). The 5 000 approval took at most 7.63 s against a
10 s rule; the client waits 60 s for a slow call (ADR-0014 §16), eight times
the figure measured here. The row-value ceiling may sit elsewhere on 17;
5 000 is about 23 % under it here.

## Earlier attempts (`earlier-runs.txt`)

- **Attempt 1** (19:43 UTC): the same figures for 2 000 and 5 000 within
  10 %, but adding a part while a list was built took up to 2.2 s at 5 000
  lines, growing with the list. The cause was the count of a part's photo
  lines that another part names (`photo_lines_elsewhere`): a self-join the
  planner sized from statistics older than the list, as a nested loop. It is
  now one scan with a window, and adding stays flat (0.2–0.3 s at every size
  above). The harness then stopped on the 500 at 10 000.
- **Attempt 2** (19:58 UTC): the final service code; the harness stopped on
  the same 500 before recording it (`httpx.ASGITransport` re-raises the
  app's error). Its traceback is the one in `server-error-10000.txt`.
- **Attempt 3** (20:09 UTC): this one.
