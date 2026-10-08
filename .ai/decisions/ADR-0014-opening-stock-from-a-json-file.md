# ADR-0014: Opening stock from a JSON file

Status: Proposed (2026-10-08)
Owner decisions: business-rules.md, "the shops' existing stock" (2026-10-08),
with the answers to the design's questions the same day; "going live"
(2026-10-01); "the first days" (2026-10-02).
Amends: ADR-0005 §2, §3, §8, §9, §10 and its Consequences; ADR-0010 §2 (the
largest body); ADR-0013 §4.2 (a slow call is not an outage).
Builds on: ADR-0001 (module boundaries), ADR-0003 (a command's permanent
identity), ADR-0005 (legacy lists and opening balances), ADR-0009 (one size,
one spelling).

## Context

The owner chose how the shops' existing stock gets in. The shops
photograph their notebooks and tables, a parser outside Birka reads them
into a JSON file in a format Birka defines, and the app takes the file into
the warehouse's list in «Початкові залишки». Every line is still reviewed by
a person. The owner approves the list, and only then does it become the
warehouse's opening balance (ADR-0005).

The owner also decided, the same day:
- **several files fill one list.** It is reviewed in parts and approved
  together, and its limits are raised;
- **a line keeps the photo's name** and its line number on the photo;
  Birka keeps no photo;
- **the price on a line is only shown,** sale or purchase, one kind per
  file;
- **a file added by mistake is removed**, with its lines and their answers,
  by the owner or any manager, with no reason. The history shows who and
  when. The last file is not removed: the list is rejected instead. A
  removed file may be added again, as a new file;
- **hand-typed lines** may join a list of files, as a part of their own;
- **the parser's count is a hint unless the text states it** («3 шт»). A
  number without «шт» is not a count by itself, even when the parser says it
  is;
- **counts per size occur** («S-1 M-2 L-1»). A split the line's text shows,
  each size with its count, is confirmed by a tap without a note. For this
  case only, it changes ADR-0005's rule that a split is never stated;
- **every written line is passed on**, crossed out, illegible, a heading or a
  total included, with the parser's note;
- **the warehouse waits for the whole review**, even for days;
- **a list of the shared warehouse belongs to both stores.** The managers
  of either store who may import lists there see it, add files to it and
  review it. The app does not offer a second list for a warehouse whose
  list is waiting.

ADR-0005 has no way to add to a list or take a document out of it. An import
is one list of at most 1 000 lines. A list belongs to the store that typed
it, nothing on it names a photo or a parser's reading, and the split of a
line is never stated.

**The evidence changes.** Before, the verbatim line was what a person typed
from the notebook. Now it is the parser's transcription. The original is
the photo, and only the shop keeps it. Birka keeps:
- the transcription, verbatim;
- the parser's reading beside it, as a hint;
- the photo's name and line, so a person can go back to the original.

## Decision

### 1. The file: `birka.stock-list`, version 1

**Encoding.** UTF-8 JSON, raw characters or `\uXXXX` escapes alike. A BOM is
accepted.

**The file is one object:**

| Key | Type | Rule |
|---|---|---|
| `$schema` | string | optional, ignored: editors add it |
| `format` | `"birka.stock-list"` | required |
| `version` | `1` | required; another version is refused by name |
| `source` | string 1..300 | optional: which notebook, as people call it |
| `counted_on` | string 1..40 | optional, free text, like a list's date today |
| `price_kind` | `"sale"` or `"purchase"` | optional: the kind of every price in the file (owner: one notebook, one kind) |
| `parser` | string 1..100 | optional: which parser and version wrote it |
| `lines` | array of 1..1 000 lines | required, in reading order |

**A line:**

| Key | Type | Rule |
|---|---|---|
| `text` | string 1..500, not blank | **required.** The written line verbatim, its count and price included. One JSON line per written line |
| `photo` | string 1..200 | **required.** The photo's file name, as the shop keeps it |
| `photo_line` | integer 1..10 000 | **required.** The line's number on that photo, from the top. On a spread or in columns, the left page or column first, the numbering continuing |
| `model` | string 1..200 | optional: the model as read |
| `colours` | array of 1..10 strings, each 1..60 | optional: each colour as written |
| `sizes` | array of 1..10 strings, each 1..20 | optional: each size as written, when no count is written per size |
| `size_counts` | array of 2..10 `{size, count}` | optional: each size as written with its own count (1..10 000). Never beside `sizes` |
| `count` | integer 1..10 000 | optional: the line's written total, a single integer («3+2» is no count) |
| `price` | string 1..40 | optional, as written. Never parsed |
| `note` | string 1..200 | optional: the parser's word to the reviewer («закреслено», «нерозбірливо») |

**The format is strict.**
- **Unknown keys** are refused at every level, except `$schema`.
- **Types are strict:** `"7"` is not `7`, `true` is not `1`, and `3.0` is not
  `3`.
- **A duplicate key** is refused.
- **Empty and null.** An optional key may be absent or `null`, never `""`
  or `[]`.
- **No string holds a control character** (U+0000–U+001F, U+007F). That
  includes a line break inside `text`, which would show one written line as
  two. This is a rule of a machine's output, not of a shop's text, so the
  reasoning of `core/text.py` does not apply. Lone surrogates are refused,
  as everywhere.
- **Pairs and sizes are unique.** `(photo, photo_line)` appears once per
  file. A `size_counts` names each size once, ignoring case.
- **A file is bounded.** At most 100 000 characters of `text` in all, and
  at most 950 000 bytes as compact UTF-8 JSON without its nulls (§11).
- **Splitting.** A photo's lines are never split across files: a notebook
  is one file, or one file per group of whole photos.
- **New needs make a new `version`,** never a silent extension.

**The warehouse is not in the file.** A person chooses it in the app, as
today. A file put into the wrong warehouse's list is removed (§9).

**The pydantic model `StockFileV1` is the format.** Parser authors get one
package:
- a description in Ukrainian with English keys;
- a JSON Schema generated from the model;
- an example file;
- a reference validator that checks what the schema cannot express (the
  rules above, duplicate keys, integer literals, the byte bound).

A test keeps the schema and the example equal to the model.

### 2. A list is filled by parts

**A part** is one file or one hand-typed text: the unit that is added,
shown and removed. A part keeps:
- its own `command_id` and request fingerprint;
- for a file, a content fingerprint;
- its kind (`FILE` or `PASTED`);
- the file's name, `source`, `counted_on`, `price_kind`, `parser` and
  format version;
- its line count, and its first and last line numbers;
- who added it and when, and who removed it and when.

Every list has at least one part. The migration makes each existing list one
`PASTED` part.

**Line numbers stay list-wide.** A new part's lines take `max(line_no) + 1`
onward, under the list's row lock. A part's lines are therefore contiguous,
a removed part leaves a gap, and `PUT /snapshots/{id}/lines/{line_no}` keeps
its shape.

**How parts arrive:**
- `POST /snapshots` creates a list from `lines` or from `file`, exactly one,
  and that is its first part;
- `POST /snapshots/{id}/parts` adds a file, or hand-typed lines (owner),
  while the list is `IN_REVIEW`.

### 3. What a file line keeps

- **The text.** One append-only `RawInput` per line, written through
  `catalog.raw_lines` (`SNAPSHOT_IMPORT`, `inventory_snapshot:{id}:{line_no}`),
  with Birka's own parse beside it, as today.
- **On the row**, written once and never changed:
  - `photo_name` and `photo_line`;
  - `reading`, exactly what the file said: `model`, `colours`, `sizes`,
    `size_counts`, `count`, `price`, `note`;
  - `file_reasons`, the reasons below;
  - `shown_split`, the split the text shows (§5);
  - the part.
- **Never in the catalogue, never a price.** Nothing in the reading reaches
  a model or a price. The price is shown and nothing else.
- **Provenance.** A line from a `FILE` part is a machine's transcription.
  Its `RawInput` is `SNAPSHOT_IMPORT` like a typed line, and its part says
  which. Anything that ever learns from snapshot lines, such as alias
  evidence (`ADAPTIVE_CATALOG_LEARNING.md`), must tell the two apart.

### 4. What a file line says about its count

The row's `quantity_total` and `quantity_state` still summarise what the
line said, and are never overwritten (ADR-0005 §2). Birka's own parse of
`text` decides them (`source_quantity`). The file's reading only adds
doubt, with one narrow exception (§5).

| Birka's parse of `text` | The file's `count` | The row |
|---|---|---|
| any | absent | as today |
| a count with its unit («3 шт»), equal to the file's | equal | as today: Birka's state and total |
| any count candidate, unequal or unsure | given | `UNKNOWN_QUANTITY`, no total, reason `FILE_COUNT_DIFFERS` |
| no count | given | `UNKNOWN_QUANTITY`, no total, reason `FILE_COUNT_HINT` (owner: a number without «шт» is not a count by itself) |

Then:
- **Several options.** A line whose file lists several sizes or colours,
  or whose text Birka reads as several, is `UNKNOWN_DISTRIBUTION`. Its total
  is kept if there is one: the `Лоран S M L 3 шт` rule.
- **A note goes to review.** A line with a `note` gets `FILE_NOTE`.
- **Status.** Any file reason, like any parser reason, makes the line
  `NEEDS_REVIEW`.
- **One piece.** A line for which the file gives a `count` or `size_counts`
  is never countless: «Рядок без кількості — одна штука» is not offered.
  `mentions_no_count` is otherwise unchanged. A line with a price or a
  numeric size and no count still needs a note, as the owner confirmed.

The parser's count is shown as a hint: «Парсер прочитав кількість: 3». The
person states the count with a note, as for any bare number today. No count
is ever invented, and the file can never make a line `KNOWN`.

### 5. A split the text shows

**The owner's rule.** Counts per size occur in the notebooks. A split the
line's text shows, each size with its count, is confirmed by a tap without
a note. One size with its count («Лоран M-3») is the same case. A size and
its count count as shown only when a sign stands between them («M-3»,
«M:3», «M=3»): «M 3», with a space alone, is a bare number, answered with a
note (owner, 2026-10-08, after the review). This amends ADR-0005 §3 for this
case only.

**When a split is shown.** Birka decides, at import, from the text, never
from the parser's word alone. A file line's split is shown when all of
these hold:
1. **At least one size.** The line has `size_counts` with one or more
   sizes, distinct after `spell_size` (ADR-0009), so `M` and `м` are one.
2. **Each size appears with its count.** For each `(size, count)`, the text
   holds exactly one place where the size, written as in the file (ignoring
   case), stands as a whole word:
   - not preceded by a letter or digit;
   - followed by optional spaces or tabs;
   - then exactly one sign from `-‐‑‒–—―−:=`: spaces alone are not a sign;
   - then optional spaces or tabs, and a run of digits not followed by a
     digit, whose value is the count.

   So `462` is never «46, 2», and `M 3` is never «M, 3».
3. **The places do not overlap.**
4. **The totals agree.** If the file gives `count`, it equals the sum. If
   Birka read a count with its unit, it is exactly one, equals the sum, and
   is unsure of nothing.
5. **One colour, no slash.** The line names at most one colour, in the file
   and in Birka's reading, and Birka found no slash options. A slash is
   contextual (constitution §21).

When it holds, the row keeps `shown_split`. With two or more sizes it is
`UNKNOWN_DISTRIBUTION` with the sum as its total; with one size it stays as
Birka read it, so `STATED` is never offered on the file's word.
**A size range written with a sign** (`42-44`) can pass this check if the
parser misreads it as size 42 with a count of 44. The person still taps, and
sees the text and the photo reference; the risk register names it. When it does not, the file's counts are a hint,
with reason `FILE_SPLIT_NOT_IN_TEXT`, and the line is answered as any split
is: with a note.

Hand-typed lines carry no file reading, so they never have a shown split.

**The basis `STATED_BY_SIZE`** («Як у рядку, по розмірах») is new. It
answers only a line with a shown split. Its answer must be:
- one model, in one allocation per size;
- each written size resolved to the organization's own size of the same
  spelling (`lower(code) = lower(spell_size(size))`), every one existing,
  and no two the same;
- each allocation's quantity equal to its size's count;
- with no size «невідомий».

A size the catalogue lacks makes the tap unavailable: the person creates the
size, or answers with a note. The approver sees how many lines and units
rest on it, like every basis.

**Never preselected.** The editor offers it only when every size resolved.
Choosing it fills the sizes and counts, and leaves the model to the person.

### 6. Review: the reading is a hint

Each answer is the same `PUT` as today, with the same bases and the new one.

**The line card shows**, every string through the display guard (§15):
- «Фото: IMG_1234.jpg, рядок 7»;
- «Прочитано: Лоран · чорна · S, M, L»;
- the parser's count as a hint;
- «Ціна з зошита: 1200 (продажна | закупівельна)»;
- the file reasons in words;
- the file the line came from.

**The editor:**
- **search.** It seeds the catalogue search with `reading.model`, falling
  back to Birka's concept, never with the colour: the search requires every
  word to match (`catalog/search.py:176-183`);
- **size.** It preselects only Birka's own single size, as today. The
  file's sizes are shown as text;
- **basis.** It preselects a basis only as today: `STATED` when Birka read
  the count with its unit, `LINE_IMPLIES_ONE` when the line may be one
  piece. It never preselects `STATED_BY_SIZE`, and never fills a quantity
  from `reading.count`;
- **model.** It never picks a model.

**Repeats.** `same_text_lines` stays list-wide, over lines not removed. A new
`same_photo_lines` counts the lines not removed that name the same photo and
line, which shows a photo read twice or put in two files.

### 7. A shared warehouse's list belongs to both stores

**The owner's rule.** The managers of either store who may import lists
there see the list, add files to it and review it.

**Who that is.** The warehouse's access rows already express it
(`store_location_access`, `can_receive`). Every list command and read names
the store the person acts through, `store_id`, which defaults to the list's
own store (`acting_store_id`).

**Through the list's own store:** exactly as today, ADR-0005 §9.

**Through another store**, both conditions:
- that store holds `can_receive` at the list's warehouse;
- the person holds the action's permission there, under the private-
  warehouse rule (`require_stock_access`, with capability `RECEIVE` for
  reads too). Only a store that may import there shares the list.

A child store's own warehouse is reached by that store alone, so its list
stays its own (Q5).

**What does not change.**
- The list's `acting_store_id` is still the store that created it.
- The opening movements' acting store is still `acting_store_id`, as
  ADR-0005 §4 writes them.
- A command still needs that store trading.

**A list waiting at a warehouse is visible from either store.**
`GET /snapshots?store_id=` lists, for that store:
- its own lists, under today's reach rule;
- every list at a warehouse where it holds `can_receive`;

and a `location_id` filter answers «what waits here».

**The app does not offer a second list.** Before a list is created, it
names the one waiting and opens it. The server still accepts a second list,
as today: four tests of the opening race depend on it, and the owner's rule
is about what the app offers. Two people starting lists at once in two
stores can still make two, and only one of them can be approved
(Consequences).

### 8. Adding a part

**Authorization** is as for creating a list (§7, §12), and the list must be
`IN_REVIEW` (409 `SNAPSHOT_CONFLICT`, reason `ALREADY_DECIDED`).

**A stock-list command id is one name.** It names either a list, through
the list's first part, or one added part. Never both, and never parts of two
lists.
- **One lock.** Creating a list and adding a part take the same advisory
  lock, `_lock_key(organization, command_id)` (`snapshots/service.py:206-212`).
- **Creating** looks up lists and parts by the id. A part found means
  409 `IDEMPOTENCY_CONFLICT`.
- **Adding** looks up parts by the id:
  - a part of another list: 409 `IDEMPOTENCY_CONFLICT`;
  - a different request: 409;
  - the same request: the part as it is now, 200, even if it was removed
    since.
- **The adding fingerprint** is sha256 of `{snapshot_id, kind, file_name,
  file}` or `{snapshot_id, kind, lines, source, counted_on}`.
- **A list's first part** takes the list's own `command_id` and request
  fingerprint.
- **Creating with `lines` keeps today's fingerprint exactly**
  (`service.py:546-552`), so a retry across the deploy still replays.

**The same file is not added twice to one list.** The content fingerprint is
sha256 of the canonical lines: no file name, no envelope, key order
ignored. A file whose content is already in a file part of the list that is
not removed is refused: 409 `SNAPSHOT_CONFLICT`, reason `PART_DUPLICATE`,
naming that part. A partial unique index enforces it.
- **Hand-typed parts and other lists are not checked.** The same pasted
  list may still go to two lists, as today.

**A file overlapping the list is reported.** A file whose `(photo,
photo_line)` pairs are already in another part of the list is accepted, and
the reply counts them, so the person can remove it at once.

**Room** (§10): a list over its lines, rows or parts refuses the part with
409 `SNAPSHOT_CONFLICT`, reason `LIST_FULL`, naming the limit and the
counts.

**Locks, in order:**
1. the command lock;
2. the list `FOR UPDATE`.

The ledger's warehouse lock is not taken: the list's hold already exists.
Approval takes the list first too, so an add after an approval finds the
list decided and is refused. Parsing runs off the event loop, as today.

**What it records:** `review_revision` + 1, and an audit entry
`snapshot.part_added`. Creating a list keeps `snapshot.imported`, which now
names its first part.

### 9. Removing a part

**The call.** `POST /snapshots/{id}/parts/{part_id}/remove`, no body.
- **Who.** The same rights as adding (§7, §12): any owner or manager who
  holds them, not only whoever added the file. No reason (owner).
- **Which part.** It is found by its id and its list. Another list's, or
  another organization's, part is 404.
- **Repeats.** A part already removed is returned as it is, 200, before the
  list's state is checked. A retry after approval therefore still answers.
- **The last part.** Removing the last part not removed is refused:
  409 `SNAPSHOT_CONFLICT`, reason `LAST_PART`. The list is rejected
  instead, which also releases its warehouse (owner).

**In one transaction, in this order:**
1. the part's allocations are deleted;
2. the part gets `removed_at` and `removed_by_user_id`;
3. each of its rows gets the new status **`REMOVED`**, and its answer is
   cleared: basis, note, who resolved and when;
4. its `RawInput`s are marked unresolved;
5. `review_revision` + 1;
6. one audit entry, `snapshot.part_removed`: the part and its line range,
   and before it the counts of lines, waiting, resolved, skipped,
   allocations and units.

**The rows stay as evidence,** with their `RawInput` and parse. Every earlier
answer is still in its `snapshot.line_resolved` audit entry.

**A removed line counts nowhere:**
- not in counts or `ready_to_approve`;
- not in pages, unless they ask for that part or for `REMOVED`;
- not in repeats or approval;
- not in `catalog_correction.waiting_lists`, because its allocations are
  gone.

A removed line cannot be answered: 409 `SNAPSHOT_CONFLICT`, reason
`PART_REMOVED`.

**Removal is final.** A removed file comes back only by being added again,
as a new part with new lines, answered anew (owner).

### 10. Limits, measured

| Constant | Today | Now |
|---|---|---|
| `MAX_PART_LINES` (was `MAX_LINES`) | 1 000 per import | 1 000 per part |
| `MAX_LINE_CHARS` | 500 | 500 |
| `MAX_PART_TEXT_CHARS` (was `MAX_LIST_CHARS`) | 100 000 per import | 100 000 of `text` per part |
| `MAX_PART_BYTES` | none | 950 000, a file part as compact UTF-8 JSON |
| `MAX_LIST_ALLOCATIONS` | 5 000 | **set by measurement**: the largest of 2 000, 5 000 and 10 000 that passes |
| `MAX_LIST_LINES` | 1 000 | `MAX_LIST_ALLOCATIONS // 2`, lines not removed |
| `MAX_LIST_ROWS` | none | `3 × MAX_LIST_LINES`, removed lines included; bounds `line_no` |
| `MAX_LIST_PARTS` | none | 1 000, removed parts included |
| `MAX_ALLOCATIONS` (per line) | 50 | 50 |

**Two answers per line.** Lines are capped at half the allocations. A line
naming several sizes takes one allocation per size, and a list whose last
lines cannot be answered can only be rejected. The summary shows both
headrooms («рядків 1 840 з 2 500 · відповідей 3 120 з 5 000»).

**The approval is the bound.** It writes the whole list in one transaction
under the warehouse's exclusive lock (ADR-0005 §4, §5). It makes about five
or six statements per allocation: two per stock key in `lock_stock`, two per
movement, and one per key to reconcile. The 5 000 that holds today was never
measured.

**The measurement.** A script approves lists of 2 000, 5 000 and 10 000
allocations, three runs each, on the local PostgreSQL test cluster. Each
allocation is its own stock key, the worst case. It counts statements, and
writes its evidence to `output/verification/<date>-json-import-approval/`.

**A size passes** when its slowest approval is at most 10 s and no
statement takes over 5 s. The client then waits 60 s (§16), six times that.
- `MAX_LIST_ALLOCATIONS` is the largest size that passes. Until it is run,
  the constant stays 5 000 and the lines 2 500.
- **If 2 000 fails,** today's limit is already too high. The work stops,
  and the opening path is batched in `inventory` under its own review
  before any limit is set.
- **Never in parts, never in the background.** The approval is never split
  into transactions: it applies all or nothing. It is never made a
  background job: that is new infrastructure (constitution §14).

**A hard ceiling.** `validate_lot_references` binds one parameter per lot,
and asyncpg allows 32 767. A cap above about 30 000 needs `= ANY(array)`.

**What a list became is read by pages.** The approval's reply and
`GET /snapshots/{id}` carry `application.units` and `application.allocations`,
not one entry per allocation. `GET /snapshots/{id}/application` pages the
lines. The app reads only the units.

### 11. The body and the edge

**The edge.** Caddy refuses a body over `1MB`. go-humanize reads that as
1 000 000 bytes, not 1 048 576.

**The arithmetic.**
- **A file part** is at most 950 000 bytes as compact UTF-8 JSON without
  its nulls. The server measures this on the model's canonical encoding.
- **The phone sends that encoding,** nulls removed. Its key order may
  differ, but not its length.
- **The rest of the body** is at most about 2 500 bytes: the command, the
  stores, the list's name and date, the file's name.
- **The phone refuses** a body over 990 000 bytes before sending:
  «Файл завеликий — розділіть його на два».

A unit test pins `MAX_PART_BYTES` + the largest envelope < 990 000 < 1 000 000.

**Real files are small:** about 0.15–0.3 MB per 1 000 lines.

**The CI edge check** sends 999 000 bytes and expects the API's own 4xx,
and sends 1 000 001 bytes and expects 413. A 502 there would be read as an
outage (`api.ts`, `unreachable()`).

**ADR-0010 §2's "under 0.4 MB" now reads:** the largest legitimate body, one
part of an opening stock list, is under 0.96 MB.

### 12. Who may do what

| Action | Permission (in the store acted through, §7) | Warehouse access |
|---|---|---|
| Create a list, from lines or a file | `snapshot:import` | `can_receive` and the private-warehouse rule |
| Add a part | `snapshot:import` | as above |
| Remove a part | `snapshot:import` | as above |
| Answer a line | `snapshot:import` | as above |
| Approve | `snapshot:approve` | as above |
| Read, reject | either | the list's own store: reach. Another store: `can_receive` |

**No new permission.** Managers and owners hold `snapshot:import`; sellers
hold neither.

**Prices.** A notebook's price may be a purchase price. It is seen only by
those who see lists, the owner and managers, who already hold
`report:view_financial`.

**Names.** Who added and who removed a file are shown by name. The API
resolves them through `identity.service.display_names`, as
`api/v1/damaged.py` does, so `snapshots` gains no import of `identity`.

### 13. The API

**`POST /snapshots`.** Exactly one of `lines` or `file`, plus `file_name`
(1..200) with a file. The reply as today, and:
- `summary.parts`, `summary.parts_removed`;
- `summary.limits {lines, allocations}`;
- `store_name`.

**`POST /snapshots/{id}/parts`**, with `command_id` and:
- `file` and `file_name`; or
- `lines`, with an optional `source` and `counted_on`.

It answers `{snapshot, part}`: 201 for a new part, 200 for a replay.

**`POST /snapshots/{id}/parts/{part_id}/remove`.** `{}`, answered with
`{snapshot, part}`.

**`GET /snapshots/{id}/parts`.** Every part, each with:
- its number, kind, file name, source, date, price kind, parser and version;
- its lines and their range;
- who added and removed it, by id and name, and when;
- its progress: waiting, needing attention, resolved, skipped;
- `photo_lines_elsewhere`.

**`GET /snapshots/{id}/application?offset&limit`** pages what the list
became.

**`GET /snapshots/{id}/lines`** gains `part_id`. Without `status` it leaves
out `REMOVED`, unless `part_id` names a removed part. Its offset and the
`line_no` path go up to `MAX_LIST_ROWS`. A line gains:
- `part_id`, `part_no`;
- `photo_name`, `photo_line`;
- `reading`, `price_kind`;
- `file_reasons`;
- `shown_split [{size, count, size_id}]`, where `size_id` is null when the
  catalogue lacks the size;
- `same_photo_lines`.

**Every route on a list** takes an optional `store_id`, the store acted
through (§7).

**`GET /snapshots`** gains `location_id`.

**New `SNAPSHOT_CONFLICT` reasons:** `PART_DUPLICATE`, `LIST_FULL`,
`LAST_PART`, `PART_REMOVED`. One code with a reason, as that error's
docstring prescribes.

**A file's 422** keeps FastAPI's shape. Under `file`:
- every refusal carries a stable `type` and its line (`ctx.line`);
- the `input` echo is dropped, so a bad file is not sent back.

### 14. The database's guarantees

Migration `0037_stock_list_parts`.

**Parts are frozen with their list.** `inventory_snapshot_part_is_final()`:
- refuses any change to a part of an applied or rejected list, read under a
  share lock as in `0015`;
- refuses every delete;
- refuses every update but setting `removed_at` and `removed_by_user_id`
  once, from NULL.

Its user links are `ON DELETE RESTRICT`.

**A row's evidence never changes,** and a removed row never changes at all.
`inventory_snapshot_row_is_fixed()`, before insert or update:
- refuses a row into a removed part;
- refuses a change to the evidence: part, line number, raw input, photo,
  reading, file reasons, shown split, stated total and state;
- refuses any change to a `REMOVED` row;
- lets a row become `REMOVED` only when its part is removed and no
  allocation of it remains.

**A removed line takes no allocation.**
`inventory_snapshot_allocation_row_is_live()`, before insert or update,
refuses an allocation on a `REMOVED` row or a removed part's row. That
covers approval's link to its lot.

**A removed part is removed whole.** A deferred constraint trigger checks, at
commit, that every row of a removed part is `REMOVED` and none keeps an
allocation.

**A row's part is in its own list.** A composite foreign key ties the row's
list and part to the part's list and id.

**One file twice is refused.** A partial unique index on the list and content
fingerprint, for file parts not removed.

**The service filters too.** Approval, the summary and what the list became
also filter on the part's `removed_at`. A missed filter cannot add stock: the
triggers above stand behind it.

**`0015`'s function is left as it is.** Its else-branch reads
`snapshot_row_id`, so it cannot guard the new table.

**New enum values are compared as text in 0037.** `snapshot_row_status`
gains `REMOVED`, and `snapshot_quantity_basis` gains `STATED_BY_SIZE`.
Neither value can be used before 0037 commits, so no constraint or index in
0037 names them, and triggers compare `::text`.

### 15. The screens

**«Новий список».** «Вставити текст» or «Завантажити файл».
- **The file picker** has no `accept` filter: Android pickers grey out a
  JSON reported as `application/octet-stream`.
- **The phone reads the bytes strictly.** It decodes with a strict UTF-8
  decoder; `file.text()` would silently turn bad bytes into U+FFFD. Then a
  small scanner refuses duplicate keys and non-integer numbers for integer
  keys. Then it checks the format, version, lines and size.
- **A summary before sending**: lines, photos, the price kind, and «Файл
  піде до списку складу «…»».
- **The list's name** is prefilled from the file's `source`, and can be
  changed.
- **A warehouse whose list waits** is named with that list and an
  «Відкрити» button. No second list is offered.
- **A kept draft** holds the `command_id`, warehouse, name, date, the file's
  name and its sha256, never its content. Picking the same file again after
  a lost answer resends the same command.

**The list.**
- **A «Файли списку» section**, one entry per part:
  - its name, «рядки 1001–1874», «розібрано X з Y»;
  - «Додано: <ім’я>, <дата>», or, muted, «Прибрано: <ім’я>, <дата>»;
  - the overlap warning.
- **«Показати рядки»** filters by file.
- **«Прибрати файл»** asks first: «Прибрати файл «…»? Його N рядків не
  увійдуть до затвердження, а M відповідей на них зникнуть; рядки буде
  видно як прибрані. Інші файли лишаться.».
- **«Додати файл»** and «Додати рядки вручну». «Додати файл» keeps its
  `command_id` per list and file.
- **The approval** shows the files and each basis, `STATED_BY_SIZE`
  included.

**A 422** is mapped to «Рядок N файлу: …» by its `type`.

**What a person sees is guarded.** Every string from a file, and every line
of any list, is shown through `visible()`. It replaces bidirectional
controls (U+202A–202E, U+2066–2069, U+200E, U+200F, U+061C), invisible ones
(U+200B–200D, U+2060, U+FEFF) and CR, LF and TAB with visible marks such as
`⟦U+202E⟧`. `.catalog-raw` gets `unicode-bidi: isolate`. Nothing stored
changes.

### 16. A slow call is not an outage

Adding a file, or approving a large list, can take longer than `api()`'s
20 s.

**The fix.** Two calls declare themselves slow — adding a part or creating a
list from a file, and approving — and wait 60 s. If that time runs out, the
phone throws `SlowAnswer`, not `Unreachable`, and does not mark the server
down. The screen says «Сервер ще не відповів. Оновіть список і перевірте,
чи це збережено; повторити безпечно.». Both calls are idempotent.

**A real outage still counts.** A fetch that fails outright still marks the
server down.

**ADR-0013 §4.2 is amended:** a slow call's own timeout is not an outage.

### 17. Compatibility and going back

**Upgrade.**
- **Locks.** It locks the three snapshot tables `ACCESS EXCLUSIVE`, as
  `0015` does.
- **Refusals, by name.** It refuses a list with no rows, a list whose line
  numbers are not `1..n`, or more than 1 000 rows. None can exist; such a
  list needs a person.
- **One `PASTED` part per list:**
  - its command id and fingerprint are the list's; the fingerprint may be
    NULL, for a list restored by a downgrade;
  - its lines and range come from the rows;
  - added by the list's creator, at its creation.
- **The backfill update.** Rows of decided lists are frozen by `0015`'s
  `inventory_snapshot_row_is_final`. The one `UPDATE … SET part_id` runs
  between `DISABLE TRIGGER` and `ENABLE TRIGGER`. That is transactional:
  no other session sees the trigger off. The migration then asserts the
  trigger is enabled again (`tgenabled = 'O'`), as `0006` does.
- **When.** Run it in a maintenance window, like `0015`.

**Downgrade.**
- **Locks** the snapshot tables, the new one included, first.
- **Refuses** what `0036` cannot hold:
  - a file part;
  - a list with more than one part;
  - a removed part or a `REMOVED` row;
  - a row with a photo, a reading or a shown split;
  - an answer on `STATED_BY_SIZE`.
- **Otherwise drops** what 0037 added. The enum values stay, as `0031`'s
  downgrade leaves its own. A list of one pasted part, decided or not, goes
  down and comes back with the same fingerprints.

**The API.**
- **Unchanged.** `POST /snapshots` with `lines`.
- **No longer in the reply:** `application.lines` on the approval and on
  `GET /snapshots/{id}`. The app never read them; a script reads the new
  page.
- **New and widened:**
  - `REMOVED` and `STATED_BY_SIZE` are new enum values; old clients never
    ask for either;
  - the list of a store's lists now holds other stores' lists at
    warehouses it may receive into.

### 18. Modules

**Contracts do not change.**
- `snapshots` still reaches `catalog` (raw lines, `spell_size`, a new
  sizes-by-spelling read), `inventory`, `authz` and `tenancy` only.
- The API layer adds `identity.service.display_names`.

**Repeats are counted in SQL.** `catalog.raw_lines.repeated_lines` takes the
list's lines as a subquery, rather than binding every line of the list on
every page.

## Rejected

- **Each file a list of its own.** A warehouse is opened once (ADR-0005
  §5): two lists can never both be approved, and the owner said several
  files fill one list.
- **Appending lines with no part.** A file could not be removed as one, and
  the history could not say what it brought.
- **Hard-deleting a removed file's rows.** Their `RawInput`s stay anyway,
  and the history would lose its link to them.
- **Keeping a removed file's answers.** The owner said they go with the
  file. Kept allocations would also keep blocking merges.
- **The file's count as the line's count when the text has the number.**
  The owner chose otherwise: a number without «шт» is a hint.
- **A split confirmed from the parser's counts alone.** The text must show
  each size with its count (§5). The parser's precision is unknown, and no
  real file exists yet.
- **Refusing the same content across lists, or the same pasted text.** That
  is a rule the owner did not make, and it would break the four tests that
  prove a warehouse opens once.
- **Taking the ledger's warehouse lock to add a part.** At a warehouse with
  history, every sale there would wait on the parse.
- **Sending the file's text and parsing it on the server.** Sending one
  validated object keeps the byte bound exact, and the phone's scanner and
  the reference validator catch what JSON parsing hides.
- **Multipart upload keeping the file's bytes.** The server needs only
  validated lines. Keeping bytes adds a store and backup weight, and the
  parser's file is not the original anyway: the photo is.
- **The warehouse in the file.** A person choosing it in the app is the
  check.
- **The bot receiving the file.** The owner said the file is uploaded in the
  app. This stays the fallback if the phone's file picker fails its drill.
- **An approval in parts, or in the background.** See §10.
- **A probe of `/ready` before a slow call.** It adds a request and still
  cannot tell a slow answer from no answer. A declared slow call is simpler.

## Consequences

- **The owner's way in exists,** and every line still answers to a person.
  A line leads back to its photo, and a wrong notebook leaves the list with
  nothing in the stock.
- **The evidence is a transcription.** Birka cannot check it against the
  photo; only someone holding the photo can.
- **Tables of numbers mean notes.** A line whose count has no «шт» needs a
  note. Notebooks kept as tables may have many such lines (owner); the
  review is slower for it, and no count is assumed.
- **A warehouse larger than the cap cannot be taken in at all.** One list
  opens a warehouse, once (Q1), and the cap is what the approval can do in
  one transaction. The owner does not yet know how many lines the largest
  warehouse holds.
- **The warehouse waits for the whole review,** possibly days. The shared
  warehouse sells on paper meanwhile, and those sales are typed after the
  approval (owner).
- **Two lists at one warehouse remain possible** if two people start them
  at the same moment from two stores. Only one can be approved. The other
  is rejected, and its lines are answered again in the first, by adding its
  file there.
- **A line is about 2–3 KB of evidence.** A list at 5 000 lines is about
  15 MB.
- **The Telegram file picker is unproven on a phone.** iOS opens Files;
  Android depends on Telegram's WebView; a file received in a chat must
  first be saved to the phone. A release drill tries both, and Telegram
  Desktop works meanwhile.
- **The display guard is new to every list.** Raw text was shown unguarded
  since «Початкові залишки» was built; now it is not. The catalogue screens
  still show raw text, and are left for a change of their own.
