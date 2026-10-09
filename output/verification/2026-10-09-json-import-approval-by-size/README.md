# The approval at 5 000 answers, every one by size (2026-10-09)

ADR-0014 §5, §10. The review of the built change (second round,
2026-10-09) asked for the 5 000-answer approval to be measured again with
the approval's second reading of the split in it. Since that review, the
approval reads every line answered `STATED_BY_SIZE` again, with its text,
against the catalogue as it is then (`snapshots.service._splits_unsaid`),
and refuses a record that may now be a range and that the person's word did
not cover. The [2026-10-08 run](../2026-10-08-json-import-approval/README.md)
answered every line `STATED`, so that read had nothing to do. One run of the
read by the second review took 3.4–3.6 s at 5 000 lines, not reproduced; the
rows and their texts are now read in one statement (`catalog.raw_lines.
text_of`).

## Verdict (the second round, 2026-10-09)

| Every line answered | Approvals (3 runs) | Statements | Slowest statement | The second reading, per approval | Verdict |
|---|---|---|---|---|---|
| `STATED_BY_SIZE` | 8.55 s, 8.16 s, 7.79 s | 35 049 | 0.157 s | 0.182 s, 0.186 s, 0.137 s | **PASS** |
| `STATED` (the 2026-10-08 method, the same hour) | 7.78 s, 6.94 s, 9.50 s | 35 048 | 0.214 s | nothing to read | **PASS** |

**The second reading costs about 0.2 s at 5 000 lines.** The rest of the
spread is the machine: the 2026-10-08 method, run the same hour, took from
6.94 s to 9.50 s, against 7.07–7.63 s on 2026-10-08. Other work ran on the
laptop during both runs. Every approval stays within the rule (at most
10 s, no statement over 5 s), but with less room than on 2026-10-08:
`MAX_LIST_ALLOCATIONS` stays 5 000, and the measurement on the server's own
hardware (release checklist, row 16) decides it there.

## Measured again: the review's third round (2026-10-09)

The third round found the re-check's text read depending on the
planner's statistics. `text_of` correlated the raw input on its id **and**
its organization; with the statistics a test suite leaves (many
organizations of a few lines each), PostgreSQL read the organization's
index and filtered the id, for every row: 5 000 rows × 5 000 index entries.
`text_of` now finds the raw input by its primary key alone, and checks the
organization in a form no index serves (`IS NOT DISTINCT FROM`; the column
is never null), so no statistics can lead the planner to the other index.
A line of another organization still reads as no text.

**The statement, with a test suite's statistics.** On a disposable
database, after `test_snapshot_parts.py` and `test_snapshot_import.py`
(131 passed) left 135 organizations on it, a list of 5 000 lines answered
by size, before its own rows were analyzed
([`text_read_by_statistics.py`](text_read_by_statistics.py),
[`text-read-suite-statistics.txt`](text-read-suite-statistics.txt)):

| The rows and their texts | Plan of the text's subquery | EXPLAIN ANALYZE | Three reads, run 1 | Three reads, run 2 |
|---|---|---|---|---|
| before: `id` and `organization_id` | `ix_raw_input_org_hash`, 4 999 rows removed by the filter per row, 7.06 M buffers | 1 395 ms | 1.393, 1.390, 1.462 s | 1.412, 1.489, 1.630 s |
| now: `id` alone (`text_of`) | `pk_raw_input`, 15 000 buffers | 6.7 ms | 0.008, 0.008, 0.007 s | 0.091, 0.008, 0.008 s |

The whole re-check (`_splits_unsaid`) took 0.11–0.17 s in the same
session, the statement 0.034–0.078 s of it. The third round's check had
found this plan after its own test run (1.36–1.39 s), and not on a fresh
database; here the same plan is found, and gone, in one session.

**The approval, by size, at 5 000 answers,** with `measure_by_size.py` as
before, each mode on a fresh disposable database, one after the other:

| Every line answered | Approvals (3 runs) | Statements | Slowest statement | The second reading, per approval | Verdict |
|---|---|---|---|---|---|
| `STATED_BY_SIZE` | 7.21 s, 8.48 s, 7.59 s | 35 049 | 0.157 s | 0.114 s, 0.126 s, 0.186 s | **PASS** |
| `STATED` (the 2026-10-08 method, the same hour) | 8.00 s, 9.87 s, 7.30 s | 35 048 | 0.196 s | nothing to read | **PASS** |

The second reading costs 0.11–0.19 s at 5 000 lines, as in the second
round; the change of `text_of` did not show here, since a fresh database's
statistics never led to the slow plan. The 2026-10-08 method's 9.87 s, its
slowest yet and 0.13 s under the rule's 10 s, again shows the machine's
spread: the same method took 7.07–7.63 s on 2026-10-08 and 6.94–9.50 s in
the second round. Every approval stays within the rule; the measurement on
the server's own hardware (release checklist, row 16) decides it there.

Files: `run-by-size-third-round.txt`, `summary-by-size-third-round.json`,
`run-stated-third-round.txt`, `summary-stated-third-round.json`.

## Method

[`measure_by_size.py`](measure_by_size.py), from `backend/`, on a disposable
database of the local PostgreSQL 16 test cluster, dropped after the run. It
reuses `backend/scripts/measure_opening_approval.py`: its seed (one
organization, 2 500 models × 4 sizes), its three runs on a fresh warehouse,
its list built through the service in parts of 1 000 lines, its 1 000-line
file added and removed again in the first run, and its approval through the
app in process, every statement timed at the cursor. One change: each line
writes its size with its count, «Позиція <letters> S-1», with `size_counts`
for that size, so the text shows the split, and is answered
`STATED_BY_SIZE`. With `MODE=stated` it runs the 2026-10-08 method as it
is.

Files: `run-by-size.txt`, `summary-by-size.json`, `run-stated.txt`,
`summary-stated.json`.

## Machine

The one of 2026-10-08: Apple M5, 10 CPUs, 32 GiB, macOS 26.7.1 (arm64);
PostgreSQL 16.2, `shared_buffers` 128 MB, `work_mem` 4 MB, `fsync` and
`synchronous_commit` on; the app's own engine, its 30 s statement timeout
included.
