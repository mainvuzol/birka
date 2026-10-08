# The shops' existing stock from a JSON file — 2026-10-08

Baseline: `c44f49a` (the owner's readings confirmed, and the JSON way
chosen, merged as PR #73).
Status: implemented locally; verified as below, the full run's figures
marked TODO(final).
Migration `0037`.
Branch: `feat/json-stock-import`, after `1e8ab6c`, `663a52d` and `9ca87fe`
(the owner's answers of 2026-10-08) and `8b32a05` (the design); the server's
side at `24bafa9`.
Design: [ADR-0014](../decisions/ADR-0014-opening-stock-from-a-json-file.md).
The format: [`formats/birka-stock-list/`](../../formats/birka-stock-list/README.md).

## Why this was next

With PR #73 merged, one thing the agent could build still blocked the
release: the way in the owner had just chosen for the shops' existing stock
([release checklist](release-checklist.md), row 15). «Початкові залишки»
took a list typed by hand, of at most 1 000 lines, one warehouse a list,
once. On 2026-10-08 the owner chose otherwise (business rules, "the shops'
existing stock"): the shops photograph their notebooks and tables, a parser
reads them into JSON in a format Birka defines, and the app takes the files
into the warehouse's list, every line still reviewed by a person and the
list approved by the owner.

The design's questions were put to the owner the same day, and every answer
is in the same section of the business rules. Then two more: a bare number
is not a count from a file either, and the shared warehouse's list belongs
to both stores (`663a52d`); and one size with its count is confirmed by a
tap too, when a sign joins them (`9ca87fe`).

## What exists now

**The owner's answers, and what each became** (all 2026-10-08):

| The owner's answer | What it became |
|---|---|
| Photos → parser → JSON, in a format Birka defines | `birka.stock-list` v1 (`snapshots/stock_file.py`), and the package for the parser's author ([`formats/birka-stock-list/`](../../formats/birka-stock-list/README.md)) |
| Several files fill one list, reviewed in parts and approved together, its limits raised | a list's parts (`inventory_snapshot_part`): «Новий список» from the first file, «Додати файл» for the rest; 5 000 lines and 5 000 answers, as measured (below) |
| The photos stay with the shops | each line keeps the photo's name and its line number on it, «Фото: IMG_0412.jpg, рядок 4»; no photo is kept |
| The price is only shown, one kind per file | `price_kind` once per file; «Ціна з зошита: 1200 (закупівельна)»; never a model's price |
| A file added by mistake is removed, with its lines' answers, no reason; any manager or the owner; the history shows who and when | «Прибрати файл»: the answers deleted, the lines kept as evidence, `REMOVED`; «Прибрано: <ім’я>, <дата>» |
| The last file is not removed: the list is rejected | `LAST_PART`, and the app says to reject the list |
| A removed file may be added again, as a new file | a removed file never comes back; the same file is taken again as a new part, its lines answered anew |
| Lines typed by hand may join a list of files | «Додати рядки вручну»: a part of its own, with no photo |
| The parser's count is a hint unless the text states it; a number without «шт» is not a count by itself | Birka reads the text itself; the file's count is shown as «Парсер прочитав кількість: 3» and the person states it with a note (`FILE_COUNT_HINT`, `FILE_COUNT_DIFFERS`) |
| Counts per size occur; a split the text shows is confirmed by a tap, one size too, only with a sign between size and count | `shown_split`, and the new basis `STATED_BY_SIZE`, «Як у рядку, по розмірах», never preselected; «M 3» stays a bare number |
| Every written line is passed on, with the parser's note | `note` on a line; `FILE_NOTE` sends it to a person |
| The warehouse waits for the whole review, even days | unchanged: the list holds its warehouse until it is decided |
| A list of the shared warehouse belongs to both stores; no second list offered | every list route takes `?store_id=`, the store acted through; «Новий список» names a list waiting at the warehouse and opens it |
| After hearing the measurement: the limit stays at 5 000 answers; the shops first count their largest warehouse roughly (pages × lines per page), and above 5 000 the limit is raised by a separate change to the ledger before going live | `MAX_LIST_ALLOCATIONS` stays 5 000; the count is the runbook's first step (step 9), a «who» of release checklist row 15, and an item of the [backlog](backlog.md) |

**The server** (ADR-0014 §2–§14).
- `POST /snapshots` takes `lines` or a `file`; `POST …/parts` adds a file or
  typed lines; `POST …/parts/{id}/remove` removes one; `GET …/parts` and
  `GET …/application` read them.
- A command id names one list or one part, never both, under one lock; a
  retry adds nothing twice.
- The same file twice in one list is refused (`PART_DUPLICATE`); a file
  overlapping another is taken, and counted (`photo_lines_elsewhere`).
- A file's refusal (422) names its line and never echoes the file.
- Migration `0037`: the part table, its triggers (parts frozen with their
  list, a removed part removed whole and checked at commit, a removed line
  never allocated), and each existing list made its first part.

**The phone** (ADR-0014 §15, §16). A file is read strictly before it is
sent (UTF-8, duplicate keys, integers, size), and summed up with the
warehouse it goes to. The list shows its files, its lines by file, each
line's photo, reading and price, and a removed file muted. Every string from
a file is shown through a guard that marks bidirectional and invisible
characters. Creating a list from a file, adding a file and approving wait
60 s, and their timeout is not taken as the server being down.

## The format

The parser's author gets one package,
[`formats/birka-stock-list/`](../../formats/birka-stock-list/README.md):
- **a description** in English with Ukrainian examples: every key, the
  rules a schema cannot say, what to write, and what Birka does with each
  kind of line;
- **the JSON Schema**, generated from the server's model
  (`python -m scripts.check_stock_file --schema`), never edited by hand;
- **an example** of eleven notebook lines, one of each kind: a heading, a
  count with «шт», a table line without it, «S-1 M-2 L-1», «Лоран M-3»,
  several sizes with a total, a crossed-out line, a line with no count, an
  unsure colour, counts per size joined by spaces, and a page's total;
- **the reference validator**, `backend/scripts/check_stock_file.py`: it
  reads a file through the server's own model (`load_stock_file_text`) and
  prints `OK`, or every problem with its line, in the app's Ukrainian words.

`tests/unit/test_stock_file_package.py` (52 tests) keeps them true: the
schema byte for byte the model's; the example a file the server takes, each
of its lines what the description says; every key and refusal described;
the validator's verdict the server's on 7 good and 17 bad files. The one
difference is deliberate: a key written twice, which the server's JSON
parsing resolves silently, and the phone and the validator refuse.

## The limits, measured

`backend/scripts/measure_opening_approval.py`, on 2026-10-08, on a
disposable database on the local PostgreSQL 16.2 cluster (Apple M5, 10 CPUs,
`fsync` on), through the app in process, each answer its own stock key
([evidence](../../output/verification/2026-10-08-json-import-approval/README.md)).
The rule (ADR-0014 §10): the slowest of three approvals at most 10 s and no
statement over 5 s; adding a file at most 5 s; a page at most 0.5 s.

| Answers | Approvals | Statements | Slowest statement | Adding a 1 000-line file | Slowest page | Verdict |
|---|---|---|---|---|---|---|
| 2 000 | 2.76 s, 2.70 s, 2.68 s | 14 042 | 0.073 s | 0.29 s | 0.042 s | passes |
| 5 000 | 7.07 s, 7.62 s, 7.63 s | 35 045 | 0.150 s | 0.25 s | 0.118 s | passes |
| 10 000 | refused: HTTP 500 after 7.30 s | 40 039 before it | 0.090 s | 0.33 s | 0.043 s | fails |

- **The limits are 5 000 answers and 5 000 lines** (10 000 rows with
  removed files, 1 000 parts), pinned by a unit test. The lines were first
  set to half the answers, 2 500, as a margin; they were raised to the
  answers the same day, since the owner heard the limit as 5 000 lines of
  one size and the measurement approved exactly that. The owner kept 5 000
  after hearing these figures (2026-10-08): the shops count their largest
  warehouse first, and above 5 000 the limit is raised by a change to the
  ledger before going live.
- **10 000 fails at any speed.** The ledger reads every answer's
  reservation in one statement (`inventory.repository.reserved_quantities`),
  and PostgreSQL refuses it, "stack depth limit exceeded": on the same
  cluster it works at 6 523 keys and fails at 6 562. A larger warehouse
  needs that read changed first ([backlog](backlog.md)).
- **The first attempt found a slow count.** Adding a file grew to 2.2 s at
  5 000 lines: the count of a file's photo lines already in the list was a
  self-join the planner sized wrongly. It is one scan now, flat at
  0.2–0.3 s.
- **On PostgreSQL 16, not the server's 17.** The approval's reply is 1 108
  bytes at every size; the client waits 60 s for it, eight times the
  slowest measured.

## Verification

**Backend.**
- Before the change, on the branch as it stood: 2 584 passed, 1 skipped
  (`age` not installed); the 7 catalogue-evaluation tests need the
  `birka_test` database and are left to the full run.
- With the server's side, at `24bafa9`: 2 892 passed, 1 skipped, the same 7
  left to the full run.
- New test files:
  - unit: `test_stock_file.py` (114), `test_file_lines.py` (127),
    `test_stock_file_package.py` (52);
  - integration: `test_snapshot_parts.py` (45),
    `test_stock_list_parts_migration.py` (4).
- Changed: `test_snapshot_import.py`, unit (72) and integration (69: the
  approval's lines read from `GET …/application`, the assertions unchanged
  in substance); `test_migration_history_is_frozen.py` (`0036` frozen).
- Every unit test with the package's, on 2026-10-08: 1 592 passed.
- The full suite at the end: TODO(final).

**Gates,** on this tree on 2026-10-08: ruff and format (330 files), mypy
(156 files), 31 import contracts kept, none added. `alembic check` and the
`0037` round trip, with the full run: TODO(final).

**Mutation testing** of the server's rules, by the builder: 53 mutants of
the shown split, a file line's count, `check_basis` and the format; 52
caught, one equivalent (a count "continuing in digits", which the pattern's
greedy digits already exclude).

**E2E.** TODO(final): the file import's journeys and the count (249
before this change). Planned (`e2e/openings-file.spec.ts`): a file fills a
new list and a split is confirmed by a tap; a wrong file removed, the last
refused, a removed file added again; a file not in Birka's format refused
before it is sent, and the same file twice refused by the server; the
shared warehouse's list from the other store. Frontend typecheck, lint and
build: TODO(final).

**The edge.** CI's `edge` job now sends 999 000 bytes and expects the API's
own refusal, and 1 000 001 bytes and expects 413. Not run yet: TODO(final),
with the local CI run.

## Independent review

The design was reviewed adversarially before the build: 1 blocker, 7 major
and 19 minor findings.
- **The blocker:** a bare number the parser picked would have been stated
  in one tap. The owner settled it: a number without «шт» is a hint,
  answered with a note.
- **The majors** were all taken, two as decided rather than as proposed: no
  duplicate check across lists (the app names the list waiting instead),
  and the cap measured rather than set.
- **Of the minors,** 14 were taken in full and 2 in part; 3 were moot or
  replaced, among them a probe of `/ready` before a slow call, replaced by
  declared slow calls.

The built change has had no independent review at the time of this report.

## Where the build departs from the design

- **`size_counts` takes one size** (1..10), not two or more: the owner
  decided «Лоран M-3» is confirmed by a tap too. A single size whose text
  does not show it so gets `FILE_SPLIT_NOT_IN_TEXT`.
- **Every refusal inside `lines` names its line,** pydantic's own included;
  a file over the byte bound and a top-level key name none.
- **`version` refuses `true` and `1.0`** by a guard of its own: strict
  pydantic took them as `1`.
- **A lone «/» the parser flags** stops a split from being shown, as an
  option group does.
- **A paused warehouse's list is seen from its own store only:** receiving
  through the other store needs the warehouse open.
- **Lines added through the other store name it in their evidence;** the
  list's store does not change. The audit names the store acted through.
- **Smaller:** the part's CHECKs also hold `part_no ≥ 1` and
  `first_line_no ≥ 1`; the downgrade also refuses file reasons; the
  backfill is SQL; `GET …/application` on a list not applied answers an
  empty page; removing a file takes no body or `{}`; `$schema` is 1..2 000
  characters.

## Risks

In the [risk register](known-risks.md#the-json-stock-import--2026-10-08):
the evidence is a transcription; the parser's precision is unknown; tables
of numbers mean notes; a size range can pass for a split; a warehouse larger
than the limit cannot be taken in; the measurement on PostgreSQL 16; the
warehouse held for days; two lists at once from two stores; a shared list
whose own store stops trading, which can then be neither approved nor
rejected and holds the warehouse; the Telegram file picker.

## What is not done

- **The parser.** Whoever makes it, from the package. No real file exists
  yet.
- **A file picked on a real phone in Telegram,** on an Android and an
  iPhone: release checklist row 26.
- **The shops' count of their largest warehouse** (pages × lines per
  page). Above 5 000, the limit is raised first, by a change to the ledger,
  before going live (owner, 2026-10-08; [backlog](backlog.md)). The count
  counts each size of a line that names several.
- **The slow call's timeout has no journey;** it is reviewed in the code.
- **The catalogue screens** still show raw text unguarded.
- **Readings awaiting the owner:** nine, each with its question (business
  rules, "the shops' existing stock", "how it is carried out").
