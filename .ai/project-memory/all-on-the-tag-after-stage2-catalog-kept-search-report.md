# «Усе на бірці», after stage 2's audit, batch 16: a catalogue operation kept on the phone in the one form every kept operation has; «Інший колір нашої моделі» searched as it is typed (goods P1-4, P1-5) — 2026-11-12

Baseline: `61b9dbb6` (the audit's fifteenth batch, PR #198, merged). The
user chose goods P1-4 and P1-5 of the goods task list after stage 2
(`.ai/project-memory/redesign/2026-11-09-redesign-tz-after-stage2-goods.md`),
both marked «нужно утверждение»: built as the task list gives them, its
words and what it did not give readings for the owner.

Left of the goods task list: P1-2, P1-3 and P2-4, each «нужно
утверждение».

Status: built and proven in the journeys (1087 of 1088, the stand's own
`backups:93`); 21 of 21 mutants caught; the review's findings fixed; not
committed.
Not yet seen on a real phone.
- Branch: `feat/after-stage2-catalog-kept-search`.
- Task: the audit's sixteenth batch, chosen in chat after #198 was merged
  (2026-11-12, «P1-4 + P1-5»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-12 (audit after
  stage 2, batch 16: …)".

Where it stood:
- A catalogue operation kept on the phone — in «Перевірка каталогу» and
  the sheet «Нова модель» — was the last kept operation in a form of its
  own: an h3 «Незавершена операція каталогу», «Результат ще не
  підтверджено. Повторна спроба використовує ту саму операцію.» and a
  button «Повторити ту саму операцію» — where every other kept operation
  says «… ще не підтверджено», «Невідомо, чи записано …» and «Перевірити
  результат …» on its stub.
- «Інший колір нашої моделі» was the section's last search of the old
  kind: a field and «Знайти модель» (or Enter), a hint of three sentences,
  «Шукаємо моделі…» in words, «Попередні моделі» / «Наступні моделі»
  replacing the page.

## What exists now

- **A kept catalogue operation** (P1-4; `frontend/src/catalog/KeptCatalog.tsx`):
  the shared `Kept` (`frontend/src/shared/Kept.tsx`), as its own screen's:
  - the stub still attached, «Ще не підтверджено» on it;
  - «Операцію каталогу ще не підтверджено»;
  - «Невідомо, чи записано операцію каталогу. Перевірте результат — та
    сама операція не запишеться двічі.»;
  - when and by whom, as before;
  - the phone's checking line;
  - «Перевірити результат операції» — the same operation, its key the
    same;
  - a creation's cancelling under it, as before: its line and the quiet
    «Скасувати незавершене створення» (`Kept`'s new `after`).
  - No stub's title says «Незавершена» any more: frame P1-2's third
    criterion is met.
- **«Інший колір нашої моделі»** (P1-5; `frontend/src/catalog/FamilySearch.tsx`):
  - the shared search field, its placeholder «Назва моделі або джерело»;
    asked as it is typed, from two letters, about 300 ms after the last;
  - nothing typed, or one letter: every model at once, its first page —
    the model two taps away (the kind, then the model); one letter keeps
    the list where it stood;
  - one line of hint, «Схожі назви не означають однаковий товар.»;
  - rows of one line, a tap choosing (the keyboard hidden);
  - «Показати ще» adding the next twenty under them, the cursor on the
    first it brings — never once new words are typed; a failed page its
    «Спробувати ще раз» where «Показати ще» stood;
  - three grey rows while read; «Нічого не знайшли за «…»»; «Моделей не
    знайдено.» for a catalogue with no model.
- `frontend/src/shared/SearchField.tsx` may be held (`disabled`): the
  search while a catalogue operation is kept.

## The independent review

An independent review (a fresh agent, the diff and the task list's two
points; no conclusions handed to it) found:
- **High:** none.
- **Medium, fixed:**
  1. One letter emptied the list 300 ms later, and the second brought every
     model back before its answer: every model, a blank, every model, the
     answer — a jump on the step P1-5 speeds up. Now fewer than two
     letters is the empty search: the list stands, nothing is asked. A
     journey step: one letter, 22 rows before and after the pause, no
     request.
  2. The owner's approval was not recorded, and P1-4 revisits a choice
     made in chat. The business rules' entry names the revisited entries
     and the readings — the placeholder leaves out «відмінність», still
     searched; «Моделей не знайдено.» is not the task list's.
- **Low, fixed:** a page pressed for other words and failed kept the
  cursor's place: new words whose rows reached it took the cursor from
  the field mid-typing (the iOS keyboard closing). Now new words reset
  it; a journey step and a mutant. «Пошук у каталозі»
  (`CatalogPicker.tsx`) has the same, older than this batch — left, below.
- **Low, left:**
  - the 360 criterion is a screenshot, not an assertion — the similar
    models' chips over the field decide where it starts (below);
  - the fixed 700 ms wait in the journey: a negative check (nothing asked
    on one letter), as the repo's others;
  - an empty catalogue's «Моделей не знайдено.» is a line, not the shared
    `Empty`: a sheet's edge case, never a list's screen;
  - Enter (the keyboard's «Пошук») does nothing now, as in «Пошук у
    каталозі»; the search is already asked.
- **Checked and fine** (the review's words): the same command and key on
  the check; the cancelling a rejection with `CANCEL_CREATION_REASON`,
  offered only for a creation; `after` and `disabled` optional, no other
  user changed; no rows of another proposal or store; the paging cap as
  before; each row's name containing its text; the rewritten journeys
  failing on the old words.

## How it was built and proven

**Code:**
- `frontend/src/catalog/KeptCatalog.tsx`, `frontend/src/shared/Kept.tsx`
  (`after`).
- `frontend/src/catalog/FamilySearch.tsx`, `frontend/src/shared/SearchField.tsx`
  (`disabled`).
- No backend change.

**Journeys:** 1088 in all; 1087 before.
- New (1): `catalog` — «Інший колір нашої моделі»: every model at once,
  nothing asked before; no «Знайти модель», «Попередні моделі»,
  «Наступні моделі»; one line of hint; the placeholder; nothing past the
  width at 360; «Показати ще» failing, its plate where it stood, the rows
  staying, its retry adding the second page under the first with the
  cursor on its first; one letter keeping the list, nothing asked; new
  words after a failed page keeping the cursor in the field; two letters
  asked once; the model chosen by the second tap; «Моделей не знайдено.»
  for an empty catalogue. Its answers are the journey's own (no model is
  created from them).
- New steps: `catalog` — a kept creation's stub (its sticker, title,
  line, buttons in order, the cancelling's line, the old words gone); a
  kept proposal's stub with its check alone.
- Changed: `catalog`, `models`, `receive` — «Перевірити результат
  операції» and the heading «Операцію каталогу ще не підтверджено» where
  they pressed «Повторити ту саму операцію» or read «Незавершена операція
  каталогу»; the family search found by typing, no Enter, no button;
  «Нічого не знайшли за «…»».

## Mutants

`mutate46.py`, 21 mutants, each applied alone, its journey run, the source
restored (`mutants46.sh`): 21 of 21 caught, each at the check meant for it.
- The kept form (7): its title, its line, its check's label, its own
  screen's stub (not a banner), `after` dropped, the cancelling offered
  for every operation, the cancelling's line.
- The search (14): from one letter; one letter asking (the blank
  between); new words keeping the cursor's place; the three-sentence
  hint; «Наступні моделі»; the last page alone; the failed page's plate;
  the cursor after «Показати ще»; «Нічого не знайшли»; the empty
  catalogue's words; the row's name; the placeholder; «Показати ще» with
  no next page; a search never read.
- The first pass had 20, 19 caught. The one that passed — an empty field
  asking nothing — was not explained before the review's first fix
  rewrote the code it changed; the one-letter mutant took its place, and
  the cursor's mutant was added.

## Evidence

- Full run, a fresh seed, one worker: 1087 of 1088 in 29.9 min. The one:
  `backups:93` — the stand's own (the additive seed's nights), as in every
  full run since batch 8.
- The affected specs (`catalog`, `models`, `receive`) before the review's
  fixes: 22 and 51 passed (`catalog`'s «Лоран» choices needed a fresh seed
  on the crowded stand, as before); the family journeys again after them.
- Seen at 360 × 640: the search — the field, the hint's one line, the rows;
  the kept creation's stub in the sheet — the sticker, the title, the
  line, the paper's line, the checking line, the check, the cancelling.
- Types: `tsc -p tsconfig.json` clean; the journeys' (`tsconfig.eslint.json`)
  44 errors, as on main — none in a file of this batch. ESLint and
  Prettier clean on every file touched.

## Not covered

- A real phone.
- The search held while a catalogue operation is kept (`disabled`): no
  journey keeps an operation with «Інший колір нашої моделі» open and no
  model chosen.
- At 360 × 640, with many similar models offered as chips over the
  search («Схожі моделі»), the field starts below the first screen; the
  task list's «field, hint and first rows above the keyboard» holds when
  the field is in view (the journey's screenshot scrolls to it).

- «Пошук у каталозі» (`frontend/src/inventory/CatalogPicker.tsx`): a
  page pressed for other words and failed still keeps the cursor's place
  — the review's low finding, older than this batch, not of it.

## For the owner

- **Done:** an unconfirmed catalogue operation looks and reads like every
  other one; the other colour of a model is found as you type, every
  model shown at once.
- **To read** (decided here): the search's placeholder «Назва моделі або
  джерело»; «Моделей не знайдено.» when the catalogue has none; one letter
  shows nothing until the second.
- **Waiting for your approval** (the goods task list): P1-2, P1-3, P2-4.
- **Still open:** «Каса»'s and orders' refusals by В-П1 (batch 15); the
  «what to check» words (batch 15); «Закриття · Центр» (batch 12);
  «Продано»'s stub words (batch 13); the «Початкові залишки» hold line
  (batch 10).
