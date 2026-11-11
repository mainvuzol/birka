# «Усе на бірці», after stage 2's audit, batch 10: the «Початкові залишки» list on its tag and its lines — «← Початкові залишки», the tag's ⋯, the waiting's one line; «Файли списку», «Додати файл» and «Додати рядки вручну» screens of their own; «Відхилити список» a sheet; the approval's summary in its sheet; the section's write refusals by В-П1 (б) — 2026-11-11

Baseline: `b7ac8d79` (the owner's answers after stage 2's audit, PR #192,
merged), and one task of the goods task list after stage 2:
- [P0-1](redesign/2026-11-09-redesign-tz-after-stage2-goods.md) — the
  «Початкові залишки» list: the lines first, the rest behind ⋯ and in the
  sheet «Затвердити»; approved by the owner on 2026-11-11;
- with it, the write refusals of the screens it touches, by the owner's
  В-П1 (б): what was not done, then the step, never «спробуйте ще раз».

It was the goods task list's only P0, and the only P0 left after stage 2's
audit.

Status: built; proof below — 1056 of 1057 journeys on a fresh seed, the one
failing for the stand's database, as in batches 7–9. 40 of 40 mutants
caught. One criterion not met: the first line at 360 × 640 (a question for
the owner). CI is GitHub's, on the pull request. Not yet seen on a real
phone. Branch: `feat/after-stage2-openings-list`. Task: the audit's tenth
batch, chosen in chat after #192 (2026-11-11, «Yes, start batch 10»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-11 (audit after stage
2, batch 10: …)".

Where it stood: before a list's first line came «До списків» at the title's
side, the big tag, «Місце у списку», a plate of what the waiting holds with
«Затвердіть або відхиліть його.», the block «Затвердження» with its sums,
its hint and «Відхилити список» opening a form inside it, the section
«Файли списку» with a tag of four to six small lines per file and its
removal asked inside the tag, «Додати файл» / «Додати рядки вручну» opening
their forms in place, the switch, a `<select>` «Файл». At 360 × 640 the
switch was about a screen's scroll down.

## What exists now

- **The list's screen:** «← Початкові залишки» over the title (Telegram's
  «Назад» the same); the tag — its warehouse with ⋯ «Дії зі списком», its
  sticker, meta and progress, and its one line «Поки список чекає рішення,
  на складі «…», де ще не було руху товару, нічого не приймають, не
  продають і не виправляють.»; under it at once the switch of three and
  «Інші рядки», the lines, «Показати ще». A refused approval is said under
  the tag. A store that does not trade keeps its plate.
- **⋯'s sheet**, the list's name, only what this person may do: «Додати
  файл», «Додати рядки вручну», «Файли списку · N» (where the list has
  files), «Відхилити список».
- **A file's lines:** «Показати рядки» on «Файли списку» puts «Рядки файлу
  «2. {назва}»» over the switch, with «Усі файли»; no `<select>`.
- **«Файли списку»**, its own screen «← {список}»: «Місце у списку: …»,
  then a tag a file — «2. «назва» · Звідки: …», «Рядки 6–6 · розібрано 0 з
  1», «Додано: Оля, …»; the photo's repeats in the warning's colour, only
  when there are any; «Показати рядки» and a quiet «Прибрати файл», its
  question in a sheet with Telegram's MainButton «Так, прибрати», no
  «Скасувати».
- **«Додати файл» and «Додати рядки вручну»**, their own screens «←
  {список}», the room line on both, Telegram's MainButton «Додати до
  списку» / «Додати рядки»; the forms as before.
- **«Відхилити «{список}»?»**, a sheet: «Чому відхиляємо», «Залишків цей
  список не змінить.», Telegram's MainButton «Так, відхилити», not active
  until a reason is given; Enter only puts the keyboard away; the reason
  kept while the sheet is closed.
- **«Затвердити «{список}»?»** adds up under its number: «Як у списку: 1
  рядок · 3 шт.» a basis, «Рядків, де відповідь відрізняється від списку:
  N», «Файлів у списку: 2»; the block «Затвердження» and its hint are gone.

### The words, new or changed

The section's write refusals (В-П1 (б)), was → now:

| Where | Was | Now |
| --- | --- | --- |
| A line's answer | «Відповідь не збережено. Перевірте її та спробуйте ще раз.» | «Відповідь не збережено. Перевірте її.» |
| A new list | «Список не збережено. Перевірте рядки / файл та спробуйте ще раз.» | «Список не збережено. Перевірте рядки.» / «… Перевірте файл.» |
| A new list, a conflict | «Список не збережено. Поки ви працювали, дані змінилися — спробуйте ще раз.» | «Список не збережено. Поки ви працювали, дані змінилися: перевірте склад і натисніть «Зберегти список» ще раз.» |
| Approval | «Список не затверджено. Спробуйте ще раз.» | «Список не затверджено. Перегляньте рядки списку.» |
| Rejection | «Список не відхилено. Перевірте причину та спробуйте ще раз.» | «Список не відхилено. Перевірте причину.» |
| Removal | «Файл не прибрано. Спробуйте ще раз.» (and «Рядки …») | «Файл не прибрано. Перегляньте файли списку.» (and «Рядки …») |
| Adding a file | «Файл не додано. Перевірте його та спробуйте ще раз.» | «Файл не додано. Перевірте його.» |
| Adding lines | «Рядки не додано. Перевірте їх та спробуйте ще раз.» | «Рядки не додано. Перевірте їх.» |
| Any of them, a conflict | «… Поки ви працювали, список змінився — перегляньте його й спробуйте ще раз.» | «… Поки ви працювали, список змінився — перегляньте його.» |
| Any of them, the server's failure (5xx) | «Не вдалося виконати операцію. Спробуйте ще раз. Номер запиту: …» | «{що не зроблено} Натисніть ще раз — повторити безпечно. Номер запиту: …» |

The screen's words:
- gone: «До списків»; «Затвердіть або відхиліть його.» / «Відхилити його
  можете й ви.»; «Затвердження»; «Стане початковим залишком складу «…»: N
  шт.» (the sheet's large number says it); «Затвердити можна, коли кожен
  рядок розібрано або позначено «не товар». Ще чекають: N.»; «Файлів у
  списку: N · прибрано: M»; «Файл» with its list; «Скасувати» in the
  removal's and the rejection's questions;
- new or moved: «← Початкові залишки»; «Файли списку · N»; «Рядки файлу
  «N. {назва}»», «N. Рядки, внесені вручну», « (прибрано)», «Усі файли»;
  «Відхилити «{список}»?»; «{основа}: N рядок/рядки/рядків · N шт.»; the
  reader's «Дії зі списком» for ⋯ and «Назад до «{список}»» for «←».

## The independent review

An independent reviewer read the diff with P0-1 and В-П1 (б), the shared
`Back`, `Sheet`, `ScreenHeader`, MainButton and the server's removal and
rejection; it ran the type check and ESLint, not the journeys. Nothing
blocking, no right or idempotency broken; two medium, one low–medium, six
low. Settled:
- **Enter in the reason rejected the list** (medium): the sheet's field
  sat in a form with a hidden submit, and the keyboard's Return submits —
  a manager putting the keyboard away to see the button would reject. No
  form now: Enter leaves the cursor in the sheet, and only the button
  rejects. A journey presses Enter and finds nothing sent.
- **A server failure still said «Спробуйте ще раз»** (medium): the shared
  words fell through for a 5xx. The section says what was not done and
  «Натисніть ще раз — повторити безпечно.», the request's number kept; a
  journey refuses a line's answer and an approval with a 500.
- **A refusal under the tag outlived its moment** (low–medium): it stayed
  after the line it named was answered, or under the stub once decided.
  Cleared when the list is decided or a line opened; a journey opens a
  line and finds it gone.
- **The sheets closed before the list was read again** (low): «Затвердити»
  stood a moment over a list just rejected. A refusal frees its sheet at
  once; a success reads the list first, then closes. The same for the add
  screens, which let «Затвердити» flash over a line just added at 360 ×
  640 — a journey now looks for the dock at once.
- **A form left for a list no longer open to it** (low): the screen gives
  way to the list.
- **The file's line kept its copy of the file** (low): removed meanwhile,
  it still read as live. Read from the parts; a journey removes the file
  whose lines are shown and finds « (прибрано)».
- **The reason lost when the sheet closed** (low): kept by the list; a
  journey closes and opens it.
- **«Місце у списку» never said for a list typed in one go** (low): on the
  add screens too; journeys read it on both.
- **«Файли списку · N» and the removed ones** (low): kept — N is the files
  still in the list, the screen shows the removed too, struck through.
- Kept: outside Telegram, Enter in «Додати рядки вручну» sends the lines,
  as the form always did — they are removed again as their part.
- Its test gap — no two-file check at 360 — was already being written: see
  «Not met» below.

## How it was built and proven

- **Code:**
  - `frontend/src/openings/Openings.tsx`: the list's header, its tag and
    ⋯, the ways' sheet, the file's line, the screens of the list's own,
    `Approval` with its refusal under the tag, `RejectSheet`,
    `ApprovalSummary` in `ApproveSheet`, `decisionRefusal`; the block
    «Затвердження» inside `Approval` and `decisionText` gone;
  - `frontend/src/openings/Parts.tsx`: `PartsScreen`, `PartTag`,
    `RemoveSheet`, `Room`, `MainMimic`, `ListBack`; `AddFile` and
    `AddLines` screens with MainButton; the section `PartsSection` gone;
  - `frontend/src/openings/types.ts`: `listRefusal` — the server's failure
    in the list's words; `LIST_CHANGED`; `frontend/src/openings/Line.tsx`:
    its check's words;
  - `frontend/src/styles.css`: the tag's head and line, the file's line,
    the files' tags, the sheets; the old `.opening-part` rules gone.
  - No backend change; no right, no rule.
- **Journeys:** 1057 in all, as before — this batch rewrote journeys, it
  added none.
  - `openings.spec.ts`: the summary in the sheet; inside Telegram ⋯'s
    «Додати рядки вручну» a screen with MainButton «Додати рядки», the
    rejection's MainButton not active until a reason, «Назад» closing both;
    at 360 no `<select>`, h3 or form inside a plate; every refusal's words,
    the 500's, the said refusal cleared by a line opened, the rejection's
    sheet — Enter sending nothing, the reason kept, refusals inside it,
    the tag taking the cursor once rejected; ⋯'s ways by the person's
    rights.
  - `openings-file.spec.ts`: «Місце у списку» on «Файли списку» and on
    «Додати файл»; the second file's tag; «Показати рядки» and «Усі
    файли»; **360 × 640, light and dark, a list in work of two files**;
    the summary's three lines; a file removed by its sheet, the filtered
    file's line saying « (прибрано)»; the store that stopped (⋯ only
    «Відхилити список» for a list typed in one go; the new list's four
    ways); the lost answers' files counted as read.
  - `today.spec.ts`: «Назад до «Початкові залишки»». `fixtures.ts`:
    `listWay`, `rejectList`, `removePart`.

## Mutants

`~/.cache/birka-runtime/helpers/mutate40.py`: 40 mutants, each undoing
one thing this batch made. `mutants40.sh` ran each against the journeys
that should catch it, on a fresh seed each, one failure ending the run.
- **The list's screen:** «Назад до «Початкові залишки»» back to «До
  списків»; no ⋯; «Затвердіть або відхиліть його.» back in the tag's line;
  «Файли списку» offered to whoever may add, files or not; its count the
  list's own instead of the parts read; «Відхилити список» only for
  whoever may approve; the approval's refusal not under the tag, or not
  cleared by a line opened; MainButton «Затвердити» under ⋯'s sheet; no
  file's line; the file's line a copy kept from before its removal; an add
  screen going back before the list is read again.
- **The rejection's sheet:** MainButton active with no reason; its own
  button free with none; Enter rejecting; the reason dropped when the
  sheet closes; «Залишків цей список не змінить.» gone; the sheet closing
  on a refusal.
- **The approval's summary:** «рядків» for any number; «Файлів у списку»
  never said, or said for one file.
- **The words:** a 5xx said in the shared words; «Спробуйте ще раз» back in
  the conflict's, the approval's, the rejection's, the new list's, a
  line's and a removal's refusals.
- **«Файли списку» and the add screens:** the heading not taking the
  cursor; «←» not naming the list; no room line on the files' screen, on
  «Додати файл», on «Додати рядки вручну»; a file's number, its source,
  its «розібрано x з y» gone; a removed file not marked; «Показати рядки»
  doing nothing; the removal's question not the sheet's own; «Так,
  прибрати» another word.
- **40 caught.** The first pass: 40 of 41. The one left — the tag taking
  the cursor only once no sheet stood over the list — was equivalent: the
  rejection's sheet goes as the list reads rejected, with the right to
  reject, so the tag takes the cursor either way. The guard was redundant
  and is gone (the effect is main's again), and so is the mutant.
- Log: `go-mutants40-first.log`.

## Evidence

- **Type check, ESLint:** `tsc --noEmit`, `eslint src/openings` and the
  touched journeys clean; prettier on the touched files (prettier 3, from
  npm's cache: the project has none of its own; `styles.css` is main's
  own unformatted file, left as it is).
- **The touched journeys,** on a fresh seed each:
  - the openings' two specs, first: 21 of 26 — two crowded-database
    failures; one wrong expectation (a list typed in one go has no «Файли
    списку»); «Файли списку · 1» after a lost answer — the list's own count,
    now the parts read; the 360 check (below);
  - after the review's fixes: 24 of 26 — Escape not closing the
    rejection's sheet, held while the list was read again after a refusal
    (now freed at once), and a tap before a sheet had risen (the journey
    waits); then 26 of 26, twice;
  - `today.spec.ts`: 40 of 40.
- **360 × 640:** measured in the journey, a list in work of two files: the
  title ends at 102, the tag 168–459, the switch 475–539, «Інші рядки»
  551–595, the menu at 575, the first line at 607. Screenshots
  `frontend/test-results/openings-two-files-360-{light,dark}.png` (not
  kept).
- **Every journey,** on a fresh seed, one worker: 1056 of 1057 in 29.1
  minutes (`b10-full.log`). The one: `backups.spec.ts:93` — 14 nights
  listed where it reads 3: the stand's database keeps every seed's nights
  (the seed is additive); nothing of this batch touches «Резервні копії».
- **The screenshots at 360 × 640** of that run, light and dark: «←
  Початкові залишки», the title, the store's line, the tag with ⋯ and its
  four-line hold, the switch; «Усі ⋯» cut by the menu, the first line
  under it.
- **Mutants:** 40 of 40 caught (above).

## Not met

- **The first line at 360 × 640** (P0-1's first criterion). The header, the
  tag and the switch stand over the menu, nothing stands between them and
  the lines — but the first line begins about 30 px under the menu. The
  tag's line of what the waiting holds, in its approved words, takes four
  lines at 360 px (76 px); «Інші рядки ⋯» takes its own row (56 px), as
  on main, because beside the switch «Потребують» would break inside the
  word. A question for the owner, below. On a phone 700 px high or more
  the first line's text is seen.

## Not covered

- A real phone; Telegram's own height (the journeys set 360 × 640).
- The approval and removal sheets reading the list before they close: no
  journey sees the moment between (only the add screens' is looked for).
- A form giving way when its list stops being open to it: no journey.

## For the owner

- What changes for the eye: a list opens on its tag and its lines; adding a
  file, adding lines, the files and rejecting are behind ⋯ on the tag;
  rejecting asks why in a sheet; the sums of an approval are in its sheet,
  before «Так, затвердити». No refusal in the section says «спробуйте ще
  раз» any more — each says what was not done and what to do.
- One question: on a small phone (360 × 640) the first line is a short
  scroll below the tag, because the line «Поки список чекає рішення, на
  складі «…», де ще не було руху товару, нічого не приймають, не продають
  і не виправляють.» takes four lines. Either keep it (a short scroll on
  small phones, as you chose for «Сьогодні»'s tag, В-К1 (б)), or shorten it
  — for instance «Поки список чекає, на складі «…» нічого не приймають, не
  продають і не виправляють.» (two lines; it drops «де ще не було руху
  товару», which says why only this warehouse waits).
