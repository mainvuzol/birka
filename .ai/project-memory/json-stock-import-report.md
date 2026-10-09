# The shops' existing stock from a JSON file — 2026-10-08

Baseline: `c44f49a` (the owner's readings confirmed, and the JSON way
chosen, merged as PR #73).
Status: implemented locally; reviewed adversarially on 2026-10-09; its
findings fixed, or kept with the reason ("Review of the built change",
below); verified as below, the last time by the whole of CI run locally on
`6aecb9b` (2026-10-09, [evidence](../../output/verification/2026-10-09-json-stock-import-ci-local/summary.md)).
Migration `0037`.
Branch: `feat/json-stock-import`, after `0a8adba`, `1e8ab6c`, `663a52d` and
`9ca87fe` (the owner's answers of 2026-10-08) and `8b32a05` (the design);
the server's side at `24bafa9`, the phone's at `24f41d2`, the owner's two
changed readings at `4e97d20`; the review's fixes after it.
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
- A file's refusal (422) names its line; since the review, no 422 of a
  list's request echoes it, wherever the refusal stands.
- Migration `0037`: the part table, its triggers (parts frozen with their
  list, a removed part removed whole and checked at commit, a removed line
  never allocated), and each existing list made its first part.

**The phone** (ADR-0014 §15, §16). A file is read strictly before it is
sent (UTF-8, duplicate keys, integers, size), and summed up with the
warehouse it goes to. The list shows its files, its lines by file, each
line's photo, reading and price, and a removed file muted. Every string from
a file is shown through a guard that marks control, bidirectional and
invisible characters. Creating a list from a file, adding a part (a file or
typed lines) and approving wait 60 s, and their timeout is not taken as the
server being down.

## Two readings the owner changed — 2026-10-09

Nine readings of "how it is carried out" were put to the owner; seven were
confirmed as built, and two changed (business rules, readings 5 and 8).
Both are built. The review found that reading 1's question did not say what
is built; it is put again (R-a, below).

**5. A record that may be a range of sizes is asked about** (ADR-0014 §5).
- The server works out, at every read of a line, whether each pair of its
  shown split may also be a range: its count as written («44»), or its
  record as written («42-44», «42 – 44»), is itself a size of the
  organization, under one spelling (`file_lines.split_records`,
  `may_be_range`; the catalogue's `sizes_by_spelling`). It is never kept:
  a size created after the import makes the pair ambiguous from then on.
  The review widened it the same day: a number size whose count, also a
  number, reads as a larger size after it («42-44», «98-104») is asked
  about whatever the catalogue holds, and the approval reads every answered
  line again, record by record (below).
- A line's `shown_split[]` gains `written` and `may_be_range`.
- `PUT …/lines/{n}` with `STATED_BY_SIZE` on such a line needs
  `split_read_as: "SIZE_WITH_COUNT"`, checked again at the answer; without
  it, 422 `VALIDATION_ERROR`, reason `SPLIT_MAY_BE_RANGE`, naming the
  records. `split_read_as` goes with `STATED_BY_SIZE` only. The answer's
  `snapshot.line_resolved` entry keeps it, with the records it answered.
- The editor asks first, per such pair, «Запис «42-44» — це:»: «Розмір 42
  — 44 шт» or «Діапазон розмірів 42–44», the record as written, through
  `visible()`. «Як у рядку, по розмірах» appears only once every such pair
  is read as a size with its count, never preselected; read as a range,
  it goes, and the line is answered with another basis and a note. The
  line's card says the record may be a range.

**8. A shared list whose own store stops trading is rejected through the
other store** (ADR-0014 §7).
- `reject_snapshot` needs only the store acted through trading, with the
  usual reach (through the other store, `can_receive` and either snapshot
  permission). The hold is released as for any rejection; the audit names
  `via_store_id`. Through the blocked or archived store itself it is still
  refused by the scope (`STORE_NOT_TRADING`).
- Every other command through the other store — approving, answering,
  adding or removing a file — is refused by name: 409 `SNAPSHOT_CONFLICT`,
  reason `LIST_STORE_NOT_TRADING`, with the store and its state. Before, it
  was a bare 404 "Unknown store".
- A list gains `store_state`, its own store's. Seen through the other
  store, the list page says «Магазин «…», що почав цей список, не працює:
  список можна лише відхилити, а файли додати до нового списку.», offers no
  approval, file or answer, and offers «Відхилити список» to that store's
  managers as well as the owner. «Новий список» names such a waiting list
  and says to reject it first; after the rejection the warehouse takes a
  new list from that store.

**A small fix.** At 375 px the size choice in a line's editor read «Обері»:
the size now takes two shares of the row and its count one
(`.fields.size-count`), so «Оберіть розмір» reads whole.

**Verified, for this change, on 2026-10-09** (the full run's figures are
still to come, under "Verification"):
- backend: ruff, format (330 files), mypy (156 files), 31 import contracts
  kept; the snapshot, stock-file and parts-migration test files, 502
  passed; the whole suite, 2 954 passed and 1 skipped (`age` not
  installed), the catalogue evaluation's integration file left out, as it
  needs `birka_test`;
- new tests: unit `test_file_lines.py` (8: records as written, the count a
  size, the record a size, neither, any spelling, a record not found);
  integration `test_snapshot_parts.py` (6: the tap refused without the
  choice and taken with it, the choice in the audit; a size created after
  the import; a record that is a size of its own; blocked and archived
  stores; approved again once the store trades);
- E2E: two journeys in `openings-file.spec.ts` — the question asked and
  answered both ways, and a list of a blocked store rejected by the other
  store's manager, then a new list there. The seed gains a warehouse for the
  first, and two stores of their own sharing a warehouse, with a manager,
  for the second. The full run on a fresh seed: 256 passed (254 before);
- frontend: typecheck, lint, build and Prettier;
- 16 hand mutants over the new rules — the detection, the answer's check
  and its audit, the rejection through the other store, the approval still
  refused, the list's store state, and the editor's question before the tap
  — each caught by the tests above and reverted, the tree byte for byte as
  before.

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

`tests/unit/test_stock_file_package.py` (52 tests at the build, 60 since
the review) keeps them true: the schema byte for byte the model's; the
example a file the server takes, each of its lines what the description
says; every key and refusal described; the validator's verdict the
server's on 7 good and 17 bad files; and, since the review, its words: «поле
«фото» відсутнє», «961 204 байти». The one
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
  set to half the answers, 2 500, as a margin, and the rows to 7 500; they
  were raised to the answers on 2026-10-09 (`24f41d2`), since the owner
  heard the limit as 5 000 lines of one size and the measurement approved
  exactly that. The owner kept 5 000
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
  bytes at every size; the client waits 60 s for it, six times the
  slowest measured (9.87 s, in the review's third round; eight times when
  this was first written).

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
- After the review's fixes, on a fresh database (2026-10-09): 3 074 passed,
  1 skipped (`age`), the catalogue evaluation's file left out, as it needs
  `birka_test`. Its files then: unit `test_stock_file.py` (163),
  `test_file_lines.py` (192), `test_stock_file_package.py` (60);
  integration `test_snapshot_parts.py` (57),
  `test_stock_list_parts_migration.py` (4).
- The full suite at the end, on a fresh `birka_test` (PostgreSQL 16.2,
  2026-10-09, after the fourth round): 3 274 passed, 1 skipped (`age`), the
  catalogue evaluation included. In CI run locally on `6aecb9b`, on
  PostgreSQL 17 with the production locale: 3 256 passed, 19 skipped (the
  backup tests' declared tool gap), and those 19 on PostgreSQL 16.2: 18
  passed, 1 skipped (`age`).

**Gates,** on this tree on 2026-10-08: ruff and format (330 files), mypy
(156 files), 31 import contracts kept, none added. `alembic check` and the
`0037` round trip, with the full run (2026-10-09, after the fourth round):
`alembic check` clean at head, `0037` down to `0036` and up again, clean
again.

**Mutation testing** of the server's rules, by the builder: 53 mutants of
the shown split, a file line's count, `check_basis` and the format; 52
caught, one equivalent (a count "continuing in digits", which the pattern's
greedy digits already exclude).

**E2E.** Twelve journeys in `e2e/openings-file.spec.ts`:
1. a file fills a new list, its lines show their photo and reading, a split
   the line shows is confirmed by a tap, a second file joins, and the owner
   approves;
2. a wrong file is removed with its answers, the last file is not, and a
   removed file comes back as a new one;
3. a file not in Birka's format is refused before it is sent (since the
   review also a number too large to be one, and the 950 000-byte bound:
   950 000 taken, 950 001 refused), and the same file twice is refused by
   the server;
4. a record that may be a size with its count or a range of sizes is asked
   about, and tapped only once read as a size with its count (reading 5);
   since the fourth round, a size created while the editor is open makes a
   record a possible range: read again as the phone comes back to the app,
   the line asks about it and the tap waits for the answer, and an answer
   the server refuses for it reads the line again and asks there;
5. the shared warehouse's list is seen and filled from the other store, and
   no second list is offered for it;
6. a shared list whose own store stopped trading is only rejected, from the
   other store, and its warehouse takes a new list there (reading 8); since
   the review, a manager without the right to approve rejects it;
7. a slow answer is no outage: a file and an approval wait 60 s, on a
   browser clock, and the server is not marked down; since the review,
   another file picked after a slow answer keeps the command;
8. answers lost on their way back (review): a file removed since comes back
   as a new one, and typed lines changed before they are sent again go as
   new;
9. a narrow phone (review): at 375 px a 60-character file name breaks and
   never widens the page; an answer the list has no room for, and a list
   whose store may no longer receive, say so, and since the fourth round a
   list with no room for another part (server answers faked in the shapes
   the server gives);
10. an answer too slow to wait for (review): the list made meanwhile is
    opened, never a second;
11. an answer too slow to wait for, its list made only after (second
    round): no new list is offered meanwhile, and saving again opens the
    one list; since the third round, a send refused for its form between
    leaves the draft unsettled;
12. a send refused as the same command in another form settles the draft
    (fourth round, against the server, its answers lost on their way back):
    a gateway's 504 after the list is made leaves the draft unsettled; the
    list rejected meanwhile, a corrected file is refused as the same
    command, which settles the draft, and a new list is started; a list
    whose answer never came, opened from the overview, ends its draft. It
    replaces the third round's journey, whose server answers were faked and
    which kept the draft unsettled until a waiting list was found.

`e2e/openings.spec.ts` checks, since the review, that a manager without the
right to approve still sees «Відхилити список».

On a fresh seed: 249 before this change; 254 with journeys 1–3, 5 and 7;
256 with 4 and 6 (2026-10-09); 259 after the review's fixes (2026-10-09,
run locally), 260 after its second round and 261 after its third. The
final count: 261 passed on a fresh seed after the fourth round, and 261 in
CI run locally on `6aecb9b` (PostgreSQL 17). Frontend typecheck, lint,
build and Prettier passed after the fixes on 2026-10-09, and again in the
final run, with `npm audit` finding 0 vulnerabilities.

**The edge.** CI's `edge` job now sends 999 000 bytes and expects the API's
own refusal, and 1 000 001 bytes and expects 413. Run locally on `6aecb9b`
(2026-10-09): all 8 steps passed, the body check among them; the restore
drill passed 7 of 7, the hot path within budget (worst p95 74.3 ms of 300
for the catalogue, 117.3 ms of 500 for `POST /sales`), and `pip-audit` found
no known vulnerability.

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

The built change was reviewed adversarially on 2026-10-09: see the next
section.

## Review of the built change (2026-10-09)

The change at `4e97d20` was reviewed adversarially the same day, from three
sides, each with probes that reproduce what it found:
- **the ledger, the evidence, concurrency and the migration:** 2 major and
  4 minor findings;
- **security, the API and the phone:** 2 major and 7 minor;
- **fidelity to the owner's rules, and the documents:** 1 blocker (the
  first finding of the ledger's review, seen again), 6 major and 23 minor.

What each checked and found sound is in its findings: the authorization on
every route, the tenancy, the locks and their order, the replays, the
migration's triggers, the format's strictness under fuzzing, and the rules
of a count. Every finding, and what was done:

**The split, and the range** (ADR-0014 §5).

| Finding | What was done |
|---|---|
| **Blocker; the ledger's major 1.** A split counted as shown when each of the parser's sizes stood once with its count, whatever else the text held: «Лоран S-1 M-2 L-4» with only S and M read, «Лоран M-3 L-5», «Лоран M-3+2», «M-3,5», «M-3.5», «M-3-2», «Лоран S M-3», «Лоран M-3 M 2», «S-1 M-2 L-1 разом 5», «Лоран 46-2 48». A probe approved 3 coats from a line showing 7. | **Fixed.** A count ends with its digits; each size stands in the text once; Birka reads no other size; the text holds no other size with a count; every other number is the file's price, a count with «шт» or a length. Otherwise `FILE_SPLIT_NOT_IN_TEXT`, answered with a note. `test_file_lines.py`: 32 more refusals, every row of the two reviews' tables, and 17 splits still shown. No line of the example changed its outcome, nor did any split of the E2E files. |
| **Fidelity major 1.** «42-44» was asked about only when 44, or «42-44», was a size of the catalogue; the owner's rule asks whenever a size with its count may be read as a range. | **Fixed.** A number size whose count, also a number, reads as a larger size after it («42-44», «42-58», «98-104») is asked about whatever the catalogue holds; «46-2», «48-12» and «M-3» are not, unless the catalogue makes them a range. |
| **The ledger's major 2.** A tap given before its record became a possible range (a size 44 created after «Парка 42-44» was answered) was approved without the question. | **Fixed.** The line keeps `split_read_as` (in `0037`, still unreleased, edited: a CHECK, refused by the downgrade, cleared when the part is removed). The approval reads every line answered by size against the catalogue as it is then, and refuses, 409 `SPLIT_MAY_BE_RANGE` naming the lines, until each is answered again. `test_an_answer_by_size_is_read_again_at_the_approval` uses «M-3» and a size «3» created after the answer, since «42-44» is now always asked. |

**The shared list** (ADR-0014 §7).

| Finding | What was done |
|---|---|
| **The ledger's minor 1.** Through the other store, a list was approved, and its movements written in the name of its own store, after that store had lost `can_receive` at the warehouse. | **Fixed.** Every command but a rejection, through the other store, also needs the list's own store to hold `can_receive` there: 409 `LIST_STORE_CANNOT_RECEIVE`, said on the page in words. How it is carried out, on reading 8's ground; not put to the owner. |
| **The ledger's minor 2.** The history of an answer did not name the store acted through. | **Fixed:** `via_store_id` on `snapshot.line_resolved`. |
| **Fidelity major 2.** Reading 1 was confirmed on a question saying a paused warehouse's list may be changed from its own store; the build lets that store only reject it. | **Kept as built.** The reading is reworded to what is built, and put again (R-a, awaiting the owner). |
| **Fidelity major 3.** A manager was told to reject a list whose last file is wrong, and shown no button to do it. | **Fixed.** The decision panel shows to whoever may approve or add files; «Затвердити список» only to whoever may approve, while the list's store trades. |
| **The ledger's minor 4** (on main before this change). Creating a list parses its first part while holding the warehouse's lock, the order the ADR refuses for adding a part. | **Kept at first, as M1-023's order; fixed in the second round** (below). |

**The request and the phone** (ADR-0014 §11, §13, §15, §16).

| Finding | What was done |
|---|---|
| **Security major 1; the ledger's minor 3.** A 422 about the request around a file (no `file_name`, a file and lines together, a file with `source`, a body that is not an object) sent the whole body back: 148 211 bytes for a 1 000-line file. | **Fixed.** No 422 under `/api/v1/snapshots` carries `input` or `url`, wherever the refusal stands. `test_no_refusal_of_a_stock_list_s_request_echoes_it`, 8 cases, each answer under 2 000 bytes. |
| **Security minor 6.** A small body of many unknown keys answered with a 12.7 MB 422. | **Fixed.** Every 422, on every route, lists at most 50 refusals, and `detail_truncated` counts the rest; the phone adds it to «…і ще k». |
| **Security major 2.** «Додати рядки вручну», after a lost answer and the text changed, was refused as another request for good, its words promising otherwise. | **Fixed.** On that refusal the text is kept, a new command taken and the list read again; the lines go as new at the next press. |
| **Fidelity minor 23.** A removed file added again could replay the removed part. | **Fixed.** A replay naming a removed part sends the file once more, as new. |
| **Security minor 5.** After a slow answer, another file picked could start a second list at the warehouse. | **Fixed, more strictly than proposed.** The draft keeps its command until the server answers a send; the warehouse's lists are read again; a list made by this command is opened, never made twice. «Почати як новий список» still bypassed it; the second round closed that (below). |
| **Fidelity major 4; fidelity minor 7.** An answer the list had no room for read «Перевірте дані та поточний статус замовлення.», and the README called it `LIST_FULL`. | **Fixed.** Still a 422, now named: `LIST_FULL`, `allocations`, `limit`, `now`, `adding`; the editor says why and what frees room. |
| **Security minor 1.** At 375 px a long file name pushed the page sideways, up to 589 px. | **Fixed:** `overflow-wrap: anywhere` on the list overview and page only. |
| **Security minor 2.** The phone took a file the validator refuses: `1e400` became null. | **Fixed:** any number too large to be one, anywhere in the file, is refused on the phone. |
| **Security minor 3.** The phone measured a file against the request's 990 000 bytes; the server refuses above 950 000. | **Fixed:** the file against 950 000, as the server measures it; 990 000 stays the request's cap. |
| **Security minor 4.** `visible()` left C1 controls, the soft hyphen, variation selectors and more unmarked, and the server took C1 controls. | **Fixed on both sides:** the file refuses U+0000–U+001F and U+007F–U+009F in every string; `visible()` marks by Unicode's classes. |
| **Security minor 7.** The draft kept the file's `source` and `counted_on`; names, store names and a rejection's reason were shown unguarded. | **Fixed:** what the file filled in is left out of the draft and filled in again from the file; every such string goes through `visible()`. |

**Words on the screen and in the validator.**

| Finding | What was done |
|---|---|
| **Fidelity minors 19–22.** «2 разів»; «текст — задовге», «фото — немає»; «версія» and «версія формату» for one field; «961204 байтів»; the hint for a count without «шт». | **Fixed,** the phone and the validator alike: «2 рази», «5 разів»; «поле «текст» задовге», «поле «фото» відсутнє», `size` named «розмір»; «версія формату»; «961 204 байти»; «Парсер прочитав кількість, але в рядку вона не написана зі «шт» — це лише підказка. Вкажіть кількість і звідки вона відома.»; the room's numbers grouped, «5 000». |
| **Fidelity minor 6.** A comment said 7.5 s for the approval measured at 7.6 s. | **Fixed.** |

**Readings the owner did not decide.**

| Finding | What was done |
|---|---|
| **Fidelity minor 1.** The 10 000 lines a list takes over its life, removed files' included, were among no reading; reading 3's question did not say removed files count among the 1 000 files. | **Kept as built; to be asked** (R-b, and, since the second round, R-e for the 1 000 files). |
| **Fidelity minor 2.** Lines typed by hand are removed as a file is; the owner decided removal for files. | **Kept as built; to be asked** (R-c). |
| **Fidelity minor 3.** A file may leave `price_kind` out; the owner said it is given once per file. | **Kept as built; to be asked** (R-d). |

**The documents.**

| Finding | What was done |
|---|---|
| **Fidelity major 5.** The release verdict, row 11a, the README and three documents claimed what is not verified: the final run, the edge's body check, Telegram Desktop working. | **Fixed:** each said what was still to come, the final run and the edge job, both since run and filled in (2026-10-09); Telegram Desktop is "expected to work, not tried", and row 26 tries it too. |
| **Fidelity major 6.** This report called the E2E journeys planned and counted them run. | **Fixed:** "Verification", above. |
| **Fidelity minors 4, 5.** "A photo's lines are never split across files" read as a checked rule; "the slow call has no journey" was false. | **Fixed:** guidance, not checked; proven with a browser clock, not on a phone. |
| **Fidelity minors 8–18.** The evidence's line cap as if current; the cap's raise dated to the first day; `0a8adba` left out of the baseline; "no independent review"; reading 5 saying a range choice is kept; "built on 2026-10-08" alone; the ADR's quotes of the screens and its old line numbers; ADR-0005 and ADR-0013 not amended to match; the checklist's header. | **Fixed,** each where it stood. |

**What the fixes did beyond the findings.**
- A price matches only as one run of digits in the text: «1 850» or
  «1850.50» in the text sends the line to a note. «48-48» shows no split,
  48 being written twice. A sign spaced from the digits after a count
  («M-3 + 2») is refused by the rule of other numbers.
- A re-answer that differs only in `split_read_as` is a new answer and
  moves `review_revision`. The line view carries `split_read_as`.
- `details.allocations_elsewhere` of the full-list answer became `now`;
  nothing read it.
- The phone: a file read finishing after the person typed the list's name
  overwrote it; drafts now merge into what is on the screen. A form-long
  command of «Додати файл», used where storage fails, is forgotten on any
  answer, as the stored one is.
- `visible()` by Unicode's classes marked an emoji's variation selector:
  «Оля ❤⟦U+FE0F⟧». The second round leaves an emoji's own selector and
  joiner as they are (below).

**Left as it is, and why.**
- After `LIST_STORE_CANNOT_RECEIVE` the page says why, but still offers the
  other commands: the list carries no flag for it (risk register).
- The validator's own words for a wrong `format` or `version` are not
  repeated on the phone, which refuses both before sending.
- The coverage of `LIST_FULL` and `LIST_STORE_CANNOT_RECEIVE` on the screen
  uses the server's answers faked in its shapes; the server's side of each
  has its integration test.

**Verified after the fixes, on 2026-10-09** (the final run's figures under
"Verification"):
- backend: ruff, format (330 files), mypy (156 files), 31 import contracts
  kept; the whole suite on a fresh database, 3 074 passed and 1 skipped;
  `alembic check` clean, and `0037` down and up again on an empty database;
- frontend: typecheck, lint, build and Prettier; E2E on a fresh seed, 259
  passed, three journeys new;
- mutants by hand, each applied alone, caught and reverted, the tree byte
  for byte as before: 17 on the server (the split's every new rule, the
  range by numbers, the approval's second reading, the own store's
  receiving, the echo, the C1 controls), 15 on the phone (each of its
  fixes);
- the format's package test after the documents: 60 passed.

### The review's second round (2026-10-09)

The fixes were checked again the same day, against the three reviews and
the plan, with probes of their own. Seven of the first round's items were
found fixed in part, or not at all, and nineteen new findings were raised
(1 major, 18 minor).
Every one, and what was done:

**The split, and the range** (ADR-0014 §5).

| Finding | What was done |
|---|---|
| **New major; the blocker, the ledger's major 1 and the plan's split rule, in part.** «Nothing beside it» asked only the parser, which reads XS to XXL: «Лоран S-1 M-2 XXXL» was tapped and approved end to end, and so were «M-3 XXS», «M-3 ХL» with a Cyrillic Х, and «M-3 М», M written twice. | **Fixed.** Any other word that is a letter size by Birka's own spelling (`spell_size`, `letter_rank`) stops the split, read by the parser or not; a size counts as written twice in any of its spellings («M-3 М», «XXL-1 2XL», «OS-3 ＯＳ»). The parser's preposition «с» stays no size, as the parser has it («куртка с капюшоном M-3» keeps its tap). |
| **Numerals outside `\d`.** «M-3½», «M-3 ①», «M-3 ²», «M-3 Ⅲ» showed M:3. | **Fixed:** a numeral is any character `str.isnumeric` takes, both after a count and among the other numbers. A number written as a word («і ще два») or in Latin letters («III») stays a residual (risk register). |
| **A number the file calls the price is excused.** «S-1 M-2 L-1 разом 5» with a price "5", «46-2 48» with "48", «M-3 3» with "3", «M-3 + 2» with "2" were tappable. | **Narrowed, and the rest put to the owner.** A count ends before a sum or a product with spaces about its sign too («M-3 + 2», «M-3 x 2», «M-3·2»), whatever the price. The price itself stays excused, as the plan decided; ADR-0014 §5 and the risk register now say it, the format's description tells the parser's author to write `price` only for a price, and the choice is reading R-f, awaiting the owner. |
| **The person's word is per record, the check per line** (two findings). «Куртка 42-44 46-2» answered for «42-44», then a size «2» created: approved, nobody asked of «46-2». | **Fixed.** The line keeps the records the word was said of, `split_read_records` (in `0037`: JSONB, NULL exactly when `split_read_as` is, a list, refused by the downgrade, cleared with a removed part); the approval refuses a record that may be a range and is not among them. A re-answer covering more records is a new answer. |
| **One 3.4–3.6 s run of the re-check's text read** at 5 000 lines, not reproduced. | **Changed and measured.** The rows and their texts are one statement (`catalog.raw_lines.text_of`, a scalar subquery per row); `read_texts` and its `IN` are gone. 5 000 answers, all by size, three approvals: 8.55, 8.16 and 7.79 s, the re-check 0.14–0.19 s; the 2026-10-08 method, the same hour: 7.78, 6.94 and 9.50 s ([evidence](../../output/verification/2026-10-09-json-import-approval-by-size/README.md)). Within the rule, with less room than the first run showed (ADR-0014 §10, risk register). |
| **FILE_SPLIT_NOT_IN_TEXT** told the reviewer a line does not show a split it plainly shows, now that a stray number refuses it too. | **Reworded:** «Парсер прочитав кількість по розмірах, але рядок показує її не так або не лише її — одним натиском її не підтвердити. Вкажіть, звідки відома кількість.» |

**The ledger.**

| Finding | What was done |
|---|---|
| **The ledger's minor 4, not fixed.** Creating a list parsed its first part under the warehouse's exclusive lock; no decision kept it. | **Fixed.** The first part's lines are parsed and kept while nobody else sees the list; the hold is taken after them (ADR-0014 §8, ADR-0005 §10). `test_a_new_list_parses_its_lines_before_it_holds_the_warehouse`. |

**The request and the phone.**

| Finding | What was done |
|---|---|
| **U+2028 and U+2029** passed the server's refusal of controls and `visible()`; the file's name refused only C0 and DEL. | **Fixed:** both separators are refused in every string of a file, and in the file's name, which shares the file's check (`stock_file.has_control`); `visible()` marks `Zl` and `Zp`. |
| **A 422 named an unknown key whole in `loc`,** 300 151 bytes for a 300 KB key, and the phone printed it. | **Fixed:** on the stock-list routes each string of `loc` and `ctx` is cut to 60 characters and «…»; the phone cuts a key or a value it prints the same way, its own scan's included. A short key is still named, so the person can find it in the file (ADR-0014 §13). |
| **The plan's slow-answer fix, in part; security minor 5.** «Почати як новий список» right after a slow answer minted a new command with no re-read, and a list made after the re-read could get a second beside it. | **Fixed:** not offered while the send is unsettled, only after an answered refusal; pressing it reads the warehouse again, and «Зберегти список» waits while the warehouse is read. The E2E journey "…its list made only after…" holds the request past 60 s, makes the list late, and saves again: one list, opened. |
| **`visible()` marked the parts of an emoji** in people's names: «Оля ❤⟦U+FE0F⟧», «👨⟦U+200D⟧👩⟦U+200D⟧👧». | **Fixed:** a variation selector right after a pictograph or in a keycap, and the joiner between two pictographs, are left as they are; after a letter or a bare digit they are still marked («M⟦U+FE0F⟧»), since there two texts that look the same differ. |
| **Two paragraphs of the list page** (its date, a rejection's reason) pushed a 375 px page sideways. | **Fixed:** `.openings p` and `[role=status]` break anywhere; the narrow-phone journey checks a 40-character date and a link as the reason. |
| **The notice told people who cannot approve «Затвердіть або відхиліть його.»** (two findings). | **Fixed,** by right: whoever may approve is asked to approve or reject; a manager who may add files, that approving is for whoever may approve lists and rejecting is theirs too; nobody else is asked anything. |
| **Removing typed lines asked «Прибрати файл Рядки, внесені вручну?»** (two findings). | **Fixed:** «Прибрати рядки», «Прибрати рядки, внесені вручну? Ці рядки (N) …», and a last-part hint of their own (ADR-0014 §15). |

**The documents.**

| Finding | What was done |
|---|---|
| **Fidelity minor 1, in part.** Reading 3's question never said removed files count among the 1 000 files. | **Put again:** R-e, awaiting the owner. |
| **R-b's question in masculine forms** («прибрав — додав знову»). | **Reworded** to «прибрати — додати знову», nothing else changed. The lead's plan still quotes the old form. |
| **The range rule described as two number sizes** (README, glossary, runbook, this report). | **Fixed:** the ADR's wording everywhere. |
| **The status lines said every finding was fixed.** | **Fixed:** "fixed, or kept with the reason", in the README, the milestone and this report. |

**Verified after the second round, on 2026-10-09** (the final run's
figures under "Verification"):
- backend: ruff, format (330 files), mypy (156 files), 31 import contracts
  kept; the whole suite on a fresh database, 3 135 passed and 1 skipped,
  the catalogue evaluation's integration file left out, as it needs
  `birka_test`; `alembic check` clean, and `0037` down and up again on an
  empty database, clean again;
- new tests: unit `test_file_lines.py` (letter sizes by spelling, the
  preposition «с», numerals of any script, sums with spaces, a size in
  another spelling, the price pinned as excused), `test_stock_file.py`
  (U+2028, U+2029), `test_app.py` (names cut to 60); integration
  `test_snapshot_parts.py` (the word per record at the approval, its
  database checks, a list parsed before its warehouse is held, a file's
  name with a separator, a key of 300 000 characters);
- frontend: typecheck, lint, build and Prettier; E2E on a fresh seed, 260
  passed, one journey new ("…its list made only after…"), and the
  narrow-phone, lost-answers, format-checks and shared-list journeys
  extended;
- 21 hand mutants, each applied alone, caught and reverted, the tree byte
  for byte as before (`git diff --stat` and every changed file's sha256,
  before and after): 14 on the server (each new rule of the split, the
  approval's reading per record, the import's order, the separators, the
  names cut), 7 on the phone (the button after a slow answer, the emoji
  marks, the separators, the notice, the typed lines, the paragraphs, the
  key cut). Three survived at first, a numeral or a spaced sign after a
  count and the paragraph rule: the count's end was then made one rule
  (`file_lines._ends_cleanly`) and the tests given a case each, and all
  three were caught.

### The review's third round (2026-10-09)

The second round's fixes were checked again the same day, with probes of
their own, and six items were decided for one more round of fixes. Every
one, and what was done:

| Finding | What was done |
|---|---|
| **The person's word was credited to records nobody was asked about** (the re-check's probe P3). The answer kept as its records those that might be a range when it *arrived*: a size «2» created between the editor's look at «Парка 42-44 46-2», which asked about «42-44» only, and the answer credited «46-2» too, and the approval passed. | **Fixed.** The answer names the records the editor asked about, `split_read_records`, with `split_read_as`, each as `shown_split` writes it. A record that may be a range as the answer arrives and is not among them refuses the answer, 422 `SPLIT_MAY_BE_RANGE` naming it, and nothing is kept; a record not of the line's split is refused (`SPLIT_RECORD_UNKNOWN`); the line keeps exactly the records named, in the line's order; the approval reads them record by record as before. The editor sends them. Integration `test_a_size_created_while_the_editor_was_open_is_never_credited_to_the_person` and `test_the_person_s_word_is_kept_for_exactly_the_records_it_names`; unit tests of the request and of `_stated_split`; the range journey checks the body sent (ADR-0014 §5, §13). |
| **The re-check's text read depended on the planner's statistics.** `text_of` correlated the raw input on its id and its organization; with the statistics a test suite leaves, the planner read the organization's index for each row: 1.36–1.39 s at 5 000 lines. | **Fixed.** The raw input is found by its primary key alone, and its organization checked with `IS NOT DISTINCT FROM`, which no index serves; a line of another organization still reads as no text. Measured with a test suite's statistics, in one session: the old form 1.39–1.63 s (EXPLAIN 1 395 ms), the new 0.007–0.008 s, the first read of the second run 0.091 s (6.7 ms). The approval by size at 5 000, three runs on a fresh database: 7.21, 8.48 and 7.59 s, the second reading 0.11–0.19 s; the 2026-10-08 method the same hour, 8.00, 9.87 and 7.30 s. All pass; 9.87 s is the closest to the 10 s rule yet, the laptop's spread ([evidence](../../output/verification/2026-10-09-json-import-approval-by-size/README.md); ADR-0014 §10). |
| **The count's end missed spellings of its sign.** «M-3X2», «M-3 Х 2», «M-3 x 2» with no-break spaces and «M-3✕2», each with a price "2", showed M:3. | **Fixed.** The sign is compared casefolded, any whitespace `str.isspace` names may stand about it, and `✕ ✖ ⨯` join `+ / × * x х · ⋅`. ADR-0014 §5 and the format's §7 say it as built. Unit cases, each with a price "2". |
| **An apostrophe split a word, and a capital «С» lost the tap.** «Лоран м'ята M-3» and «Лоран м’ятний S-1 M-2» read an «м» as the size M; «Куртка С капюшоном M-3» read a size S. | **Fixed.** A word of the line is the catalogue's own (`catalog.sizes.WORD`, made public), an apostrophe inside it included; «с» and «С» follow the parser's rule: the preposition when lowercase or with another word after it, S when a capital with nothing after it («M-3 С»), and a size when joined to a count by a sign («С-3»). Every earlier negative still shows no split. What it leaves: «Лоран С M-3» shows the split of M, as the parser reads the line (ADR-0014 §5, risk register). |
| **The phone settled an unsettled draft on any answer.** A later send refused for its form offered «Почати як новий список» again while the slow first send might still be taken. | **Fixed.** The draft stays unsettled until a list comes in answer, or a refusal as the same command sent before in another form whose re-read finds the list this command made. While it is unsettled, that refusal's text drops «або почніть новий». The "…made only after…" journey sends again between and is refused for its form; a new journey fakes the conflict before and after the list waits (ADR-0014 §16). |
| **R-e's wording.** The 1 000 counts parts, typed lines included, not files only. | **Reworded** in reading 3 and R-e: «до 1 000 частин — файлів і рядків, внесених вручну, — рахуючи й прибрані»; the rest of the question unchanged. The runbook, the risk register and this report say parts too. |

**Verified after the third round, on 2026-10-09** (the final run's
figures stay under "Verification"):
- backend: ruff, format (330 files), mypy (156 files), 31 import contracts
  kept; the whole suite on a fresh database, 3 160 passed and 1 skipped
  (`age`), the catalogue evaluation's integration file left out, as it
  needs `birka_test`; no migration changed;
- new tests: unit `test_file_lines.py` (21 cases: the count's end, the
  apostrophe, «с» and «С»), `test_snapshot_import.py` (2); integration
  `test_snapshot_parts.py` (2), and the six answers by size there now name
  their records;
- frontend: typecheck, lint, build and Prettier; E2E on a fresh seed, 261
  passed, one journey new ("a send refused as the same command in another
  form…") and two extended (the range journey checks the records sent; "…its
  list made only after…" is refused for its form between). A first full run
  lost its dev server to a crash of Node itself ("Lazy deopt after a fast
  API call with return value is unsupported", in Vite's response writer)
  after 207 journeys, and every journey after it timed out; run again on a
  fresh seed, all passed;
- 18 hand mutants, each applied alone, caught and reverted, the tree byte
  for byte as before (`git diff --stat` and every changed file's sha256,
  before and after): 13 on the server (the word credited to every record,
  an unknown record taken, the records kept in the order sent, the request
  without its records; the sign not casefolded, spaces only about it, no
  ✕; words split at apostrophes, a capital «С» never a preposition, a
  counted «С» a preposition, a word's end blind to apostrophes, a
  preposition counted as the size written), 5 on the phone (no records
  sent, records named by their size, any answer settling the draft, a
  conflict settling whatever the re-read finds, a conflict never settling).

### The review's fourth round (2026-10-09)

The third round's fixes were checked again the same day, with probes of
their own: four of its items were found done in part, and eleven findings
were new. Every one, and what was done:

| Finding | What was done |
|---|---|
| **A capital «С» before any later word, the price included, was read as the preposition** (major; the third round's apostrophe and «С» item, in part). «Лоран M-3 С 1850» with a price "1850", «Лоран M-3, С 1850», «Лоран M-3 С 3шт», «Лоран M-3 С без кількості», «Лоран С, M-3», «С M-3» and «Лоран С M-3» showed the split of M, and «Лоран S-1 M-2 С 1850» its split though it writes S twice. | **Fixed, more strictly than proposed.** A lowercase «с» stays the parser's preposition. A capital «С» is the preposition only where it begins a phrase Birka's own parse reads («Куртка С капюшоном», «С лисой», «С норкой»), and S anywhere else. The proposal, a word of letters after it that is no size and no «шт», would still show «Лоран M-3 С без кількості»; the phrase closes it, at the cost of a note for «Куртка С поясом M-3», as before the third round. Each line named is a pinned negative; «Куртка С капюшоном M-3» and «Шуба С норкой M-3» keep their tap. What it leaves: a lowercase «с» written for S («Лоран M-3 с», pinned as shown; ADR-0014 §5, the format's §7, the risk register). |
| **The apostrophe join hid Latin sizes** (minor). «Лоран M-3'L», «Лоран M-3’XL», «Лоран M-3 L'S», «Лоран M-3 XL’XXL» and «Лоран S-1 M-2 L'L» showed their split. | **Fixed.** An apostrophe joins two words only as in a Ukrainian word: a Cyrillic letter before it and «я», «ю», «є» or «ї» after it (`file_lines._WORD`; `catalog.sizes` is back as it was). «м'ята», «м’ятний» and «мʼята» keep their tap; the five, «Лоран S-1’M-2’L-4» and «Лоран M-3 С'Л» are pinned negatives. |
| **The count's end was a list of signs, and missed others** (minor). «M-3＋2», «M-3＊2», «M-3ｘ2», «M-3∗2», «M-3•2», «M-3÷2», «M-3⁄2», «M-3⨉2», «M-3－2», «M-3~2», a zero-width space or a soft hyphen about the «x», «M-3 – 2» with no-break spaces, «M-3٫5», «M-3，5» and «M-3．5» showed M:3 beside a price "2" or "5". | **Fixed: what may end a count is named** (`file_lines._ends_cleanly`). The text's end; after whitespace, a numeral of its own; a letter, but `x` or `х` in any case or width before a numeral; `,` `;` `.` `)` with no numeral right after; `(` `[` `{` `«` or a currency sign; or any other sign with no numeral after it. Format characters (`Cf`) are passed over wherever they stand, and the gap about a size's sign takes any whitespace. Every case named is pinned, and «M-3» and «5» with only a zero-width space between them too. Every form with a sign the rule does not name between the count and a numeral changes its outcome and now goes to a note, a tap before: «;» or «)» with a numeral right after it («46-2;48-1», «M-3;2», «M-3)2»), read strictly on purpose though it may be a list; any other sign before a numeral, spaced or not, such as «Лоран M-3 @1850», «Лоран M-3 #1850» and «Лоран M-3 №1850» with that price, and likewise `%` `&` `!` `?` `'` `"` `_` `°`, a closing bracket or a quote other than `«`, a dash or a tilde that joins no size, an arrow or any other symbol; a format character or a combining mark between the count and a numeral; and a superscript or subscript `x` before one. A probe of every sign, mark and format character up to U+2FFFF after the count, the third round's rule against this one, found about 10 800 that changed, none the other way (the list as corrected after the round, ADR-0014 §5, the format's §7). «Лоран M-3 (1850)», «Лоран M-3 ₴1850», «S-1, M-2», «S-1; M-2», «46-2; 48-1» and «Лоран M-3. 1850» keep their tap (pinned). The published example's eleven lines read byte for byte as at the last commit. |
| **The editor credited the person's word to a record nobody answered** (major; the records item, in part). Read again on the phone's return to the app, a line made ambiguous meanwhile asked about «M-3», but «Як у рядку» stayed chosen, «Зберегти відповідь» stayed enabled, and the answer named «M-3». | **Fixed.** The answer names the records the person read as «Розмір … шт» in this editor (by `written`, or `size` when it is null), not every record the line flags. A basis the line no longer offers is no choice: «Як у рядку» and «Зберегти відповідь» wait for the new record's answer, and come back with it. The range journey creates the size with the editor open, brings the phone back to the app, and checks the question, the disabled button and the records sent. |
| **After a `SPLIT_MAY_BE_RANGE` refusal the editor never asked the new question** (two minors). Cancelling and opening the line again, as the alert said, reused the line as read before, and every resend was refused alike. | **Fixed.** The refusal reads the list's lines again with the editor open, which then asks about the records the server named, and the alert names them: «Запис «M-…» тепер може означати й діапазон розмірів. Рядок прочитано знову: вкажіть нижче, що він означає, і збережіть відповідь ще раз.» The range journey answers by size while a size is created behind it: the real server refuses, the question appears, and the answer is kept. |
| **An unsettled draft never settled once its list was decided** (major; the draft item, in part). A lost send's list, rejected or approved, or made at another warehouse: the corrected list was refused as the same command, the re-read of the warehouse's waiting lists found nothing, and «Почати як новий список» never came back, even after a reload. | **Fixed.** A refusal as the same command sent before in another form settles the draft, whatever became of that list: the server took the command under the import's lock, so no send of it makes another list. «Почати як новий список» still reads the warehouse before the new command can be sent, and a list that waits there is named instead. A list a draft's command made, opened from the overview, ends the draft, as «Відкрити список» does in the form. The journey whose server answers were faked is replaced by one against the server (ADR-0014 §16, risk register). |
| **A first send answered 502 or 504 left the draft settled** (minor). | **Fixed.** A gateway's 502, 503 or 504 is no answer (`unreachable`), as for the server's reach: the draft is unsettled, and the form says «Невідомо, чи збережено список…». The new journey's first send is a 504 after the list is made. |
| **«Список повний: не більше 1 000 файлів»** (minor). The limit counts parts, typed lines and removed ones included. | **Fixed:** «Список повний: не більше 1 000 частин — файлів і рядків, внесених вручну, — разом із прибраними.» The narrow-phone journey checks it. |
| **No test pinned `text_of`'s tenant check or its form** (minor). Without the organization's check, or with `=` again, every test passed. | **Fixed.** Integration `test_a_line_s_text_is_read_for_its_own_organization_only`: under another organization's id no text is read, and the re-check then asks about the line, never passes it. Unit `test_a_line_s_text_is_read_by_its_key_with_its_organization_checked`: the compiled subquery holds `IS NOT DISTINCT FROM` and no `organization_id =`. |
| **The text read's figures and the slowest approval** (minor; the measurement item, in part). | **Fixed.** ADR-0014 §10 and the third round's row: 0.007–0.008 s, the first read of the second run 0.091 s; the risk register gives 9.87 s (by size 8.48 s); the limits above say six times. |
| **The key of a record the text no longer shows** (minor). | **Documented:** by its `size` when `written` is null, in ADR-0014 §5 and §13, the README and the request's comment. ADR-0014 §5's «What this does not see» names four, as the risk register does. |

**Verified after the fourth round, on 2026-10-09** (the final run's
figures stay under "Verification"):
- backend: ruff, format (330 files), mypy (156 files), 31 import contracts
  kept; the whole suite on a fresh database, 3 208 passed and 1 skipped
  (`age`), the catalogue evaluation's integration file left out, as it
  needs `birka_test`; no migration changed. A unit file this change does
  not touch, `test_backup_limits.py`, is bound to time: two of its tests
  failed in one run of the unit tests (a hung tool's pid file not yet
  written at 0.5 s), and they passed in the whole run and in two of three
  runs on their own;
- new tests: unit `test_file_lines.py` (246 cases to 292: the count's end,
  the capital «С», the apostrophe, a bracket or a currency sign before the
  price), `test_snapshot_import.py` (1); integration
  `test_snapshot_parts.py` (1); the published example's eleven lines read
  as at the last commit;
- frontend: typecheck, lint, build and Prettier; E2E on a fresh seed, 261
  passed: the range journey and the narrow-phone journey extended, the
  third round's faked journey replaced by one against the server;
- the review's own browser probes, built on the changed screen: the editor
  re-read on the phone's return asks about «M-3» and keeps «Зберегти
  відповідь» disabled, sending nothing; a refused answer reads the line
  again and names «46-2»; a 504 leaves the draft unsettled with no new
  list offered; a list rejected meanwhile no longer blocks a new one; a
  form's 422 still leaves the draft unsettled;
- 22 hand mutants, each applied alone, the tree byte for byte as before
  (`git diff --stat` and every changed file's sha256, before and after):
  14 on the server, all caught (every capital «С» a preposition, a counted
  «с» a preposition, an apostrophe joining before any letter or any two
  words, a format character not passed over right after a count or
  anywhere, any other sign ending a count, the product letters not by
  width, no opening signs, a list sign before a spaced numeral read as a
  fraction, the gap spaces and tabs only, a numeral after whitespace no
  number of its own, `text_of` without its tenant, and with `=` again); 8
  on the phone, 7 caught (a basis the line no longer offers kept, no
  re-read after a refusal, the refusal naming no record, a conflict
  settling nothing, a 504 taken for an answer, the overview keeping the
  draft, the parts limit said in files). One survived, the records named
  by the line's flags rather than by the answers: with every flagged
  record answered before the tap is offered, the two lists are the same
  whenever an answer can be sent, so it is kept for what it says.

**After the fourth round, the same day** (a re-check of its fixes, four items). (1) The modifier letters that write a sign, U+02B9 to U+02C1, U+02C6 to U+02D1, U+02EC and U+02EE (`ʼ`, U+02BC, among them), are no letters of a word, though Unicode counts them letters (`file_lines._LETTER`, in `_WORD`, `_STARTS`, `_ENDS` and a count's end): «Лоран M-3ʼL», «Лоран M-3 LʼS», «Лоран M-3 XLʼXXL», «Лоран S-1 M-2 LʼL» and «Лоран M-3 СʼЛ» go to a note, «Лоран мʼята M-3» keeps its tap, U+02BC still joining a Ukrainian word, and «Лоран ʼM-3» gains one, as «Лоран 'M-3» always had. (2) The look-alikes of the times letter make a product before a numeral: the Greek `χ` and the Cyrillic `ҳ` `ӽ` `ӿ`, in either case, any width or form, with a mark or not (`_times_letter`: NFKD, marks dropped, casefolded); a combining mark or a variation selector is passed over wherever a numeral is looked for, and a mark where the count's end is read ends it with something unknown, so «M-3Χ2», «M-3ҳ2» and «M-3x2» with an accent on the `x`, each with a price "2", and «Лоран M-3» with an accent on the 3 go to a note. (3) `;` and `)` before a numeral stay read strictly («46-2;48-1» goes to a note, «46-2; 48-1» keeps its tap), and the fourth round's «Two forms change» is corrected above to every form that changed, as ADR-0014 §5, the format's §7 and the risk register now list them. (4) The constants written as literal look-alike characters are `\u` escapes again (`SPLIT_SEPARATORS`, `_APOSTROPHES`, `_CYRILLIC_LETTERS`, `_IOTATED`, `_TIMES_LETTERS`, `_OPENING_SIGNS`, `_PREPOSITION`), and so is the byte order mark `stock_file.load_stock_file_text` strips, written until now as the invisible character itself; a byte scan of `backend/app/modules/snapshots/*.py` finds no invisible character anywhere and no character outside ASCII in code, comments and docstrings aside. Verified: ruff, format (330 files), mypy (156 files), 31 import contracts kept; the snapshot files, unit and integration, 810 passed; the whole suite on a fresh database, 3 263 passed and 1 skipped (`age`), the catalogue evaluation's integration file left out; `test_file_lines.py` 292 cases to 347; the published example's eleven lines read byte for byte as at 43d6451; a probe of every sign, mark and format character up to U+2FFFF after a count, against 43d6451, found only lines that now go to a note; 13 hand mutants on items 1 and 2, each applied alone, all caught, the tree byte for byte as before. No frontend change.

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
of numbers mean notes; a size range can pass for a split, now asked about
when its numbers or the catalogue make it a possible range, and again at
the approval, record by record (2026-10-09), and at the answer for the
records it names (third round); a split shown by more than the parser
read, narrowed by the review in four rounds, a number the file calls the
price still excused on the parser's word (R-f), and a lowercase «с» read as
the parser's preposition; a draft whose send was lost, settled by the
server's word (fourth round); a warehouse larger than
the limit cannot be taken in; the measurement on PostgreSQL 16, with less
room on a busy laptop; the warehouse held for days; two lists at once from
two stores; a shared list whose own store stops trading, or may no longer
receive there, now rejected through the other store (2026-10-09), still not
approved; the readings awaiting the owner; the Telegram file picker; the
slow call proven with a browser clock only.

## What is not done

- **The parser.** Whoever makes it, from the package. No real file exists
  yet.
- **A file picked on a real phone in Telegram,** on an Android and an
  iPhone: release checklist row 26.
- **The shops' count of their largest warehouse** (pages × lines per
  page). Above 5 000, the limit is raised first, by a change to the ledger,
  before going live (owner, 2026-10-08; [backlog](backlog.md)). The count
  counts each size of a line that names several.
- **The slow call on a real phone,** on a slow network. Three journeys
  prove it with a browser clock, and a fourth loses the server's answers
  on their way back.
- **The catalogue screens** still show raw text unguarded.
- **Readings awaiting the owner:** six, R-a to R-f in the business rules:
  reading 1, put again as built (a paused warehouse's list only rejected
  from its own store); the 10 000 lines a list takes over its life, removed
  files' included; lines typed by hand removed as a file is; a file without
  the kind of its prices; the 1 000 parts — files and lines typed by hand —
  a list takes over its life, removed ones included (reading 3's part its
  question left out); and a
  number the file calls the price, taken as the price on the parser's word
  beside a split. Not asked on 2026-10-09; each stands as built until the
  owner answers. Of the nine readings put on 2026-10-09, two changed and
  were built (above); reading 1 is put again whole (R-a), and reading 3 for
  its part about removed files (R-e); the other five stand confirmed.
- **This change's final run:** the full backend suite, the E2E count,
  `alembic check` and the `0037` round trip, the frontend's gates, and the
  edge job: all passed on 2026-10-09, under "Verification".
