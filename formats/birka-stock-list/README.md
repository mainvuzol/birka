# Birka's stock list file — `birka.stock-list`, version 1

For whoever writes the parser that reads the shops' notebook photos. It is
all you need; you do not need to read the rest of Birka.

| File | What it is |
|---|---|
| this description | every key, and every rule a schema cannot say |
| [`birka-stock-list-v1.schema.json`](birka-stock-list-v1.schema.json) | the JSON Schema (draft 2020-12), generated from Birka's own model; never edited by hand |
| [`example-v1.json`](example-v1.json) | a file of eleven notebook lines, one of each kind below |
| [`check_stock_file.py`](../../backend/scripts/check_stock_file.py) | the reference validator: Birka's own reading of a file |

The decision behind the format is
[ADR-0014](../../.ai/decisions/ADR-0014-opening-stock-from-a-json-file.md);
the owner's rules are in
[business-rules.md](../../.ai/project-memory/business-rules.md), "the shops'
existing stock" (2026-10-08).

## 1. What the file is for

The shops keep their stock in notebooks and tables. They photograph them; a
parser reads the photos into this file; the owner or a manager uploads the
file in the app, in «Початкові залишки», into the list of a warehouse they
choose. Several files may fill one warehouse's list.

**Nothing in the file becomes stock by itself.** Every line is reviewed by a
person, who looks at the line, the photo when needed, and the goods, and
picks the model, the size and the count. The owner then approves the whole
list, and only then is it the warehouse's opening stock.

So the file is a **transcription with hints**:
- `text` is the evidence: the written line, exactly as written;
- everything else on a line is the parser's reading, shown beside the text
  to help the person, never taken on its own word;
- the photos stay at the shop. Birka keeps no photo, only its name and the
  line's number on it, so a person can find the original again.

The warehouse is not in the file: a person chooses it in the app.

## 2. Encoding

- **UTF-8,** with or without a BOM. Any other encoding (Windows-1251, UTF-16)
  is refused.
- **JSON** ([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)). Spaces and
  line breaks between values are free: pretty-print it or not.
- **Characters raw or escaped,** alike: `"Лоран"` and `"\u041b\u043e\u0440\u0430\u043d"` are the same.
- **No control character in any string,** C0 or C1: U+0000–U+001F and
  U+007F–U+009F, written raw or escaped, **nor a line or paragraph
  separator,** U+2028 or U+2029. So no `\n`, no `\t`, no U+0085 (the
  next-line character) and no U+2028 inside `text`: one written line is one
  JSON line, never two.
- **No lone surrogate** (`"\ud800"` alone).

## 3. The file

One JSON object:

| Key | Type | Required | What it holds |
|---|---|---|---|
| `$schema` | string, 1..2 000 | no | ignored; editors add it |
| `format` | `"birka.stock-list"` | **yes** | always this |
| `version` | `1` | **yes** | always `1`; another version is refused by name |
| `source` | string, 1..300 | no | which notebook, as people at the shop call it: `"Зошит 1, куртки"`. The app offers it as the list's name |
| `counted_on` | string, 1..40 | no | when it was counted, free text: `"осінь 2025"` |
| `price_kind` | `"sale"` or `"purchase"` | no | the kind of every price in the file. One notebook holds one kind of price (owner, 2026-10-08), so it is given once, for the whole file. Leave it out when nobody knows; the price is then shown without its kind (Birka's reading, awaiting the owner's confirmation) |
| `parser` | string, 1..100 | no | which parser, and which version of it, wrote the file: `"photo-reader 0.3"` |
| `lines` | array of 1..1 000 lines | **yes** | every written line, in reading order |

## 4. A line

| Key | Type | Required | What it holds |
|---|---|---|---|
| `text` | string, 1..500, not blank | **yes** | the written line, **exactly as written**: its count, its price and «шт» as they stand. `"Лоран шоколад M 3 шт 1850"` |
| `photo` | string, 1..200 | **yes** | the photo's file name, exactly as the shop keeps it: `"IMG_0412.jpg"` |
| `photo_line` | integer, 1..10 000 | **yes** | the line's number on that photo, from the top, starting at 1 |
| `model` | string, 1..200 | no | the model as read: `"Лоран"` |
| `colours` | array of 1..10 strings, each 1..60 | no | each colour as written: `["бежева", "персик"]` for «Лама бежева/персик» |
| `sizes` | array of 1..10 strings, each 1..20 | no | each size as written, when **no** count is written per size: `["S", "M", "L"]` for «Парка хакі S M L 3 шт» |
| `size_counts` | array of 1..10 `{"size", "count"}` | no | each size as written **with its own count**: `[{"size": "S", "count": 1}, {"size": "M", "count": 2}, {"size": "L", "count": 1}]` for «S-1 M-2 L-1»; `[{"size": "M", "count": 3}]` for «Лоран M-3». `size` is 1..20 characters, `count` an integer 1..10 000. Never beside `sizes` |
| `count` | integer, 1..10 000 | no | the line's written total, one integer: `3` for «3 шт». «3+2» is no count: leave it out, and `text` keeps «3+2» |
| `price` | string, 1..40 | no | the price **as written**, never converted: `"1850"`, `"1 850 грн"` |
| `note` | string, 1..200 | no | the parser's word to the person who reviews: `"закреслено"`, `"нерозбірливо: колір"`, `"заголовок"`, `"підсумок сторінки"` |

An optional key is either absent or `null`. Both mean "not read".

## 5. Rules a schema cannot say

The schema checks types, lengths and required keys. These rules it cannot
express; Birka refuses a file that breaks any of them, and so does the
reference validator (§9), naming the line.

1. **`(photo, photo_line)` appears once in a file.** Several goods written on
   one line are one JSON line. (`stock_file_photo_line_repeated`)
2. **`sizes` or `size_counts`, never both** on one line.
   (`stock_file_sizes_and_size_counts`)
3. **`size_counts` names each size once,** ignoring case: `M` and `m` are one
   size. (`stock_file_size_repeated`)
4. **No control characters,** C0 or C1, nor line or paragraph separators
   (U+2028, U+2029), in any string (§2), so no line break inside `text`.
   (`stock_file_control_character`)
5. **`text` is not blank:** spaces alone are not a line.
   (`stock_file_text_blank`)
6. **No key written twice** in one object. Most JSON readers silently keep
   the last; Birka refuses it. (`stock_file_duplicate_key`)
7. **Integers are written as integers.** `3`, never `3.0`, `"3"`, `3e0` or
   `true`. JSON Schema calls `3.0` an integer; Birka does not.
   `NaN` and `Infinity` are refused everywhere. (`int_type`,
   `stock_file_not_finite`)
8. **Nothing empty.** An optional key is absent or `null`, never `""` or
   `[]`. (`string_too_short`, `too_short`)
9. **No unknown keys,** at any level, except `$schema` at the top.
   (`extra_forbidden`)
10. **At most 100 000 characters of `text`** in the whole file, counted as
    Unicode characters. (`stock_file_text_too_long_in_all`, naming the line
    where the total passes the limit)
11. **At most 950 000 bytes written compactly:** the file as UTF-8 JSON with
    raw characters, no spaces, its `null`s and `$schema` left out. That is
    how the phone sends it, and the edge of the server takes no more than
    1 000 000 bytes. A file pretty-printed or escaped on disk may be larger;
    what counts is the compact form. Real files are about 0.15–0.3 MB per
    1 000 lines. (`stock_file_too_large`)

## 6. What to write

- **Every written line, in order.** Crossed out, illegible, a heading or a
  total included, each with a `note` saying what it is. The person decides
  what each line is («Це не товар», with a reason); nothing is skipped on
  the parser's word (owner, 2026-10-08).
- **`text` exactly as written,** with the count, the price and «шт» as they
  stand. Do not tidy it, do not add what is not there, and do not drop a
  number you could not place.
- **`photo_line` counts every written line** on the photo, from the top,
  headings and crossed-out lines included, so the number leads back to the
  line. On a spread or in columns, the left page or column first, the
  numbering continuing.
- **`count` only for a single written total.** «3 шт» gives `3`; «3+2» gives
  no `count`.
- **`size_counts` whenever the line writes a count per size,** each size
  exactly as written: «S-1 M-2 L-1», «Лоран M-3», «46-1 48-2». Birka decides
  from `text` whether the split is shown (§7); give what you read.
- **`price` whenever the line writes one,** exactly as written. A split is
  confirmed by a tap only when every other number in `text` is accounted
  for, and the price is one of them when its digits stand in the text as
  one number (§7).
- **`photo` exactly as the shop's file is named,** so the shop finds it.
- **One notebook, one file,** or one file per group of whole photos when a
  notebook is longer than 1 000 lines. Do not split a photo's lines across
  files. This is guidance: Birka does not check it.
- **One `price_kind` for the file,** from the notebook.

## 7. What Birka does with a line

**The count.** Birka reads `text` itself, and its own reading decides the
line's count. The file's reading only adds doubt.

- **The file's `count` is only a hint unless the text states it with its
  unit** («3 шт»). A number without «шт» is not a count by itself, even when
  the parser says it is: «Бомбер чорний M 3 1200» with `count: 3` is shown as
  «Парсер прочитав кількість: 3», and the person states the count with a
  note (owner, 2026-10-08). Notebooks kept as tables will have many such
  lines.
- **A count the text states and the file agrees with** is offered as stated.
  A file `count` that differs from the text's makes the line's count unknown
  until a person states it.
- **A line for which the file gives `count` or `size_counts`** is never
  taken as one piece in one tap («Рядок без кількості — одна штука»).

**A split the text shows is confirmed by a tap.** When the file gives
`size_counts` and the text writes each size joined to its count **by a
sign**, the person confirms the split with one tap, «Як у рядку, по
розмірах», without a note (owner, 2026-10-08). One size counts too
(«Лоран M-3»). The signs are `-`, the dashes `‐ ‑ ‒ – — ―`, the minus `−`,
`:` and `=`, with or without spaces around: «S-1», «S - 1», «S:1», «S=1».

- **A space alone is not a sign.** «M 3» is a size and a bare number, not a
  size with its count: the line is answered with a note.
- Each size must appear **once** in `text`, as a whole word, written as in
  `size_counts` (case aside), with its count or without, and in no other
  spelling of the same size: «Лоран M-3 M 2» and «Лоран M-3 (M)» write M
  twice, and so do «Лоран M-3 М» with a Cyrillic М and «XXL-1 2XL». That one
  place is followed by its sign and exactly its count: `462` is never «46,
  2». A word is a run of letters and digits; an apostrophe (`'`, `’`,
  `ʼ`) joins two only as in a Ukrainian word, a Cyrillic letter before it
  and «я», «ю», «є» or «ї» after it. So the «м» of «м'ята» or «м’ятний» is
  no size M, while «M-3'L», «L'S» or «XL’XXL» each write a size of their
  own.
- **The count ends with its number.** After the count may come only: the
  end of `text`; after a space, another number, which must then be the
  price (below); a letter, but `x` or `х` (in either case or width) before
  a digit, which is a product; `,` `;` `.` or `)` with no digit right after
  it, so a list goes on, while with one it is a fraction; `(` `[` `{` `«`
  or a currency sign, which begin something else («M-3 (1850)», «M-3
  ₴1850»); or any other sign with no digit after it. Any whitespace may
  stand about a sign, a no-break space included, and a character that
  prints nothing (a zero-width space, a soft hyphen) is passed over
  wherever it stands. So «M-3+2», «M-3 + 2», «M-3,5», «M-3.5», «M-3/2»,
  «M-3х2», «M-3X2», «M-3 Х 2», «M-3✕2», «M-3＋2», «M-3~2», «M-3 – 2»,
  «M-3，5» and «M-3 @1850» hold no count of M. A numeral of any script is a
  digit here: «M-3½», «M-3²». «S-1, M-2» and «L-1, 1850» list on.
- **The text shows the split and nothing beside it:**
  - no other size Birka reads in `text`: «Лоран S M-3» names S without a
    count; nor any other word that is a letter size as Birka spells sizes,
    though its parser reads only XS to XXL: «Лоран S-1 M-2 XXXL», «M-3
    XXS», «M-3 4XL», «M-3 ХL» with a Cyrillic Х. The Cyrillic «с» is a
    preposition, not S, when lowercase, as Birka's parser reads it
    («куртка с поясом M-3»); a capital «С» is one only where it begins a
    phrase Birka reads («Куртка С капюшоном M-3», «С лисой», «С
    норкой»). Anywhere else a capital «С» is S: «M-3 С», «Лоран С M-3»,
    «Лоран M-3 С 1850» and «Куртка С поясом M-3» show no split. One joined
    to its count by a sign is a size with its count («С-3»). A lowercase
    «с» written for S is not seen: «Лоран M-3 с» shows the split of M, so
    write such a line without `size_counts` if the «с» there is a size;
  - no other size, or number, joined to digits by a sign: «Лоран S-1 M-2
    L-4» with `size_counts` for S and M only, «Лоран M-3 L-5» with M only,
    «Лоран M-3-2»;
  - no other number, of any script («３», «½», «①»), except the file's
    `price` where its digits stand in the text as one number, once («1850»
    for `"1850"` or `"1850 грн"`), a count with «шт» that Birka reads («3
    шт», equal to the sum), and a length that Birka reads («110 см»). «S-1
    M-2 L-1 разом 5» and «46-2 48» show no split: 5 may be another count,
    and 48 a size whose count is lost. Nor does «Лоран M-3 1850» when the
    file gives no `price`, or a price written in the text with a gap or a
    point («1 850», «1850.50»).
  - **Write `price` only for a price.** Birka takes the number `price`
    names as the price, on your word: a number in `text` that is a total, a
    count or a size written into `price` makes a split look shown that is
    not («46-2 48» with `"price": "48"`). When you cannot tell, leave
    `price` out: the line then goes to a person with a note.
- The totals must agree: `count`, if given, equals the sum, and so does a
  «N шт» in the text.
- At most one colour, and no options with «/».
- The tap needs each size in the catalogue, under the same spelling
  («M», «46»). A size the catalogue lacks is created first, or the line is
  answered with a note.
- **A size range written with a sign makes the app ask.** «42-44» may be
  size 42 with 44 pieces, or the sizes 42 to 44: a parser that reads it as
  `{"size": "42", "count": 44}` passes every check above. So the app asks the
  person what the record means, and offers the tap only after «розмір 42 —
  44 шт» is chosen; a range is answered with a note (owner, 2026-10-09). It
  asks when the size and the count are both numbers and the count, as
  written, reads as a larger size after it («42-44», «42-58», «98-104»,
  whatever the catalogue holds), and when the count, or the whole record, is
  also a size in the shop's catalogue («M-3» with a size «3», a size
  «42-44»). The answer names the records the person was asked about: a
  size created while they answer makes another record a possible range,
  and that answer is refused and asked again. A size created after the
  answer brings the question back before the approval, for every record
  the person's answer did not cover. A record you read as a range is not a
  size with its count:
  keep it in `text`, never in `size_counts`.
- Otherwise the split is only a hint, and the person answers it with a note.

**The rest is shown, never used.**
- **The reading** is shown beside the text: «Прочитано: Лоран · бежевий ·
  S, M, L». The model seeds the person's search of the catalogue. Birka never
  picks a model.
- **The photo:** «Фото: IMG_0412.jpg, рядок 4».
- **The price** is shown with its kind, «Ціна з зошита: 1200 (закупівельна)».
  It never sets a model's price.
- **A `note`** is shown, and sends the line to a person's attention.

**The example, line by line** ([`example-v1.json`](example-v1.json)):

| `text` | What the file adds | What the person gets |
|---|---|---|
| «Куртки жіночі» | `note`: заголовок | the note; the person marks it «Це не товар» |
| «Лоран шоколад M 3 шт 1850» | `count` 3, `price` 1850 | count 3, stated by the text, offered as stated |
| «Бомбер чорний M 3 1200» | `count` 3 | the 3 as a hint only: no «шт». The count is stated with a note |
| «Лоран бежевий S-1 M-2 L-1» | `size_counts` S 1, M 2, L 1 | the split, confirmed by a tap: 4 in all |
| «Лоран M-3» | `size_counts` M 3 | one size with its count, confirmed by a tap |
| «Парка хакі S M L 3 шт 2400» | `sizes`, `count` 3 | 3 in all, the split across sizes unknown: the person gives it, with a note |
| «Пальто сіре 46 1 шт» | `note`: закреслено | the note; the person decides |
| «Тренч бежевий 44» | `sizes` 44, no count | no count: the person states it, with a note (44 may be a size or a count) |
| «Пуховик сірий 2 шт» | `note`: нерозбірливо: колір | count 2, and the note |
| «Бомбер M 2 L 1» | `size_counts` M 2, L 1 | no sign between size and count: the split is a hint, answered with a note |
| «Разом 15 шт» | `note`: підсумок сторінки | the note; the person marks it «Це не товар» |

**Files in one list.**
- **The same file twice in one list is refused,** whatever its name: the
  same lines, in the same order, are the same file.
- **A file whose photos and lines are already in another file of the list**
  is accepted, and the app says how many, so the person can remove it.
- A file put into the wrong list is removed by a person, with its lines and
  their answers, and may be added again as a new file.

**How large a warehouse may be.** A warehouse's list, all its files
together, holds at most **5 000 lines** and **5 000 answers** (a line naming
several sizes takes one answer per size). A warehouse with more cannot be
taken in yet: the shops count their largest warehouse first, and above
5 000 the limit is raised before going live (owner, 2026-10-08).

## 8. Limits

Lengths count Unicode characters.

| What | Limit |
|---|---|
| lines in a file | 1..1 000 |
| `text` | 1..500 characters a line; 100 000 characters in the file |
| the file, compact UTF-8 (§5, rule 11) | 950 000 bytes |
| `photo` | 1..200 characters |
| `photo_line` | 1..10 000 |
| `model` | 1..200 characters |
| `colours`, `sizes`, `size_counts` | 1..10 items |
| a colour | 1..60 characters |
| a size | 1..20 characters |
| `count`, and a `count` in `size_counts` | 1..10 000 |
| `price` | 1..40 characters |
| `note` | 1..200 characters |
| `source` | 1..300 characters |
| `counted_on` | 1..40 characters |
| `parser` | 1..100 characters |
| `$schema` | 1..2 000 characters |
| a warehouse's list, all files together | 5 000 lines, 5 000 answers |

## 9. Checking a file

From `backend/` of the Birka repository, with its requirements installed:

```
python -m scripts.check_stock_file FILE.json [FILE.json ...]
python -m scripts.check_stock_file --schema
```

It reads each file as Birka does, through Birka's own model, and adds the
checks JSON parsing would hide (bytes that are not UTF-8, a key written
twice, `3.0`). It prints, in Ukrainian, as the app words it:

```
OK: зошит-1.json: 11 рядків, 2 фото
зошит-2.json: рядок 3: stock_file_photo_line_repeated: те саме фото й рядок, що в рядку 1
зошит-3.json: рядок 4: missing: поле «фото» відсутнє
зошит-4.json: файл: stock_file_too_large: файл завеликий (961 204 байти, можна не більше 950 000) — розділіть його на два
```

Exit 0 when every file is valid, 1 when any is not, 2 when called wrongly.
`--schema` prints the published schema.

**Without the repository,** any JSON Schema validator (draft 2020-12) checks
a file against the schema: types, lengths, required and unknown keys. It
does not check §5's rules 1–6, 10 and 11, nor that `3.0` is not an integer;
Birka and the reference validator do.

**What each refusal means.** Each problem names its line (1-based) when it
stands inside `lines`, and its `type`, which never changes:

| `type` | Meaning |
|---|---|
| `not_utf8` | the bytes are not UTF-8 |
| `json_invalid` | not JSON, or broken |
| `stock_file_duplicate_key` | a key written twice in one object |
| `stock_file_not_finite` | `NaN` or `Infinity` |
| `stock_file_text_blank` | `text` is spaces alone |
| `stock_file_control_character` | a control character, C0 or C1, or U+2028 or U+2029, in a string |
| `stock_file_photo_line_repeated` | this photo and line are already another line of the file |
| `stock_file_sizes_and_size_counts` | a line gives `sizes` and `size_counts` |
| `stock_file_size_repeated` | `size_counts` names a size twice |
| `stock_file_text_too_long_in_all` | over 100 000 characters of `text` in the file |
| `stock_file_too_large` | over 950 000 bytes written compactly |
| `missing` | a required key is absent |
| `extra_forbidden` | an unknown key |
| `int_type` | not an integer (`3.0`, `"3"`, `true`) |
| `string_type` | not a string |
| `string_unicode` | a lone surrogate |
| `literal_error` | another `format` or `version`, or a `price_kind` other than `sale` or `purchase` |
| `string_too_short`, `too_short` | `""` or `[]` |
| `string_too_long`, `too_long` | over a length or count limit (§8) |
| `greater_than_equal`, `less_than_equal` | a number outside its limits (§8) |

## 10. Versions

Birka reads version 1 only. Unknown keys are refused, so a key cannot be
added quietly: whatever version 1 cannot hold becomes version 2, described
here first.
