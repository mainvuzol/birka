# «Початкові залишки»: existing stock gets in from the app — 2026-10-01

Baseline: `d6f5196` (the hot-path gate fix, merged as PR #51).
Status: implemented and verified locally. No migration.
Branch: `feat/m1-023-opening-stock-screen`.

## Why this was next

It was row 15 of the [release checklist](release-checklist.md), the one
blocker the agent could build. Nothing let the shops' existing stock into
the app.

The owner chose on 2026-10-01 between two ways in:
- **lists with review** (ADR-0005), built on the server in M1-023 with no
  screen;
- **photos of the notebooks**, read by a separate parser into JSON.

Whatever is still missing is added one by one. The first way had no screen.
The second waits for a parser and its format, which do not exist yet.

## What exists now

A section, «Початкові залишки», for whoever may import lists
(`snapshot:import`) or approve them (`snapshot:approve`):

1. **A new list.**
   - Choose the warehouse. Optionally, say where the list came from
     («Зошит 2, сторінки 1–4») and when it was counted.
   - Type or paste the lines as they are written.
   - Blank lines are dropped. Everything else is kept verbatim.
   - The typed list is kept on the phone until the server has it. A lost
     answer is resent under the same `command_id`, and the list is saved
     once.
2. **Each line answered.**
   - Each line shows what the list says about its quantity, and how often
     the same line repeats.
   - Pick the model from the catalogue, with the search starting from what
     the line reads.
   - Pick the size, or «Розмір невідомий». Then say where the count came
     from, offered only as the server accepts it:
     - **«Як у списку: N шт»** — only for a line that states one count. The
       count is fixed to what the line states, in one allocation.
     - **«Рядок без кількості — одна штука»** — only for a line with no
       number that could be a count.
     - **«Перелічили»** or **«Відомо інакше»** — with a note saying who
       counted, or how it is known. Several sizes or colours are only ever
       answered this way.
     - **«Це не товар»** — with a reason, such as a page total.
3. **The approval**, for whoever may approve:
   - **What becomes stock:** the units, and how many lines and units rest
     on each basis. Also how many answers differ from what the list
     states.
   - **Approving asks once more,** since it cannot be undone.
   - **A warehouse with any history is explained:** the opening balance goes
     only into an empty one, so reject the list and receive what is missing
     through «Приймання».
   - **Rejecting** needs a reason. It changes no stock.

**The server gained one field.** A line now says whether it may be taken
as one piece (`may_imply_one`), by `check_basis`'s own rule. Before, a
client could only guess it.

**The client** can now send a PUT, which answering a line needs. The
catalogue picker can start from a search text.

## Evidence

- **Backend: 1128 passed, 1 skipped** (the `age` test, run by CI). The one
  new test pins `may_imply_one`. It is true only for a line with no number
  that could be a count, never for:
  - one stating a count;
  - one with two counts;
  - one with a number nobody can say is a count.
- **E2E: 87 passed** on a fresh database against the real API, 4 of them
  new:
  - **The whole path.** A list is typed and answered:
    - as stated;
    - as one piece, size not known;
    - as not stock.

    It is then approved, and the warehouse holds 3 M and 1 of size not
    known.
  - **A split the list does not state.** No stated count or one piece is
    offered, a recount needs its note, and a warehouse with history refuses
    the approval and says why. Then the list is rejected.
  - **A typed list survives a reload,** and a lost answer saves it once.
  - **Permissions.** No approval without `snapshot:approve`, and no section
    without either permission.
- **Three existing journeys changed one locator each.** They looked for a
  button "Залишки" by substring, which «Початкові залишки» now also
  matches. They now match it exactly.
- **The E2E seed gained** a warehouse nothing has moved in, «Новий склад».
  It is the one place a list can be approved into, once per seed.
- **Gates:**
  - ruff, format, mypy, all 19 import contracts and `alembic check` are
    clean;
  - frontend lint, types and build pass.
- **Seen on a phone-sized screenshot:** the new list form, a line being
  answered, and the list.

**Mutation testing — 14 mutants, all caught (backend 1, frontend 13).**
- **Backend:** `may_imply_one` ignoring the countless rule.
- **Frontend:**
  - a stated count offered for any line;
  - one piece offered for any line;
  - a stated count typed over;
  - a recount without a note;
  - the typed list not kept;
  - a resent list saved twice;
  - approved without being asked;
  - an approval of a revision nobody looked at;
  - a warehouse with history not explained;
  - blank lines sent;
  - size not known sent as a size;
  - the approval offered to anyone;
  - the section offered to anyone.

## Found on the way

**The line editor first nested a form inside a form.** The catalogue
picker's search was submitting the wrong one and resetting the app. The
editor is now a container, not a form, and the E2E journeys found it.

## Not covered here

- **The second way, photos → parser → JSON,** was chosen by the owner on
  2026-10-08, in a format Birka defines; it is not built yet. When it
  exists, its JSON can become a list's lines and pass through this same
  review, unless the owner decides otherwise.
- **A model not in the catalogue is created in «Каталог» first,** as when
  receiving. Then return to the line.
- **Nothing tells in advance whether a warehouse has history.** The hint
  says so, and the approval explains a refusal.
- **Reviewing hundreds of lines on a phone** is slow by design: each line is
  a person's statement. Not measured with real notebooks.
- **Nothing has run in production.**

## Changed files

- New:
  - `frontend/src/openings/Openings.tsx` and `types.ts`;
  - `frontend/e2e/openings.spec.ts`.
- `backend/app/modules/snapshots/service.py`,
  `backend/app/api/v1/snapshots.py` — `may_imply_one`.
- `backend/tests/integration/test_snapshot_import.py` — one test.
- `backend/scripts/seed_orders_e2e.py` — «Новий склад».
- Frontend:
  - `src/App.tsx` — the section;
  - `src/shared/api.ts` — PUT;
  - `src/inventory/CatalogPicker.tsx` — `initialSearch`.
- E2E: `backups`, `damaged` and `returns` specs — the exact «Залишки».
- Docs:
  - the release checklist;
  - the milestone;
  - the risk register;
  - the README.
