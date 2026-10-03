# ADR-0009: One size, one spelling

Status: Accepted (2026-10-03)
Owner decisions: business-rules.md, "one size, one spelling" (2026-10-03),
with the answer asked the same day.
Amends: the M1B decision that a size code is stored verbatim
(m1b-completion-report.md), and ADR-0005 §3 only in where `UNKNOWN` is
reserved.

## Context

A size was stored exactly as typed, inside its size system:
`uq_size_system_code (size_system_id, code)`. Stock is keyed on `size_id`.
So `M` and `m`, or `M` under «Літерна» and `M` under «Інша», became two
sizes with two balances. Nothing joins two sizes afterwards: a merge of
models (ADR-0008) moves stock between models, never between sizes.

The shops are about to type their existing stock, and typing is where sizes
are made. «Створити товар з опису» is the only screen that takes a typed
size. It posts to the catalogue decision (`POST
/catalog/decisions/{id}/create-product`); `POST /catalog/products` takes the
same sizes. Receiving, the opening lists and the till pick a size from the
list of sizes that exist (`GET /catalog/sizes`).

The owner decided:
- case does not matter; the Cyrillic spellings `М Л С ХС ХЛ ХХЛ` are the
  Latin sizes; a count of X's is the X's written out, for every count,
  `1XL` included;
- in a double size, spaces and the kind of dash do not matter; a slash is
  another size;
- one spelling is shown everywhere: capital Latin, X's written out;
- the size system does not separate sizes; it orders the list.

A first draft of this ADR was reviewed against the code. What it found is
built in below; one question (`1XL`) went to the owner.

## Decision

### 1. The spelling

`spell_size(typed) -> str`, in `app/modules/catalog/sizes.py`, is the one
place that decides how a size is written. It is pure and has no database.

1. NFKC, then whitespace runs collapse to one space, and the ends are
   trimmed.
2. Every dash (`‐ ‑ ‒ – — ― −`, and the hyphen) becomes `-`. Spaces around a
   `-` or a `/` are removed. Elsewhere a space stays: `46 48` is not `46-48`,
   and `2 XL` is not `XXL` (in a size field `2` may be a count). The owner
   spoke of spaces around a dash.
3. Every word is spelled on its own. A word is a run of letters and digits,
   an apostrophe inside it included, so `48 (м)` has the words `48` and `м`.
   - **A letter size.** The word is casefolded, the four Cyrillic letters
     `х л с м` become `x l s m`, and the result is uppercased. If it is then
     `M`, `X…S` or `X…L` (any number of X's, none included), or a count from
     `1` followed by `XS` or `XL`, it is written as capital Latin with the X's
     written out: `2xl` → `XXL`, `хл` → `XL`, `3ХС` → `XXXS`, `1XL` → `XL`.
   - **Any other word** has its Latin letters `a`–`z` made capitals
     (`os` → `OS`, `one size` → `ONE SIZE`). A Cyrillic word, such as
     «єдиний», keeps its letters: capital Latin is not a spelling it can take.
4. What lies between words (spaces, brackets, `-`, `/`) stays.

So `л / хл` → `L/XL`, `46 – 48` → `46-48`, `s-m` → `S-M`, `48 (м)` →
`48 (M)`. A Latin `C` is not an `S`, and nothing else is transliterated:
the owner named these letters, and the parser reads the same ones in a
notebook line (`_SIZES`).

### 2. One size per spelling, in the organization

- **The size's `code` is its spelling.** The one writer, `_resolve_sizes`,
  stores `spell_size(typed)`; nothing else creates an ordinary size.
- **The key is `lower(code)` within the organization.** A unique index
  `uq_size_org_spelling (organization_id, lower(code)) WHERE NOT is_unknown`
  makes `M` one size whichever system it was typed under, and makes a
  Cyrillic word case-blind («Єдиний» = «єдиний»), as the owner's "case does
  not matter" asks. The database compares with its own `lower()`, both in the
  index and in the lookup.
- **`size.organization_id` is new.** A `BEFORE INSERT OR UPDATE` trigger
  (`birka_size_organization`) fills it from the size system, and refuses a
  value that differs, or an update that would move a size to another system
  or organization. Existing inserts (seeds, tests) need not change, and the
  writer passes it too.
- **The insert arbitrates on every unique index:** `ON CONFLICT DO NOTHING`
  with no target. A named target would leave the other index
  (`uq_size_system_code`, or the new one) to raise a unique violation: `M`
  typed under a second system, or two sellers typing the same new size in
  one system at once. The fallback finds the existing size by
  organization, `lower(code) = lower(:spelling)` and `NOT is_unknown`, and
  the answer is that size: its own spelling and its own system.
- `uq_size_system_code` stays. It still keeps the one "size not known" row
  per system, which the new index leaves out; `ensure_unknown_size` keeps it
  as its target.
- **A word size keeps the spelling first typed,** under the case-blind key.
- **A spelling longer than 20 characters is refused** (422), as a name that
  grows when normalized is: `9XL-9XL` is 21.
- **`UNKNOWN` is reserved in every system, by spelling:**
  `spell_size(typed).casefold() == "unknown"`. It was reserved only under
  «Інша», and on the typed text, so a full-width `ＵＮＫＮＯＷＮ` passed.
- Two sizes in one request that spell the same are one size, as the same
  size twice in one request already was. The answer's `typed` is the first.
- **One lock order.** Every size system the request names is resolved
  first, in system-code order; then the sizes are inserted in the order of
  their spelling. Sizes of two systems can now collide, so creating a
  system between two sizes would let two requests wait on each other. A
  system may be created for a size that turns out to exist under another
  system; nothing reads a system without its sizes.

### 3. What the person sees

- `SizeResult` gains `typed`: the size as the request typed it. It reaches
  «Створити товар з опису» through the decision's stored creation (as
  `redirected_from` does), and `POST /catalog/products` through
  `SizeResponse`. Both are optional, so creations stored before, and cached
  replies replayed, still read. When it is not the spelling, the decision
  says which size it is: «Набрано «м» — це розмір «M»». The owner chose that
  whoever types `м` sees that the existing `M` was chosen.
- **The list of sizes:** letter sizes come first, ranked by their X's (`XXS
  XS S M L XL XXL XXXL …`), in whichever system they were first typed; then
  every other size by system, numbers in their order, the rest as written.
  A seller who picked «Інша» for `M` does not put the shop's `M` after the
  numbers for good.
- Old records keep the spelling they froze: a sale's receipt, a supplier
  return's line, a «Брак» unit (`size_label`). There is no shop database
  yet, so none holds an old spelling. Everything that reads the size now
  shows its one spelling.

### 4. Migration `0032`

1. Adds `size.organization_id`, fills it from the size system, makes it NOT
   NULL, references `organization` (`ON DELETE CASCADE`), and installs the
   trigger and its function.
2. **Respells every ordinary size** with a frozen copy of `spell_size` in
   the migration, read and written through the connection. Offline (`--sql`)
   there are no rows to read, so the rendered script instead refuses to run
   over a database that holds any ordinary size.
3. **Before writing, refuses, naming them,** when two sizes of one
   organization would become one (by `lower()` of the new spelling), or a
   spelling grows past 20 characters. Joining two sizes moves stock between
   balances, which no rule covers and nothing records, and there is no shop
   database yet. The message says which sizes, so a person can decide.
4. Writes the new spellings, then creates `uq_size_org_spelling`.

The downgrade drops the index, the trigger, the function, the foreign key
and the column. Respelt codes stay as they are: they are only the spelling.
The `0031` digest is frozen, and the `0031` migration tests upgrade to
`0031` rather than to the head.

## Consequences

- `M` and `m`, `XL` under two systems, `2XL` and `XXL` can no longer split
  one size's stock.
- A notebook's `46/48` and `46-48` stay two sizes, as the owner said.
- A size system is now only an ordering. Nothing else changes for it.
- Rejected: a separate `key` column kept beside the code. The owner chose
  one spelling, so the spelling is the key, and a second column could
  disagree with it.
- Rejected: merging two existing sizes in the migration. It would write
  stock history nobody decided.
- Rejected: the frozen spelling as SQL. Its character classes depend on the
  database's locale, and no shop database exists to respell.
