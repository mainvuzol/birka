# «Усе на бірці», after stage 2's audit, batch 18: «Новий список» — the way in a switch, the list its one field, «Звідки список» and «Коли перелічено» under the quiet «Ще про список» (goods P2-4) — 2026-11-13

Baseline: `b3e772cc` (the audit's seventeenth batch, PR #200, merged). P2-4
is the last point of the goods task list after stage 2
(`.ai/project-memory/redesign/2026-11-09-redesign-tz-after-stage2-goods.md`),
marked «нужно утверждение» as P1-2..P1-5 were. Built as the task list gives
it, its words and what it did not give readings for the owner.

With it the goods task list is whole, and so are all five task lists of the
audit after stage 2 (frame, sale, orders and cash, money, goods).

Status: built and proven in the journeys (the full run before the review's
fixes 1088 of 1089, the stand's own `backups:93`; the openings' journeys
after them 27 of 27); 19 of 19 mutants caught; the review's findings fixed;
not committed.
Not yet seen on a real phone.
- Branch: `feat/after-stage2-new-list-switch`.
- Task: the audit's eighteenth batch, taken after #200 was merged
  (2026-11-13, «merged, go next»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-13 (audit after
  stage 2, batch 18: …)".

Where it stood:
- «Новий список» asked «Як внести список» as two radios under a legend,
  «Вставити текст» and «Завантажити файл».
- Three fields stood on the screen at once, «Звідки список
  (необов’язково)» and «Коли перелічено (необов’язково)» over the list's
  lines.
- A refusal of either optional field said «Список не збережено. Перевірте
  рядки.».

## What exists now

- **«Новий список»** (P2-4; `frontend/src/openings/Openings.tsx`,
  `NewList`):
  - the way in as the switch «Вставити текст · Завантажити файл» (the
    shared `ModeSwitch`, the way chosen marked as pressed); «Як внести
    список» is its name for a reader alone — no radios, no legend;
  - the screen's one field: the list's lines, or the file's chooser;
  - «Звідки список (необов’язково)» and «Коли перелічено (необов’язково)»
    under the quiet «Ще про список» at the form's end, closed; a tap opens
    them, another closes them, their words kept and sent as before;
  - «Ще про список» opens by itself when what it holds would be saved
    unseen: a draft brought back with their words, a file read whole or the
    way switched while they hold words, and a refusal of them;
  - a refusal of them names them — «Список не збережено. Перевірте «Коли
    перелічено».» —, the lines too when they are refused with them
    («Перевірте рядки та «Коли перелічено».»), and, unsure of the send
    before it, «…, потім натисніть ще раз — двічі список не збережеться.»;
    a file's problems refused with them, the file's problems, then
    «Перевірте «…».»;
  - the switch held while the list is sent, as the file's chooser is.
- In passing: a file picked instead of another replaces the name and date a
  file filled, field by field, while nobody typed over them; a broken file,
  or one that fills nothing, picked between them changes nothing. Before, a
  broken file between them kept the first's name over the next one's.
- The draft keeps both fields as before; what is sent is as before.

## The independent review

An independent review (a fresh agent, the diff, the task list's point and
the rules entry; no conclusions handed to it) found:
- **High:** none.
- **Medium, fixed:** a name or date a file filled could be saved unseen
  once «Ще про список» was closed:
  - a second file that fills nothing kept the first's words;
  - a broken file between two whole ones kept the first's name over the
    second's;
  - a switch to typed lines kept the file's words.

  Before this batch these cases had the same outcome, but the fields were
  always on the screen. Now «Ще про список» opens by itself for a file read
  whole and for a way switched while they hold words. A file replaces what
  files filled field by field, so a file between them changes nothing.
  Journey steps cover all three cases, and there are mutants for each.
- **Low, fixed:**
  - a refusal of the lines and a field at once named only the field: now
    both, «Перевірте рядки та «Коли перелічено».»; a file's problems with
    a field's: the field named after them;
  - the unsure words read «… і «Коли перелічено» і натисніть»: now «…,
    потім натисніть ще раз»;
  - the journey's 422 mixed a domain error's shape with FastAPI's: now the
    server's own, `detail` alone;
  - untested: the unsure words, a file after the section was closed, the
    switch held while sending — journey steps and mutants now;
  - two CSS lines that did nothing (the form is no flex box) removed.
- **Low, left:**
  - the server's own check of a field that is blank by Python's rules but
    not by the phone's (`"\x1f"`, `"\x85"`) comes back with no field named:
    «Перевірте рядки.», the section closed — older than this batch, and
    out of reach of the phone's typing;
  - the switch's ways are pressed toggles, as «Яку ціну змінюємо» and «Що
    зробити»; «Яка модель» in «Нова модель» marks its way as the page — the
    app's form switches are not one in this (below, for the owner);
  - the dark theme's check is the width and a screenshot, not compared.
- **Checked and fine** (the review's words): the task list's point whole;
  the draft as before, a file's words out of the stored draft; what is
  sent, the unsettled, conflict and slow answers untouched; the refusal's
  detection against how the phone reads a 422; the disclosure as «Ще
  ознаки»; Telegram's MainButton and the dock untouched; the switch's two
  ways at 360; the helper with no race; no earlier rule contradicted.

## How it was built and proven

**Code:**
- `frontend/src/openings/Openings.tsx` (`NewList`, `newListRefusal`,
  `refusedExtra`).
- `frontend/src/styles.css`: `.opening-way`, `.opening-extra`.
- No backend change.

**Journeys:** 1089 in all; 1088 before.
- New (1): `openings` — «Новий список» at 360: the switch (its ways, the
  first pressed, no radio, no fieldset), one field, «Ще про список» quiet
  and closed, the two fields absent; light and dark, nothing past the
  width, «Ще про список» clear of the dock at the form's end; the file's
  way, its chooser alone, the typed lines kept for the way back; a tap
  opens and closes, the words kept; the way switched while they hold words
  opens it; refused for «Коли перелічено» — opened, the field named; the
  switch held while sent, no answer; unsure, refused for the lines and the
  field — both named, then the step; the draft keeping both, open by
  itself. The writes are the journey's own answers; no list is made.
- Changed: `openings` — the typed lists open «Ще про список» before
  «Звідки список»; a list kept on the phone comes back with it open and
  its words. `openings-file` — the switch pressed for «Завантажити файл»;
  the first file fills both and opens it; closed, a broken file, one that
  fills nothing (opened, the words kept), one with a name of its own (it
  replaces the first's), the first again (its own).

## Mutants

`mutate48.py`, 19 mutants, each applied alone, its journey run, the source
restored (`mutants48.sh`, the stand reseeded before the file journey's):
19 of 19 caught, each at the check meant for it.
- The switch (3): its ways not pressed; its name for a reader; a way that
  never changes.
- «Ще про список» (9): closed at the start whatever the draft holds; open
  at the start; not quiet; no `aria-expanded`; never closing; a file's
  words left closed; only a file that changes them opening it; the way
  switched leaving it closed; a refusal of its fields leaving it closed.
- The refusal (5): the field not named; the field not recognized; the
  lines not named with it; the unsure words; the switch not held while
  sent.
- The fill (1): what files filled kept as the last whole file's, not field
  by field.
- The one field (1): a second field on the screen.
- The first pass had 13, all caught; the review's fixes added six.

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1088 of
  1089 in 30.6 min. The one: `backups:93` — the stand's own (the additive
  seed's nights), as in every full run since batch 8.
- After the review's fixes, `openings` and `openings-file` on a fresh seed:
  27 of 27. The fixes touch `NewList` and these two specs alone.
- Seen at 360 × 640, light and dark (the journey's screenshots): the
  switch, the list's field and its hint, «Ще про список», the dock under
  it.
- Types: `tsc --noEmit` clean; the journeys' (`tsconfig.eslint.json`) 44
  errors, as on main — none in a file of this batch. ESLint clean; Prettier
  clean on every file touched but `styles.css`, unformatted on main and
  left so.

## Not covered

- A real phone; Telegram's MainButton over the form was not changed and is
  proven as before.
- The server's own refusal of a field blank by Python's rules (above).
- A file's problems refused with a field at once: the words are built,
  no journey stages it.

## For the owner

- **Done:** «Новий список» asks one thing on its screen — the list —, the
  way in a switch; where the list is from and when it was counted wait
  under «Ще про список». With it, every point of the five task lists after
  stage 2's audit is built.
- **To read** (decided here): «Ще про список» at the form's end; it opens
  by itself whenever its words would be saved unseen; a refusal names the
  field; the switch's ways as pressed toggles, as the form's other
  switches but «Яка модель».
- **Still open:** «Каса»'s and orders' refusals by В-П1 (batch 15); the
  «what to check» words (batch 15); «Закриття · Центр» (batch 12);
  «Продано»'s stub words (batch 13); the «Початкові залишки» hold line
  (batch 10); the readings of batches 16–18 (goods P1-2..P1-5, P2-4,
  each «нужно утверждение»).
