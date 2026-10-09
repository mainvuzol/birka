# ADR-0014: Opening stock from a JSON file

Status: Accepted (2026-10-08). Built on `feat/json-stock-import`; see the
[report](../project-memory/json-stock-import-report.md). Amended the same day
with what the build found (§1, §4, §5, §7, §10, §13). Amended on 2026-10-09:
- the lines raised to as many as the answers, 5 000 (§10);
- the owner's two changed readings (§5, §7, §12, §13, Consequences);
- what the review of the built change found (§1, §2, §5–§8, §10–§17,
  Consequences; the report's "Review of the built change"), in two
  rounds. Six readings of how it is carried out, R-a to R-f, were
  confirmed as built by the owner on 2026-10-09 (business rules).
Owner decisions: business-rules.md, "the shops' existing stock" (2026-10-08),
with the answers to the design's questions the same day, and the readings of
"how it is carried out" answered on 2026-10-09; "going live" (2026-10-01);
"the first days" (2026-10-02).
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
| `$schema` | string 1..2 000 | optional, ignored: editors add it |
| `format` | `"birka.stock-list"` | required |
| `version` | `1` | required, written as an integer (`true` and `1.0` are refused); another version is refused by name |
| `source` | string 1..300 | optional: which notebook, as people call it |
| `counted_on` | string 1..40 | optional, free text, like a list's date today |
| `price_kind` | `"sale"` or `"purchase"` | optional: the kind of every price in the file (owner: one notebook, one kind). Left out when nobody knows: the prices are then shown without a kind (reading R-d, confirmed as built by the owner on 2026-10-09) |
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
| `size_counts` | array of 1..10 `{size, count}` | optional: each size as written with its own count (1..10 000). One size with its count counts too («Лоран M-3»; owner, 2026-10-08). Never beside `sizes` |
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
- **No string holds a control character,** C0 or C1 (U+0000–U+001F,
  U+007F–U+009F), **nor a line or paragraph separator** (U+2028, U+2029).
  That includes a line break inside `text`, which would show one written
  line as two, U+0085, the next-line character, which some screens break at
  and others drop (`"Лоран\u0085M-1"` read as «ЛоранM-1»), and the two
  separators, which Unicode's line breaking and `str.splitlines` break at
  (review, 2026-10-09). This is a rule of a machine's output, not of a
  shop's text, so the reasoning of `core/text.py` does not apply. Lone
  surrogates are refused, as everywhere. The file's name, sent beside the
  file, is held to the same rule (`stock_file.has_control`).
- **Pairs and sizes are unique.** `(photo, photo_line)` appears once per
  file. A `size_counts` names each size once, ignoring case.
- **A file is bounded.** At most 100 000 characters of `text` in all, and
  at most 950 000 bytes as compact UTF-8 JSON without its nulls (§11).
- **New needs make a new `version`,** never a silent extension.

**Guidance, not checked.** A photo's lines are not split across files: a
notebook is one file, or one file per group of whole photos. Birka takes a
file that splits one; the description says it as advice to the parser's
author.

**The warehouse is not in the file.** A person chooses it in the app, as
today. A file put into the wrong warehouse's list is removed (§9).

**The pydantic model `StockFileV1` is the format.** Parser authors get one
package, [`formats/birka-stock-list/`](../../formats/birka-stock-list/):
- a description in English, with Ukrainian examples;
- a JSON Schema generated from the model;
- an example file;
- a reference validator, `backend/scripts/check_stock_file.py`, that reads a
  file through the model and checks what the schema cannot express (the
  rules above, duplicate keys, integer literals, the byte bound).

A test (`tests/unit/test_stock_file_package.py`) keeps the schema byte for
byte equal to the model's, the example valid and each of its lines what the
description says, and the validator in agreement with the server.

### 2. A list is filled by parts

**A part** is one file or one hand-typed text: the unit that is added,
shown and removed. That a hand-typed part is removed as a file is, with the
answers on its lines, is Birka's reading: the owner decided it for files
(reading R-c, confirmed as built by the owner on 2026-10-09). A part keeps:
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
- **Several options.** A line whose file lists several sizes or colours
  (two or more `sizes`, `colours` or `size_counts`), or whose text Birka
  reads as several, is `UNKNOWN_DISTRIBUTION`. Its total is kept if there is
  one: the `Лоран S M L 3 шт` rule. A single size with its count whose text
  does not show it so gets `FILE_SPLIT_NOT_IN_TEXT` and keeps Birka's own
  reading.
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
   - not preceded by a letter or digit, nor by a Ukrainian word's
     apostrophe. A word is a run of letters and digits, joined by an
     apostrophe `'` `’` `ʼ` only as a Ukrainian word is: a Cyrillic letter
     before it and «я», «ю», «є» or «ї» after it. So the «м» of «м'ята» or
     «м’ятний» is no word of its own, while «M-3'L», «L'S» and «XL’XXL»
     each write a size of their own (review, fourth round, 2026-10-09; in
     the third round an apostrophe joined any two words, which hid those
     sizes). A letter there is a letter or a digit, but not a modifier
     letter that writes a sign, though Unicode counts it a letter (`Lm`):
     U+02B9 to U+02C1 (primes, apostrophes, half rings, glottal stops),
     U+02C6 to U+02D1 (accents, lines, colons), U+02EC and U+02EE. Such a
     sign joins nothing, as `'` joins nothing, so with the modifier letter
     apostrophe `ʼ` (U+02BC) «Лоран M-3ʼL», «Лоран M-3 LʼS», «Лоран M-3
     XLʼXXL», «Лоран S-1 M-2 LʼL» and «Лоран M-3 СʼЛ» each write a size
     beside the split and go to a note, while «Лоран мʼята M-3» keeps its
     tap, `ʼ` joining a Ukrainian word as `'` does (review, after the fourth
     round, 2026-10-09; before it, those five showed their split). One
     form gains its tap: a sign letter before the size, «Лоран ʼM-3», reads
     as «Лоран 'M-3» always has;
   - followed by optional whitespace;
   - then exactly one sign from `-‐‑‒–—―−:=`: spaces alone are not a sign;
   - then optional whitespace, and a run of digits, whose value is the
     count, that **ends there** (review, 2026-10-09; fourth round, the same
     day). Whitespace is any character `str.isspace` names: a space, a
     no-break space, a thin space. What may follow the count is named, and
     anything else before a numeral makes it part of something more. A
     format character, which prints nothing (`Cf`: a zero-width space, a
     soft hyphen, a byte order mark), is passed over wherever it stands; a
     combining mark or a variation selector (`Mn`, `Mc`, `Me`) wherever a
     numeral is looked for. After the count may come:
     - the text's end;
     - after whitespace, another numeral: a number of its own, which 6
       must account for («M-3 1850»);
     - a letter, as a word's letter is (so no sign letter above):
       another word («M-3 L-1»), but `x` or a letter that looks like it,
       before a numeral, is a product: the Cyrillic `х`, the Greek `χ`
       (U+03C7), the Cyrillic `ҳ` `ӽ` `ӿ` (U+04B3, U+04FD, U+04FF), in
       either case, in any width or form (`ｘ`, `ˣ`), and with a mark on it
       or not (`ẋ`, or `x` and a combining accent) (review, after the
       fourth round, 2026-10-09: «M-3Χ2» with the Greek capital, «M-3ҳ2»,
       and «M-3x2» with an accent on the `x`, each with a price "2", had
       shown M:3);
     - `,` `;` `.` `)` with no numeral right after it: a list goes on
       («S-1, M-2», «S-1; M-2», «46-2; 48-1», «L-1, 1850»). With one, the
       count is part of something more, **read strictly**: «M-3,5» and
       «M-3.5» are fractions, and «46-2;48-1», «M-3;2» and «M-3)2», which
       may be a list written without a space, go to a note as well. The
       conservative side, kept on purpose (review, after the fourth round,
       2026-10-09): a parser that keeps the notebook's space after `;`
       keeps the tap;
     - `(` `[` `{` `«` or a currency sign: something else begins («M-3
       (1850)», «M-3 ₴1850»);
     - any other sign with no numeral after it.

     A mark where the count's end is read, on its last digit or after
     whitespace, ends it with something unknown: «Лоран M-3» with a
     combining accent on the 3 goes to a note, with nothing after it too
     (after the fourth round).

     A numeral of any script counts as a digit there (`str.isnumeric`:
     «½», «²», «①», «Ⅲ»), and one right after the count continues it.
     «M-3+2», «M-3 + 2», «M-3,5», «M-3.5», «M-3/2», «M-3х2», «M-3X2»,
     «M-3 Х 2», «M-3✕2», «M-3·2» and «M-3½» hold no count of M; nor, since
     the rule names what may end a count rather than what continues it,
     do «M-3＋2», «M-3ｘ2», «M-3∗2», «M-3÷2», «M-3⁄2», «M-3~2», «M-3 – 2»
     with no-break spaces, «M-3，5», «M-3٫5», or «M-3x2» with a zero-width
     space in it (review, fourth round, 2026-10-09).

     **The forms that go to a note since the fourth round**, a tap before
     it, each with the number after it as the price where it is one:
     - `;` or `)` with a numeral right after it: «46-2;48-1», «M-3;2»,
       «M-3)2»;
     - any sign the rule does not name, then a numeral, spaced or not:
       «Лоран M-3 @1850», «Лоран M-3 #1850», «Лоран M-3 №1850», and
       likewise `%` `&` `!` `?` `'` `"` `_` `\` `^` `` ` `` `|` `<` `>`
       `°` `§`, the closing brackets `]` `}`, every quote but `«` (`»`
       `’` `”` `“` `„` and their kind), the dashes and tildes outside the
       signs of a size, the arrows and every other symbol (a probe of
       every sign, mark and format character up to U+2FFFF after the
       count, the third round's rule against the fourth's: about 10 800
       changed, none the other way);
     - a format character or a combining mark between the count and a
       numeral, or a superscript or subscript `x` (`ˣ`, `ₓ`) before one.

     And **since the review after the fourth round** (2026-10-09), each
     with a price "2" where a number follows:
     - a sign letter (above) after the count, before a numeral («M-3ʼ2»
       with U+02BC), or between two words, each then a size («Лоран
       M-3ʼL», «Лоран M-3 LʼS», «Лоран M-3 XLʼXXL», «Лоран S-1 M-2 LʼL»,
       «Лоран M-3 СʼЛ»);
     - a look-alike of `x` before a numeral: «M-3Χ2», «M-3χ2», «M-3Ҳ2»,
       «M-3ҳ2», «M-3Ӽ2», «M-3ӽ2», «M-3Ӿ2», «M-3ẋ2», «M-3x2» with a
       combining accent or a variation selector on the `x`;
     - a mark on the count's last digit, or between the count and what
       follows it: «Лоран M-3» with a combining accent on the 3, the same
       before «x2», and «M-3,5» with an accent after the comma.

     «Лоран M-3 (1850)», «Лоран M-3 ₴1850», «S-1, M-2», «S-1; M-2»,
     «46-2; 48-1» and «Лоран M-3. 1850» keep their tap (pinned).

   And the size stands in the text as a whole word **exactly once**, with a
   count or without, in any of its spellings (ADR-0009): «M-3 M 2» and
   «M-3 (M)» write M twice, and so do «M-3 М» with a Cyrillic М and
   «XXL-1 2XL». So `462` is never «46, 2», and `M 3` is never «M, 3».
3. **The places do not overlap.**
4. **The totals agree.** If the file gives `count`, it equals the sum. If
   Birka read a count with its unit, it is exactly one, equals the sum, and
   is unsure of nothing.
5. **One colour, no slash.** The line names at most one colour, in the file
   and in Birka's reading, and Birka found no slash options, nor flagged a
   lone «/» for review. A slash is contextual (constitution §21).
6. **Nothing beside it** (review, 2026-10-09). The text shows the split and
   nothing that could be more of it:
   - **no other size.** Birka's own parse of the text, spelled with
     `spell_size`, reads no size outside the split: «Лоран S M-3» names S
     without a count. Nor is any other word a letter size by Birka's own
     spelling (`spell_size`, `letter_rank`), whether the parser reads it or
     not: the parser reads XS to XXL only, so «Лоран S-1 M-2 XXXL», «M-3
     XXS», «M-3 4XL» and «M-3 ХL» with a Cyrillic Х name a size it does not
     see. The Cyrillic «с» is the preposition, never S, when lowercase, as
     `parser.parse_catalog_line` reads it («куртка с капюшоном M-3»,
     «куртка с поясом M-3» show their split); a capital «С» is it only
     where it begins a phrase Birka's parse reads («Куртка С капюшоном
     M-3», «С лисой», «С норкой» show theirs). Anywhere else a capital «С»
     is S, though the parser takes one with any word after it for the
     preposition: «M-3 С», «Лоран С M-3», «Лоран M-3 С 1850», «Лоран M-3 С
     без кількості» and «Куртка С поясом M-3» show none, and «Лоран S-1
     M-2 С 1850» writes S twice (review, fourth round, 2026-10-09; read as
     the parser reads it in the third round, a «С» before a price had
     hidden a size). A «с» or «С» joined to a count by a sign is a size
     with its count («С-3»);
   - **no other record.** Every size with a count in the text is one of
     the pairs. A record is a word Birka's parser reads as a size on its
     own, or a run of digits, joined by one sign to a run of digits,
     overlapping ones included: «Лоран S-1 M-2 L-4» with pairs for S and M,
     «Лоран M-3 L-5» with M, and «M-3-2», which holds «3-2», show none;
   - **no other number.** Every other run of numerals in the text, of any
     script («３», «½», «①», «Ⅲ»), is the file's `price` as its digits are
     written («1850» for `"1850"` or `"1850 грн"`), once; or part of a count
     with its unit Birka read («3 шт», which must equal the sum, as in 4); or
     a length Birka read («110 см»). «S-1 M-2 L-1 разом 5» and «46-2 48»
     show no split: the 5 may be another count, and the 48 a size whose
     count is lost. Nor does a price the file leaves out, or one the text
     writes with a gap or a point («1 850», «1850.50»): such a line is
     answered with a note, the conservative side.

   **What this does not see** (review, 2026-10-09). A size only the
   organization's catalogue knows, not a letter size («OS», «єдиний»); a
   number written as a word («і ще два») or in Latin letters («III»); a
   lowercase «с» written for the size S, which the parser reads as the
   preposition wherever it stands («Лоран M-3 с» shows the split of M);
   and **a number the file calls the price**. The price is the
   parser's reading, and the rule excuses one number on that word alone:
   «46-2 48» with a `price` of `"48"`, or «S-1 M-2 L-1 разом 5» with `"5"`,
   shows its split. Excusing the price only where the text marks it («грн»,
   «₴», «ціна») would close it at the cost of taps on lines such as «Лоран
   S-1 M-2 L-1 1850»; that is the owner's to weigh, a reading awaiting the
   owner (business rules, R-f). The risk register names all four.

When it holds, the row keeps `shown_split`. With two or more sizes it is
`UNKNOWN_DISTRIBUTION` with the sum as its total; with one size it stays as
Birka read it, so `STATED` is never offered on the file's word. When it does
not, the file's counts are a hint, with reason `FILE_SPLIT_NOT_IN_TEXT`, and
the line is answered as any split is: with a note. No line of the published
example changed its outcome under 2 and 6.

**A size range written with a sign** (`42-44`) can pass this check if the
parser misreads it as size 42 with a count of 44. **The app asks** (owner,
2026-10-09: "if such cases occur, the app asks the person what the record
means, and the person chooses"). A pair of a shown split **may be a range**
when any one of these holds:
- **its numbers make it one** (review, 2026-10-09): the size and the count
  as the text writes it are both digits, the count has at least as many
  digits as the size, and it is larger («42-44», «42-58», «98-104»),
  whatever the catalogue holds. «46-2», «48-12» and «M-3» are not;
- **its count is a size.** In the organization's catalogue, under one
  spelling (ADR-0009: `spell_size`, ignoring case), its count as the text
  writes it is itself a size («M-3» with a size «3»);
- **its record is a size.** The size, the sign and the count as the text
  writes them («42-44», «42 – 44») are themselves a size of the catalogue.

The catalogue's part is read at every look, never kept, as the catalogue
decides the pair's `size_id`: a size created after the import makes a pair
ambiguous from then on.
- **The editor asks first,** per such pair: «Запис «42-44» — це:», with
  «Розмір 42 — 44 шт» and «Діапазон розмірів 42–44», the record as written.
  Only once every such pair is read as a size with its count is
  `STATED_BY_SIZE` offered, never preselected. Read as a range, it is not
  offered: the person answers with another basis and a note, as for any
  line. The answer names the records the person answered so
  (`split_read_records`), never one the line flags but nobody answered: a
  line read again while the editor is open (the phone comes back to the
  app, the connection returns) asks about a record made a possible range
  meanwhile, and the tap waits for that answer (review, fourth round,
  2026-10-09).
- **The server checks again at the answer.** `STATED_BY_SIZE` on a line
  with such a pair needs `split_read_as: "SIZE_WITH_COUNT"` with
  `split_read_records`, the records the editor asked about, each as the
  line's `shown_split` writes it (`written`), or by its `size` when
  `written` is null, a record the text no longer shows (review, third
  round, 2026-10-09). Every pair that may be a range **as the answer arrives**
  must be among them; otherwise the answer is refused (422
  `VALIDATION_ERROR`, reason `SPLIT_MAY_BE_RANGE`, naming the records that
  are not), as every refusal of a basis is, and nothing is kept. The editor
  then reads the line again and asks about the records named, so the person
  answers them in place and sends again. So a size
  created between the editor's look and the answer, which makes another
  record a possible range, is never credited to a person who was not asked
  about it: «Парка 42-44 46-2», asked about «42-44», is refused once a size
  «2» makes «46-2» a range too, and kept when asked again about both. A
  record named that is not one of the line's split is refused too (reason
  `SPLIT_RECORD_UNKNOWN`). `split_read_as` and `split_read_records` go
  together, each record once, with `STATED_BY_SIZE` only. The line keeps
  them (part of the answer, not of the evidence): exactly the records
  named, in the line's order, so the same answer sent again in another
  order is the same answer. The answer's audit entry keeps them, with the
  records that could be read otherwise as it arrived
  (`split_may_be_range`). A choice of a range is never sent: the line is
  answered with another basis and a note.
- **And again at the approval, record by record** (review, 2026-10-09). A
  size created after the answer can make a record a possible range. The
  person's word covers the records it was said of: the line keeps them
  beside `split_read_as` (`split_read_records`: the records the answer
  named, as the text writes them; NULL exactly when `split_read_as` is). The
  approval reads every line answered `STATED_BY_SIZE`, of parts not removed,
  against the catalogue as it is then; a line with a pair that may be a
  range and is not among the records its word was said of stops it: 409
  `SNAPSHOT_CONFLICT`, reason `SPLIT_MAY_BE_RANGE`, with `count` and the
  first 50 `line_nos`, as for a line still open. «Куртка 42-44 46-2»,
  answered for «42-44», is asked again once a size «2» makes «46-2» a range
  too. The line is answered again, with the choice or another basis, and the
  approval sent with the new `review_revision`. The rows and their texts are
  read in one statement.
- **Not asked about:** a record of a letter size («M-3»), or of a number
  size whose count is written with fewer digits or is not larger («46-2»,
  «48-12»), while neither its count nor the record is a size of the
  catalogue. The risk register names it.

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
- «Ціна з зошита: 1200 (продажна | закупівельна)», or «Ціна з зошита:
  1200» when the file gives no kind (reading R-d, confirmed as built by the owner on 2026-10-09);
- the file reasons in words, such as `FILE_COUNT_HINT`: «Парсер прочитав
  кількість, але в рядку вона не написана зі «шт» — це лише підказка.
  Вкажіть кількість і звідки вона відома.» (worded so since the review,
  2026-10-09);
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

**While the list's own store does not trade,** blocked or archived, the
list is **only rejected**, through the other store (owner, 2026-10-09: "the
other store's manager, or the owner, may reject it, which releases the
warehouse; its files then go into a new list started from the other store.
It still cannot be approved while its own store does not trade").
- **A rejection** needs only the store acted through trading, with the
  reach above: through another store, `can_receive` and the person's
  permission there, either snapshot permission. The hold is released as for
  any rejection, and the audit names the store acted through
  (`via_store_id`). Through the list's own store, the scope refuses it,
  `STORE_NOT_TRADING`, as before.
- **Every other command** — approving, answering, adding or removing a
  file — still needs the list's own store trading, since the list acts in
  the ledger through it. Through the other store the refusal names it:
  409 `SNAPSHOT_CONFLICT`, reason `LIST_STORE_NOT_TRADING`, with that
  store and its state (before, a bare 404 "Unknown store").
- **The list says so.** The list's `store_state` is its own store's. The
  list page, seen through the other store, reads «Магазин «…», що почав цей
  список, не працює: список можна лише відхилити, а файли додати до нового
  списку.», offers no approval, no file and no answer, and offers
  «Відхилити список» to whoever may reject there, managers included.
  «Новий список» names such a waiting list and says to reject it first.
- **Its files go into a new list** started from the other store, their lines
  answered anew: nothing is carried over.

**While the list's own store may no longer receive goods there** (review,
2026-10-09), the same holds. The opening movements act through that store,
so every command but a rejection, through the other store, also needs the
list's own store to hold `can_receive` at the warehouse, the access row its
own commands are checked against. Without it: 409 `SNAPSHOT_CONFLICT`,
reason `LIST_STORE_CANNOT_RECEIVE`, with that store's `store_id` and the
`location_id`, after the check of trading (`LIST_STORE_NOT_TRADING` comes
first). Through the list's own store, its access row refuses the command as
before (403 `LOCATION_ACCESS_DENIED`). Rejection is unaffected. The list
carries no flag for it: the page learns it from the refusal, and says
«Магазин «…», що почав цей список, більше не може приймати товар на цей
склад: список можна лише відхилити.» This is how it is carried out, not an
owner's decision: it keeps reading 8's ground, that the list acts in the
ledger through its own store.

**A paused warehouse's list is seen from its own store only.** `can_receive`
through another store also needs the warehouse open, so while it is paused
the other store neither sees the list nor acts on it. Its own store still
reads it and may reject it, under reach (ADR-0005 §9), and nothing else:
adding, removing, answering and approving need `can_receive`, which needs
the warehouse open. They pass again, from either store, once it reopens.
The owner confirmed reading 1 on a question that said the list could be
changed there; it was put again as built, and confirmed (reading R-a,
owner, 2026-10-09).

**What does not change.**
- The list's `acting_store_id` is still the store that created it. Lines
  added through another store name that store on their `RawInput`, and the
  audit entries of adding, removing, answering, approving and rejecting
  name the store acted through (`via_store_id`; answering since the review,
  2026-10-09).
- The opening movements' acting store is still `acting_store_id`, as
  ADR-0005 §4 writes them.
- A command still needs that store trading, a rejection apart (above).

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
  lock, `_lock_key(organization, command_id)` (`snapshots.service._lock_key`).
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
  (`snapshots.rules.lines_import_request`), so a retry across the deploy
  still replays.

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
counts. An answer over the list's allocations is refused at the answer
(§10).

**Locks, in order:**
1. the command lock;
2. the list `FOR UPDATE`.

The ledger's warehouse lock is not taken: the list's hold already exists.
Approval takes the list first too, so an add after an approval finds the
list decided and is refused. Parsing runs off the event loop, as today.

**Creating a list parses before the warehouse is held** (review,
2026-10-09). The first part's lines are parsed and kept while nobody else
can see the list, and only then is the hold taken, under the warehouse's
exclusive lock (`inventory.hold_for_opening_list`). Before, M1-023's order
held that lock over the parse of up to a thousand lines, the order refused
above for adding a part. A stock command at the warehouse still lands
wholly before the hold, and the approval finds its history, or wholly
after it, and is refused.

**What it records:** `review_revision` + 1, and an audit entry
`snapshot.part_added`. Creating a list keeps `snapshot.imported`, which now
names its first part.

### 9. Removing a part

**The call.** `POST /snapshots/{id}/parts/{part_id}/remove`, with no body
or `{}`.
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
| `MAX_LIST_ALLOCATIONS` | 5 000 | **5 000, measured**: the largest of 2 000, 5 000 and 10 000 that passes |
| `MAX_LIST_LINES` | 1 000 | 5 000: `MAX_LIST_ALLOCATIONS`, lines not removed |
| `MAX_LIST_ROWS` | none | 10 000: `2 × MAX_LIST_LINES`, removed lines included; bounds `line_no` (reading R-b, confirmed as built by the owner on 2026-10-09) |
| `MAX_LIST_PARTS` | none | 1 000, removed parts included |
| `MAX_ALLOCATIONS` (per line) | 50 | 50 |

**As many lines as answers.** The owner heard the limit as 5 000 lines of
one size each (2026-10-08), and the measurement approved exactly that, so
on 2026-10-09 the lines were raised from half the allocations, 2 500, to
the allocations, and the rows from 7 500 to 10 000. A line naming several
sizes takes one allocation per size, so a list full of such lines can run
out of answers before its last line is answered, and then can only be
rejected or lose a file. The shops' count counts each size of such a line,
and the list shows both headrooms: «Місце у списку: рядків 1 840 з 5 000 ·
відповідей 3 120 з 5 000».

**An answer with no room** is refused as every refusal of an answer is, 422
`VALIDATION_ERROR`, and named as a full list is: reason `LIST_FULL`, `what`
`allocations`, `limit`, `now` (the answers on the other lines) and `adding`
(this answer's). The editor says «У списку вже 5 000 відповідей — більше він
не вміщує, тож цю відповідь не збережено. Рядок із кількома розмірами бере
відповідь на кожен розмір. Звільнити місце можна, прибравши файл.» (review,
2026-10-09; before, the generic text of a 422).

**The rows' bound counts removed files.** A list takes at most 10 000 lines
over its whole life, the lines of removed files included, twice the 5 000
that count. It stops a file removed and added again without end. A list
that runs out of that room takes no more parts: to add more, it is rejected
and a new one started. That is Birka's reading, not yet the owner's
(reading R-b).

**The approval is the bound.** It writes the whole list in one transaction
under the warehouse's exclusive lock (ADR-0005 §4, §5). It makes about five
or six statements per allocation: two per stock key in `lock_stock`, two per
movement, and one per key to reconcile. The 5 000 that held before was never
measured; it is now (below).

**The measurement.** A script approves lists of 2 000, 5 000 and 10 000
allocations, three runs each, on the local PostgreSQL test cluster. Each
allocation is its own stock key, the worst case. It counts statements, and
writes its evidence to `output/verification/<date>-json-import-approval/`.

**A size passes** when its slowest approval is at most 10 s and no
statement takes over 5 s. The client then waits 60 s (§16), six times that.
- `MAX_LIST_ALLOCATIONS` is the largest size that passes.
- **If 2 000 fails,** today's limit is already too high. The work stops,
  and the opening path is batched in `inventory` under its own review
  before any limit is set.
- **Never in parts, never in the background.** The approval is never split
  into transactions: it applies all or nothing. It is never made a
  background job: that is new infrastructure (constitution §14).

**Measured on 2026-10-08**
([evidence](../../output/verification/2026-10-08-json-import-approval/README.md)),
on the local PostgreSQL 16.2 cluster (Apple M5, `fsync` on), through the app
in process, each allocation its own stock key:

| Answers | Approvals, 3 runs | Statements | Slowest statement | Verdict |
|---|---|---|---|---|
| 2 000 | 2.76 s, 2.70 s, 2.68 s | 14 042 | 0.073 s | passes |
| 5 000 | 7.07 s, 7.62 s, 7.63 s | 35 045 | 0.150 s | passes |
| 10 000 | refused: HTTP 500 after 7.30 s | — | 0.090 s | fails |

- **`MAX_LIST_ALLOCATIONS` stays 5 000**, and so does `MAX_LIST_LINES`;
  `MAX_LIST_ROWS` is 10 000 and `MAX_LIST_PARTS` 1 000. A unit test pins
  them. The pages were read at 6 000 rows; the rows' bound beyond that only
  stops files removed and added again without end.
- **10 000 cannot be approved at any speed.** The ledger reads every
  allocation's reservation in one statement
  (`inventory.repository.reserved_quantities`, a row-value `IN` of one
  `(location, variant, size)` per key). PostgreSQL refuses it as too
  complex, "stack depth limit exceeded" (`max_stack_depth` 2048kB): on the
  same cluster it works at 6 523 keys and fails at 6 562. 5 000 is about
  23 % under that ceiling. Raising the cap needs that read batched, or
  `= ANY(array)`, in `inventory` first, under its own review.
- **Everything else passes with room.** Adding a 1 000-line file to a full
  list takes 0.25–0.33 s and removing it about 0.05 s; every page reads in
  at most 0.118 s; the approval's reply is 1 108 bytes at every size.
- **Measured again on 2026-10-09,** with every answer `STATED_BY_SIZE`,
  which the approval reads again since the review (§5;
  [evidence](../../output/verification/2026-10-09-json-import-approval-by-size/README.md)):
  approvals 8.55, 8.16 and 7.79 s, 35 049 statements, the slowest 0.157 s,
  the second reading itself 0.14–0.19 s. The method above, the same hour
  on a busier laptop, took 7.78, 6.94 and 9.50 s. Both pass, with less room
  than the first run showed.
- **And again in the review's third round** (2026-10-09, same evidence).
  The second reading's text read had depended on the planner's
  statistics: with those a test suite leaves, it read the organization's
  index for every row, 1.39–1.63 s at 5 000 lines. `text_of` now finds a
  line by its primary key alone and checks the organization in a form no
  index serves; with the same statistics, in the same session, the read
  takes 0.007–0.008 s, the first read of the second run 0.091 s (EXPLAIN
  6.7 ms against 1 395 ms). The approval by
  size, three runs on a fresh database: 7.21, 8.48 and 7.59 s, 35 049
  statements, the slowest 0.157 s, the second reading 0.11–0.19 s; the
  method above, the same hour: 8.00, 9.87 and 7.30 s. Both pass; 9.87 s is
  the closest to the 10 s rule yet, the laptop's spread.
- **PostgreSQL 16 here, 17 on the server,** on hardware not yet chosen. The
  ceiling may sit elsewhere on 17, and the timings differ; the 60 s the
  client waits (§16) is six times the slowest approval measured.

**The owner kept 5 000** (2026-10-08, after hearing the measurement). The
limit stays at 5 000 answers per list in this change. The shops first count
the notebooks of their largest warehouse roughly (pages × lines per page);
if it comes out above 5 000, the limit is raised by a separate change to the
ledger (the approval and its reading of the reservations), before going
live. The count counts each size of a line that names several, since each
takes an answer.

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
- **The phone refuses the file** when it reads it, above 950 000 bytes
  measured as the server measures it, compact and without its nulls and
  `$schema`: «Файл завеликий — розділіть його на два.» Before the review
  (2026-10-09) it measured the file against the request's 990 000, so a
  file between the two was sent and refused by the server.
- **The phone refuses a body** over 990 000 bytes before sending, with the
  same words. A file within 950 000 bytes and its envelope stay under it,
  so this is a guard, no longer reached from the screen.

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

Every command but a rejection also needs the list's own store trading
(owner, 2026-10-09) and, through another store, still holding
`can_receive` at the warehouse (review, 2026-10-09); a rejection needs only
the store acted through trading (§7).

**On the screen** (review, 2026-10-09): whoever may add and remove the
list's files may also reject it, so the list whose last file is wrong is
rejected where it is looked at, with the button the hint names. «Затвердити
список» shows only to whoever may approve, while the list's own store
trades.

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
- `shown_split [{size, count, size_id, written, may_be_range}]`, where
  `size_id` is null when the catalogue lacks the size, `written` is the
  record as the text writes it, and `may_be_range` says the person is asked
  first (§5), read against the catalogue as it is now;
- `split_read_as`, `"SIZE_WITH_COUNT"` or null: what the answer said of
  its records (§5);
- `same_photo_lines`.

**`PUT /snapshots/{id}/lines/{line_no}`** gains `split_read_as`
(`"SIZE_WITH_COUNT"`) and `split_read_records` (the records the editor
asked about, as `shown_split` writes them, `written`, or by `size` when
`written` is null: 1 to 10, each once, each 1 to 500 characters), together and with `STATED_BY_SIZE` only. A line with a
pair that may be a range as the answer arrives needs them, that pair among
the records (`SPLIT_MAY_BE_RANGE`, naming the pairs missing; a record that
is not the line's, `SPLIT_RECORD_UNKNOWN`; §5; review, third round,
2026-10-09). An answer the list has no room for is a 422 with reason
`LIST_FULL` (§10). A re-answer that differs only in `split_read_as` or in
the records it names is a new answer: `review_revision` + 1; the same
records in another order are the same answer.

**`POST /snapshots/{id}/approve`** is also refused, 409
`SNAPSHOT_CONFLICT`, reason `SPLIT_MAY_BE_RANGE`, with `count` and the first
50 `line_nos`, when a line answered by size may now be a range and was not
said to be a size with its count (§5).

**A list** gains `store_state`, its own store's: `ACTIVE`, `BLOCKED` or
`ARCHIVED` (§7).

**Every route on a list** takes an optional `store_id`, the store acted
through (§7).

**`GET /snapshots`** gains `location_id`.

**New `SNAPSHOT_CONFLICT` reasons:** `PART_DUPLICATE`, `LIST_FULL`,
`LAST_PART`, `PART_REMOVED`, `LIST_STORE_NOT_TRADING` and
`LIST_STORE_CANNOT_RECEIVE` (§7), and `SPLIT_MAY_BE_RANGE` at an approval
(§5). One code with a reason, as that error's docstring prescribes.

**A file's 422** keeps FastAPI's shape. Under `file`, every refusal carries
a stable `type`; inside `lines` it also carries its line, 1-based, as
`ctx.line`, pydantic's own refusals included. A file over the byte bound
(`stock_file_too_large`, `ctx {limit, bytes}`) and a refusal of a top-level
key name no line.

**No 422 of a list's request echoes it** (review, 2026-10-09). On every
route under `/api/v1/snapshots`, every refusal loses its `input` echo and
its `url`, wherever it stands: in the file, in the body around it (a file
without `file_name`, a file and `lines` together, a file with `source`), or
the body itself when it is not an object. A notebook's lines may name
customers (ADR-0010), and a refused file of up to a megabyte is not sent
back. Before, only refusals under `file` lost them, and a file refused for
the body around it came back whole. What a refusal names to be found is
kept, cut short: a key the format does not know, in `loc`, and a value in
`ctx` (a repeated size), by their first 60 characters and «…» (`MAX_NAMED`;
review, 2026-10-09). A key of 300 000 characters is not sent back whole;
a short one is named as the file writes it, as the person needs it to fix
the file. The phone cuts what it prints the same way.

**A 422 lists at most 50 refusals,** on every route, and
`detail_truncated` counts the rest (review, 2026-10-09): a small body of
many unknown keys answered with megabytes before. The phone adds that count
to its «…і ще k».

Reading a file's text (`load_stock_file_text`, for the reference validator
and the tests) adds `stock_file_duplicate_key` (`ctx.key`),
`stock_file_not_finite` (`NaN`, `Infinity`; `ctx.constant`) and
`json_invalid`. A lone surrogate is pydantic's `string_unicode`.

**`GET /snapshots/{id}/application`** on a list not applied answers an empty
page.

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

**What a person said of a split goes with an answer by size.** The row's
`split_read_as` (review, 2026-10-09) is part of the answer, not of the
evidence, and changes with it. CHECK `split_read_only_by_size` holds it
null, or `SIZE_WITH_COUNT` with the basis `STATED_BY_SIZE` (compared as
text, as below). Removing a part clears it with the rest of the answer.

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
  small scanner refuses duplicate keys, non-integer numbers for integer
  keys, and, anywhere in the file, a number too large to be one («1e400»,
  «-1e999», four hundred digits), which `JSON.parse` reads as Infinity and
  the phone would send as nothing (review, 2026-10-09): «Рядок 1 файлу: у
  «model» записано 1e400 — завелике число, застосунок його не прочитає.»
  Then it checks the format, version, lines and the file's size (§11).
- **A summary before sending**: «Файл «…»: рядків N, фото M, ціни
  закупівельні. Піде до списку складу «…».»
- **The list's name** is prefilled from the file's `source`, and can be
  changed.
- **A warehouse whose list waits** is named with that list, «На складі «…»
  уже чекає список «…» (веде магазин «…»). Другий список для нього не
  створюють — додайте файл до наявного.», and a «Відкрити список» button.
  No second list is offered.
- **A kept draft** holds the `command_id`, warehouse, the file's name and
  its sha256, and the list's name and date only as the person typed them,
  never anything of the file's content: a name or a date the file filled in
  is left out, and filled in again when the file is picked again (review,
  2026-10-09). Picking the same file again after a lost answer resends the
  same command; so does picking any file while the last send is unsettled
  (§16).

**The list.**
- **A «Файли списку» section**, one entry per part:
  - its name, «Рядки 1001–1874 · розібрано X з Y»;
  - «Додано: <ім’я>, <дата>», or, muted, «Прибрано: <ім’я>, <дата>»;
  - the overlap warning, «Рядків цього файлу, що вже є в інших файлах
    списку (те саме фото й рядок): N. Якщо файл додано помилково, приберіть
    його.»
- **«Показати рядки»** filters by file.
- **«Прибрати файл»** asks first: «Прибрати файл «…»? Рядки цього файлу (N)
  не увійдуть до затвердження, а відповіді на них (M) зникнуть; рядки буде
  видно як прибрані. Інші файли лишаться.» Lines typed by hand are removed
  as typed lines, never called a file (review, 2026-10-09): «Прибрати
  рядки» asks «Прибрати рядки, внесені вручну? Ці рядки (N) не увійдуть до
  затвердження, а відповіді на них (M) зникнуть; їх буде видно як
  прибрані. Інші файли лишаться.», and, when they are the list's last
  part, «Це останні рядки списку. Якщо вони помилкові — відхиліть список:
  склад звільниться.»
- **What the person is asked to do** with a waiting list follows what they
  may do (review, 2026-10-09): «Затвердіть або відхиліть його.» to whoever
  may approve; «Затверджує той, хто має право затверджувати списки;
  відхилити його можна й вам.» to a manager who may add files but not
  approve; «Відхиліть його, щоб склад звільнився.» when the list's store
  does not trade; and nothing to someone who may do neither.
- **«Додати файл»** and «Додати рядки вручну». «Додати файл» keeps its
  `command_id` per list and file until the server answers it. If the kept
  command names a part removed since its answer was lost, the server
  replays that part, removed, and the phone sends the file once more as a
  new command: a removed file comes back only as a new one (review,
  2026-10-09).
- **«Додати рядки вручну»** keeps its text and command until the server has
  them. Sent again after a lost answer with the text changed meanwhile, the
  same command is a different request (409 `IDEMPOTENCY_CONFLICT`): the
  phone keeps the text, takes a new command, reads the list again and says
  «Рядки, надіслані перед цим, уже є в списку, а ці відрізняються від них.
  Натисніть «Додати рядки» ще раз — ці буде додано як нові, окремо від
  тих.» (review, 2026-10-09; before, it stayed refused for good).
- **The approval** shows the files and each basis, `STATED_BY_SIZE`
  included. Its panel shows to whoever may approve or add files (§12).
- **The room**: «Місце у списку: рядків 1 840 з 5 000 · відповідей 3 120 з
  5 000», numbers grouped as Ukrainian writes them.

**A refusal is said in words.**
- **A 422** is mapped to «Рядок N файлу: …» by its `type`, in the
  validator's words: «Рядок 5 файлу: поле «фото» відсутнє.», «…поле «розмір»
  задовге.», «Рядок 3 файлу: невідоме поле «colour».», «Файл має бути
  об’єктом.» At most ten, then «…і ще k», counting what the server did not
  list (§13).
- **409 `LIST_STORE_CANNOT_RECEIVE`**, adding or removing a file, answering
  a line or approving: «Магазин «…», що почав цей список, більше не може
  приймати товар на цей склад: список можна лише відхилити.»
- **409 `SPLIT_MAY_BE_RANGE` at the approval**: «Рядки 1, 2 і ще 1 треба
  розібрати ще раз: запис у них тепер може бути діапазоном розмірів.»
  («Рядок 1 … у ньому …» for one).
- **422 `LIST_FULL` at an answer**: the text of §10.
- **A line's repeats** agree with their number: «— 2 рази», «— 5 разів».

**What a person sees is guarded.** Every string from a file, every line of
any list, and the names and reasons people gave beside them («Додано:»,
«Прибрано:», a store's name, a rejection's reason) are shown through
`visible()`. It replaces, by Unicode's own classes (review, 2026-10-09):
- every control character (`Cc`): CR, LF and TAB, and U+0080–U+009F;
- the line and paragraph separators (`Zl`, `Zp`: U+2028, U+2029);
- every default-ignorable code point: the zero-width ones (U+200B–200D,
  U+2060, U+FEFF), the soft hyphen, the variation selectors, the tag
  characters and the rest;
- every bidirectional control (U+202A–202E, U+2066–2069, U+200E, U+200F,
  U+061C);

with visible marks such as `⟦U+202E⟧`. Two are left where they are a part
of an emoji, since there they neither hide nor reorder anything: a
variation selector right after a pictograph or inside a keycap («❤️»,
«1️⃣»), and the zero-width joiner between two pictographs («👨‍👩‍👧»). A
name such as «Оля ❤️» reads as written; after a letter or a bare digit
they are still marked («M-1⟦U+FE0F⟧»). `.catalog-raw` gets `unicode-bidi:
isolate`. Nothing stored changes.

**A long word breaks.** On the list overview and the list page
(`.openings`), a line, a notice, a hint, a paragraph, an alert, a status
and the heading break anywhere (`overflow-wrap: anywhere`), so a file's long
name, a list's date or a rejection's reason never pushes a 375 px phone's
page sideways (review, 2026-10-09). Other screens keep their own wrapping.

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

**A slow answer starts no second list** (review, 2026-10-09). The server may
have made the list while the phone stopped waiting. So after a slow answer,
none at all, or a gateway's own 502, 503 or 504, «Новий список» marks its
draft unsettled, and the draft keeps its `command_id` whatever file is then
picked. It stays unsettled until a send settles the command: one answered
with the list, or refused as the same command sent before in another form
(`IDEMPOTENCY_CONFLICT`). That refusal settles it whatever became of the
list: the server holds the command, under the lock the import takes, so no
send of it, however slow, makes another list, whether that list still
waits, was rejected or approved, or is at another warehouse. Any other
answer to a later send, a refusal of its form included, says nothing of the
slow send before it, and leaves the draft unsettled (review, third round,
2026-10-09; before it, any answer settled the draft). In the third round
the conflict settled it only when the warehouse, read again, still held a
waiting list of the command; a draft whose list was then rejected or
approved, or was made at another warehouse, was left with no way to start
a new list, even after a reload (fourth round, the same day). A list a
draft's command made, opened from the overview, ends the draft, as
«Відкрити список» does in the form: nothing of it is sent again. «Почати як новий список» is not offered while the draft is
unsettled, only after an answered refusal of a settled one, and pressing it
reads the warehouse again before «Зберегти список» can send the new command
(review, 2026-10-09): the list a slow send makes may land after the phone
read the warehouse, and a new command then would start a second list beside
it; a list that waits there, this command's or another's, is named
instead. The waiting lists of the warehouse are read again after a slow answer, after a
resend refused as another request, when a file is picked while unsettled,
and when a new list is started; «Зберегти список» waits while they are read.
If a list made by this command waits there, the form says «Список «…» уже
збережено, хоч відповідь сервера й не дійшла вчасно. Відкрийте його — інші
файли чи рядки додайте вже до нього.», offers «Відкрити список», and hides
«Зберегти список». If none waits yet, saving again sends the same command,
which the server answers with the list once made. Before, another file
picked after a slow answer took a new command, and could start a second list
at the warehouse.

**Proven with a browser clock.** Three journeys hold the server's answer
and move the page's clock past 20 s and 60 s (`openings-file.spec.ts`: "a
slow answer is no outage…", "an answer too slow to wait for, its list made
meanwhile…", and "…its list made only after…", which since the review's
third round also sends again, is refused for its form, and still offers no
new list). A fourth loses the server's answers on their way back, against
the server itself ("a send refused as the same command in another form
settles the draft: whatever became of the list it made…"; fourth round): a
gateway's 504 after the list is made leaves the draft unsettled; the list
is rejected meanwhile; a corrected file is refused as the same command,
which settles the draft and offers a new list, started with a new command;
and a list whose answer never came, opened from the overview, ends its
draft. It replaces the third round's journey, whose server answers were
faked. None is a phone on a slow network.

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
  - a row keeping what a person said of its split (`split_read_as`);
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
  one transaction: 5 000 lines and 5 000 answers. Above about 6 500 answers
  the ledger's own reservation read fails (§10). So the shops count their
  largest warehouse first, and above 5 000 the limit is raised by a change
  to the ledger before going live (owner, 2026-10-08).
- **The warehouse waits for the whole review,** possibly days. The shared
  warehouse sells on paper meanwhile, and those sales are typed after the
  approval (owner).
- **Two lists at one warehouse remain possible** if two people start them
  at the same moment from two stores. Only one can be approved. The other
  is rejected, and its lines are answered again in the first, by adding its
  file there.
- **A shared list whose own store stops trading is rejected, not approved**
  (owner, 2026-10-09). Through the other store it is rejected, which
  releases the warehouse, and its files are added again to a new list there,
  their lines answered anew. It is approved only once its store trades
  again. If the warehouse is paused too, the other store does not reach the
  list, and it waits until one of the two changes.
- **A record that may be a range of sizes costs a question** (owner,
  2026-10-09). «42-44», «42-58» and «98-104» are asked about before the tap
  whatever the catalogue holds, and «M-3» once the catalogue has a size
  «3»; a size created after the answer stops the approval until the line
  is answered again for each record the person's word did not cover. A record of a number size with a smaller count
  («46-2») is asked about only when the catalogue makes it a range.
- **A tap needs a line that shows its split and nothing else** (review,
  2026-10-09). A line with another size (a letter size the parser does not
  read included), another size with a count, or a number of any script
  Birka cannot account for («разом 5», «½», a price the file leaves out) is
  answered with a note. More lines need a note than before. One thing is
  still taken on the parser's word: the number it calls the price (§5;
  reading R-f, confirmed as built by the owner on 2026-10-09).
- **A line is about 2–3 KB of evidence.** A list at its 5 000 lines is
  about 10–15 MB, and up to about 30 MB with its 10 000 rows, removed files
  included.
- **The Telegram file picker is unproven on a phone.** iOS opens Files;
  Android depends on Telegram's WebView; a file received in a chat must
  first be saved to the phone. A release drill tries both (release
  checklist, row 26). Telegram Desktop is expected to work but has not been
  tried; the drill tries it too.
- **A shared list whose own store may no longer receive there** is only
  rejected too (review, 2026-10-09), and the page learns it from the
  refusal, not from the list: it shows the reason, but still offers the
  other commands until one is tried.
- **The display guard is new to every list.** Raw text was shown unguarded
  since «Початкові залишки» was built; now it is not. The catalogue screens
  still show raw text, and are left for a change of their own (since
  2026-10-10 every screen marks text from outside: ADR-0018). Since the
  review the guard marks by Unicode's classes, but for an emoji's own
  selector and joiner, so a person's name with an emoji reads as written.
