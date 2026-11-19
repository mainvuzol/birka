# «Усе на бірці», audit 2026-11-18, batch 7: a model's detail waits as its hero tag; «Нічого не знайшли» of the catalogue one look and heard; the warning's plate, the list's block and the choice felt only as it changes in «Товар»'s last places — 2026-11-19

Baseline: `5db7fd8e` (main after #230).

Points, all P2: goods P2-3, P2-4 and P2-5 — the last of audit 2026-11-18
that wait for no owner. Picked in chat: «Goods batch».

Nothing recorded, sent or counted changes. No request, check, journal,
right or word changes. What «Так, це його назва» and «Ні, не про нього»
record is as before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1211 (1210 before).
- Branch: `feat/audit-1118-goods-close`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-19 (audit
  2026-11-18, batch 7: …)".

With it the goods task list of audit 2026-11-18 is whole. Of the audit,
only owner-held points are left: sale P2-4 (the word «Прибрати») and money
P2-3 (Д1, a real phone).

## What exists now

- **A model's detail waits as its hero tag** (goods P2-3):
  - While S23 is read, the hero tag stands in its own form, as «Моделі»'s:
    - the eyelet and the name's line 42 in grey;
    - ⋯'s place, for whoever may correct;
    - the price's line, and «Змінити ціну»'s place (44, the button's
      corner 8) for whoever may change it;
    - the grid's rows every answer has: three sizes and «Разом», one
      warehouse and «Можна продати», each a grey line of its own words.
  - Never the till's tile and its cells. The tag's top is where the
    answer's stands (±1).
  - «Завантажуємо залишки моделі…» is heard only, as before; the grey is
    hidden from a reader.
  - Decided here: three sizes' places and one warehouse's row — how many,
    only the answer says.
  - «Моделі»'s wait is drawn by the same shared `HeroWait`, its look as
    before.
- **«Нічого не знайшли» of the catalogue one look, and heard** (goods
  P2-4):
  - On a screen, the shared empty place: the blank tag 64, «Нічого не
    знайшли за «…»», and «Додати нову модель «…»» under it where a model
    may be added. This covers «Прийшов товар», «Знайшли товар…», a line of
    «Початкові залишки», the till's «з каталогу» (no add there, as before),
    «Моделі» and «Об’єднати моделі». A long word typed wraps, the button's
    too.
  - In «Нова модель»'s sheet («Інший колір нашої моделі»), a 14 pencil
    line of `meta`, as the suppliers' sheet's; «Моделей не знайдено.» the
    same.
  - Heard as it is drawn, everywhere.
- **«Товар»'s last places of the rules of batches 3 and 8** (goods P2-5):
  - (а) «Обраний склад більше не доступний.» is a warning's plate in
    «Залишки» and «Інвентаризація», led by that line, «Оберіть інший
    склад.» under it, 12 over the choices.
  - (б) «Цей опис — назва товару?»: the models as a list's rows on a white
    block, the name 17/600, «Так, це його назва» / «Ні, не про нього» on
    the right. Decided here: «Обраний товар:» is a meta line over the
    chosen name; another model's distinction a meta line under its name,
    «Відмінність моделі: …» as the open proposal's rows say it.
  - (в) A choice felt only as it changes: «Брак»'s warehouse, «Нова
    модель»'s size system (never felt before), «Початкові залишки»' «Інші
    рядки».

## How it was built and proven

Sources:
- `shared/HeroWait.tsx` (new): the hero's wait, `said`, ⋯'s place, what
  else the tag holds. `catalog/Models.tsx` draws its model's wait by it.
- `inventory/Model.tsx`: `ModelWait` — the price row and the grid in grey
  (`Grey` from `shared/TableWait.tsx`, now exported); `styles.css`
  `.model-price-row > .skeleton-change`.
- `shared/Empty.tsx`: `status`, the line heard. `inventory/CatalogPicker.tsx`
  and `catalog/Models.tsx` draw nothing found by it; `catalog/FamilySearch.tsx`
  a `t-meta nothing-yet` line. `.catalog-none` replaced by `.catalog-empty`
  and `.catalog-nothing`.
- `inventory/Stock.tsx`, `inventory/Stocktaking.tsx`: the warning's plate.
- `catalog/Catalog.tsx`: the name question's rows in
  `ul.new-model-candidates.list-block`; `.catalog-name-row` gone.
- `damaged/Damaged.tsx`, `catalog/NewModel.tsx`, `openings/Openings.tsx`:
  `buzz("selection")` only as the choice changes.

Journeys (+1):
- `model.spec`: new — the detail read slowly: the hero's wait, its places,
  heard only, both themes at 360, the tag's top kept.
- Changed:
  - `goods-places` — the detail read anew after a delivery waits as the
    hero, never the tile;
  - `receive`, `openings`, `models` — nothing found is the empty place,
    heard; the add button inside it (`nothingFound` in fixtures);
  - `catalog` — the sheet's line 14 pencil, heard, no tag; the name
    question's rows on the block, the answer on the right, at 360 in both
    themes; the size system felt as it changes;
  - `receive` also — a long word typed at 360 in both themes;
  - `stock`, `stocktake` — the plate at 360 in both themes, 12 over what
    follows (`expectGoneWarehouse`);
  - `damaged`, `openings` — the chosen tapped again, nothing felt.

Runs on a fresh seed:
- Touched specs (`design-system`, `stocktake`, `stock`, `model`,
  `goods-places`, `catalog`, `models`, `receive`, `openings`, `damaged`,
  `correct`, `till-first-days`, `size-spelling`): 212 passed, 1 failed —
  `goods-places:561` still waited for the old tile; updated, 10/10.
- After the review's fixes, `stocktake`, `stock`, `model`, `catalog`,
  `receive`: 79 passed, 9 failed on the database the mutants had crowded —
  the catalogue's «Це вона: Лоран…» missing and the stocktake's own state,
  as before (see memory); on a fresh seed 88/88.
- mutate76: 26/26 caught — 22 first, then 4 for the review's fixes (the
  plate's gap, the space, the corner, the button's wrap), with the two
  whose source changed run again.

## The review

An independent review read the diff against the three points, the rules
they cite and the design system. It found nothing High. `tsc` and ESLint
are clean; the specs' type errors are main's.

Checked and found right:
- «Так, це його назва» and «Ні, не про нього» send what they sent:
  `feedback_id`, the variant, `CONFIRM` / `REJECT`; `disabled`, `quiet`
  and the `aria-label` as before.
- `.catalog-none` and `.catalog-name-row` are used nowhere else.
- «Моделі»'s `HeroWait` draws the old markup; S23's wait keeps the hero's
  top, its grey hidden from a reader, one status.
- Every `CatalogPicker` stands on a screen; the family search in a sheet.
- Each buzz is decided before the choice is set, and posted at the tap.
- Every new or changed check fails on main.

Medium, fixed:
- **M1, the plate on «Інвентаризація» flush on the choices.** The bare line
  kept the browser's 16 under it; the plate had none. Now 12 under the
  plate on both screens; `expectGoneWarehouse` checks it.

Low:
- **L1, fixed:** «Змінити ціну»'s place took the grey's corner 10 —
  `.skeleton` is drawn later. Now `.model-price-row > .skeleton-change`, 8;
  checked. Noted, not changed: `.skeleton-choose` has the same cascade.
- **L2, fixed:** «Обраний товар:» and the name ran together for a reader;
  a space between, checked.
- **L3, fixed and written:** the distinction note is «Відмінність моделі:
  …», as the open proposal's rows; in the rules entry.
- **L4, fixed:** 360 in both themes checked for the empty search and the
  name question; a long word typed pushed «Додати нову модель «…»» past the
  phone (already so before) — the button wraps now.
- **L5, noted:** the status region comes with its line, as before on these
  screens; «Сьогодні»'s region always there is the firmer way, not taken.
- **L6:** the new file and the rules entry are in.
- **L7, noted:** four checks that hold behaviour unchanged sit beside ones
  that fail on main.
