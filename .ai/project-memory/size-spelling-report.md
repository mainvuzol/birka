# One size, one spelling — 2026-10-03

Baseline: `78d6e2a` (correcting the catalogue, merged as PR #64).
Status: implemented and verified locally. Migration `0032`.
Branch: `feat/size-spelling`.
Design: [ADR-0009](../decisions/ADR-0009-one-size-one-spelling.md).

## Why this was next

Asked what came next, the owner chose the size-code question, open since
M1B. A size was stored exactly as typed, inside its size system, so `M` and
`m`, or `M` under «Літерна» and under «Інша», became two sizes with two
balances. Two sizes cannot be put together afterwards: merging models
(PR #64) moves stock between models, never between sizes. The shops are
about to type their stock, so it had to be decided first.

The owner decided on 2026-10-03 (business-rules.md, "one size, one
spelling"):
- **case does not matter;**
- **the Cyrillic `М Л С ХС ХЛ ХХЛ` are the Latin sizes;**
- **a count of X's is the X's written out,** for every count: `2XL` = `XXL`,
  `5XL` = `XXXXXL`, and, asked the same day, `1XL` = `XL`;
- **in a double size, spaces and the kind of dash do not matter;** `46/48`
  is another size than `46-48`;
- **one spelling is shown everywhere,** capital Latin, `XXL` rather than
  `2XL`; whoever types `м` sees that the existing `M` was chosen;
- **the size system does not separate sizes;** it orders the list.

A review of the first design against the code found 16 problems (the
insert's conflict target, the lock order, the migration offline, where
`typed` travels, the list's order). The design was revised; one question
(`1XL`) went to the owner.

## What exists now

**Making a product** («Каталог» → «Створити товар з опису», and
`POST /catalog/products`): the size is stored in its one spelling. A size
already in the shop under any spelling or system is that size, in its own
system. The decision then says «Набрано «м» — це розмір «M»» under the
saved product.

**Lists of sizes** («Приймання», «Початкові залишки», the till): one row per
size. Letter sizes come first, `XXS XS S M L XL XXL …`, whichever system they
were first typed in; then numbers, then the rest.

**Refused (422):** a size whose spelling is `UNKNOWN`, in any system
("size not known" is stated only by a legacy stock list), and a size longer
than 20 characters written out (`9XL-9XL`, `20XL`, `999999999XL`).

**The database keeps it** whatever writes a size: one ordinary size per
`lower()` of its spelling in an organization (`uq_size_org_spelling`), and a
size's organization is its system's (trigger `birka_size_organization`).

**The upgrade** respells every size. It stops, naming them, if two existing
sizes of one organization would become one, a spelling is too long, or a
size would be spelt `UNKNOWN`. No shop database exists yet.

## Evidence

**Backend: 1594 passed, 1 skipped** (the `age` test, which CI runs); 1368
before.
- `tests/unit/test_size_spelling.py`: the owner's spellings one by one, what
  is not respelt, the order of letter sizes, a count too long to write out,
  that a spelling is its own spelling, and that `0032`'s frozen copy spells
  as the app does today.
- `tests/integration/test_size_spelling.py`: through the API, `m`/`м`/`M`,
  another system, counts, double sizes, a Cyrillic word's case, Latin
  capitals, one size twice in a request, another organization, `UNKNOWN` in
  every system (full-width too), too long, the list's order, a decision
  keeping what was typed, an old stored answer, the trigger and the key in
  the database, two sellers typing one new size at once under two systems
  (a real row-lock wait), and a deadlock retried whole.
- `tests/integration/test_size_spelling_migration.py`: `0032` up, down and up
  on an empty database; respelling; each refusal, leaving nothing of `0032`
  behind; two organizations kept apart; the trigger as the file installs it.
- **Changed:** the size insert-order test now covers three systems; the
  `0031` migration tests upgrade to `0031` rather than to the head; the
  offline-SQL test checks `0032`'s refusal and index.

**An adversarial review of the code** (three lenses, each finding checked by
a skeptic) confirmed seven more, all fixed with tests:
- **a size like `999999999XL`** wrote out a gigabyte of X's before the
  length check: a 500 or an out-of-memory server, from any seller. A count is
  now written out at most one past the column, and refused for its length;
- **a size spelt with a digit `int()` cannot read** (`፩`) broke the list of
  sizes for the whole organization (it predates this change; the rewritten
  ordering kept it);
- **the upgrade's refusal named sizes in the database's collation order,** so
  its test would have failed under CI's ICU locale;
- **an old size that would be spelt `UNKNOWN`** passed the upgrade or failed
  with a bare database error; it is now refused by name;
- **the refusal tests** did not prove the upgrade left nothing behind;
- **a Cyrillic letter followed by a combining mark** was not its own
  spelling;
- **`POST /catalog/products` did not retry a deadlock,** which two spellings
  or two systems on one key make likelier; it now retries whole, as creating
  from a decision does.

Two more were left to the owner, in the risk register: a letter glued to
digits (`48М` and `48M` are two sizes) and characters that cannot be seen.

**Mutation testing: 53 mutants, all caught** (backend 50, frontend 3), run
again in full on the final code. The first run's survivors were gaps, now
tested: a full-width `ｘｌ` and `46 － 48` (the first NFKC), a Cyrillic `хм`
(not a letter size), and `8` read before `44` (numbers as numbers). One
change cannot be caught here: the refusal's order under the database's own
collation, since the local database sorts as Python does; CI's ICU locale
does not, and the order is now fixed in Python.

**Gates:**
- ruff, format and mypy are clean;
- 29 import contracts are kept;
- `alembic check` is clean;
- migrations round-trip on an empty database.

**E2E: 149 → 152, all passing on a fresh database.**
`e2e/size-spelling.spec.ts` (3 journeys):
- `м` under «Інша» is the seed's `M`, says so, and «Приймання» lists one `M`;
- `2хл` is `XXL`, `XXL` typed later is the same size and says nothing;
- `46 – 48` is `46-48`, and `46/48` stays another size.

## Not covered here

- **Two sizes cannot be joined.** The spelling stops new ones.
- **A size typed under another system becomes the existing one** without a
  word when the spelling is the same.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/app/modules/catalog/sizes.py`;
  - `backend/migrations/versions/0032_size_spelling.py`;
  - the three test files above, and `frontend/e2e/size-spelling.spec.ts`.
- Backend:
  - `catalog/service.py`: `_resolve_sizes` by spelling, `SizeResult.typed`;
  - `catalog/models.py`: `Size.organization_id`, `uq_size_org_spelling`;
  - `catalog/read.py`: the list's order;
  - `api/v1/catalog.py`: `typed`, and the retry.
- Frontend: `catalog/Catalog.tsx`, `catalog/types.ts`.
- Docs: ADR-0009, business rules, the risk register, the README, the release
  checklist and the current milestone.
