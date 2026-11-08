# «Усе на бірці», stage 2's eleventh batch: «Початкові залишки» — a line answered on its own task screen, «Зберегти й далі»; the lists as tags, the list's big tag with its progress, approval as the MainButton and a sheet — 2026-11-08

Baseline: `bdf9254d` (batch 10, PR #179, merged), and two points of the
stage-2 goods task list ([P0-5,
P0-6](redesign/2026-11-05-redesign-tz-stage2-goods.md)), their decisions
and acceptance.
Status: built; proof below — 983 journeys, every one passed after the
review's fixes but the Mac-only `backups.spec.ts:93`; 44 of 44 mutants
caught. CI is GitHub's, on the pull request. Not yet seen on a real
phone.
Branch: `feat/stage2-openings`. Task: the eleventh batch, chosen in chat
after #179 was merged (2026-11-08, «merged, go next»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-08 (stage 2 batch 11:
«Початкові залишки» — …; goods P0-5, P0-6)". The owner's question В-Г7
stands by its (а): what the line states stays chosen, drawn dashed with
«Прочитали в рядку» until touched, and the MainButton names what will be
recorded.

Where these screens still did their own way:
- A line was answered inside the list: «Розібрати рядок» unfolded a form
  of about fifteen things in the middle of up to fifty cards, the model's
  search, the sizes, the ways of counting, «Не товар» and the parser's
  notes; saved, the person scrolled to the next card and unfolded it.
  412 lines meant 412 unfoldings and as many scrolls.
- The lists: five lines of hint, a button, cards. A list: its meta, five
  filters in a row, up to fifty cards, «Показати ще», and «Затвердити
  список» at the end of the scroll.
- «Сьогодні»'s tag «Переглянути й затвердити» opened the lists, not the
  list it was of.

## What exists now

- **A line's screen (P0-5):** «Розібрати» on a row opens the line as a
  task screen, the menu aside: «Рядок 12 з 412», «Склад «…» · чекають N»,
  «← {список}» back to the list with nothing sent (Telegram's «Назад» too;
  both held while an answer is on its way).
  - The line as the paper wrote it, on paper; under it what the list says
    of its count, its photo and file, what was read, the parser's notes,
    the same text elsewhere in the list; a record that may be a range is
    asked as «Запис «42-44» — це:», nothing chosen for the person.
  - «Модель» (the catalogue's search, «Інша модель»), «Розмір» (the cells,
    «Розмір невідомий» last; the size read chosen, dashed, «Схоже на M —
    торкніться, щоб підтвердити»; the line's split offered as «Як у рядку:
    M 1 · L 2», never taken by itself), «Звідки кількість» as cards («Як у
    списку: 3 шт.» chosen, dashed, «Прочитали в рядку»), «Не товар» a
    toggle with its reason, «Пропустити» quiet.
  - The MainButton names the answer: «Зберегти й далі · M × 3 шт.», «… ·
    не товар», held as «Зберегти й далі» until the answer is whole; the
    last line in its filter says «Зберегти · …» and leads to the list's
    big tag. Outside Telegram, its own docked over the menu.
  - The next line of the same filter opens at once; the server is
    unchanged — the phone finds it among the lines read, then reads again
    and the next pages.
- **The lists (P0-6):** rows on tags — «{список} · склад «…»», «Розібрано R
  з L · не товар S», «Веде магазин …», the state's sticker, «Відкрити».
  «Новий список» is the MainButton; the new list is its own screen,
  «← Початкові залишки», «Зберегти список» its MainButton; its warehouse
  chips, the only one said and taken. Empty: one line, «Списки із зошита —
  рядок за рядком. Поки список чекає, склад не рухається.».
- **The list:** a big tag — the warehouse, the state, when counted or
  which store keeps it, «Розібрано R з L» over a bar, «Не товар S ·
  чекають N · U шт.»; files above the lines; a switch of three «Потребують
  уваги · Чекають · Розібрані», «Не товар», «Усі» and «Прибрані» behind
  ⋯; the lines as row tags with «Розібрати» or «Змінити відповідь».
- **Approval:** «Затвердити · 412 шт.» is the MainButton once nothing
  waits and the person may approve; it opens the sheet «Затвердити
  «{список}»?» — «412 шт.» large, «стануть початковим залишком складу «…».
  Скасувати це потім не можна.», «Так, затвердити»; a press within 0.7 s of
  its opening is let go.
- **«Сьогодні»:** with one list to approve, «Переглянути й затвердити»
  opens that list: three taps from «Сьогодні» to an approval, nothing
  scrolled. Several, the lists. From the list, «До списків», then
  «← Сьогодні».

## Decided here, not by the owner

All in business-rules.md under the heading above. In short:
- **The evidence on the line's screen, and on the row where the screen
  does not open** (an approver who does not answer lines, a list only to
  reject, a list decided): the reasons to reject are never behind a screen
  the person cannot open.
- **The split as the line shows it** is offered in «Розмір», not in
  «Звідки кількість».
- **«Не товар» a toggle;** «Змінити відповідь» stays the verb of an
  answered line — the TZ's one «Розібрати» would not say the answer is
  there.
- **«Розібрано» counts the answered;** «не товар» stands apart, and the
  bar fills with both, what is decided. The bar says it in words to a
  screen reader.
- **«Рядок N з M»:** M is the last line's number, numbers going on past a
  removed file.
- **The next line from what is read first,** the lines read again behind
  it: the screen does not wait for the server to say what the phone knows.
- **The list's first filter:** what needs attention, else what waits,
  else «Розібрані» — a list opened to approve shows its answers.
- **The MainButton** is not the approval's while lines are added by hand
  or under ⋯'s sheet.
- **The only warehouse is said and taken,** as at a delivery and a
  stocktake; a draft's warehouse no longer offered is no choice.
- **The approved stub keeps its sentence:** the TZ's «на «Основному»»
  needs a warehouse's name in the locative, which the app does not know.
- **From the list «Сьогодні» opened, «До списків»:** the list is under its
  lists.

## How it was built and proven

- **Files:**
  - `frontend/src/openings/Line.tsx` (new): the line's task screen,
    `LineEvidence` (on the screen and on rows whose screen does not open),
    the size cells, the ways of counting, the MainButton's words;
  - `frontend/src/openings/Openings.tsx` (rewritten): the lists as tags,
    the new list's screen, the list's big tag and progress, the switch and
    ⋯'s sheet, the row tags, the next line, approval and its sheet;
  - `frontend/src/openings/Parts.tsx`: the files as row tags;
  - `frontend/src/today/waiting.ts`, `Today.tsx`: the approval's tag
    carries the one list it opens;
  - `frontend/src/App.tsx`: the line's screen sets the menu aside; the
    list the tag opened, forgotten when the section is left;
  - `frontend/src/styles.css`: the screens above.
  - No backend change.
- **Journeys:** 983 in all (978 after batch 10).
  - **5 new:**
    - inside Telegram: «Новий список» and «Зберегти список» as the
      MainButton; none on a list whose lines wait; «Пропустити» sends
      nothing; «Зберегти й далі» held until whole; while an answer is on
      its way «Назад» hidden and doing nothing; back, the cursor on the
      row's verb; «Зберегти · не товар» on the last; the approval's
      button, a double press let go, ⋯'s sheet and «Додати рядки вручну»
      hiding it, then approving after the sheet is ready;
    - at 360 px, light and dark: the lists, the big tag and a line's
      screen within the width; the only warehouse said; the new list's
      heading focused and, back, the lists'; «Не товар 1 · чекають 2 · 0
      шт.»; the switch and ⋯; the paper's colour per theme;
    - 52 lines: the filter where lines wait, 50 rows, an answered line
      leaving it, «Рядок 2 з 52» focused, the 51st's «Зберегти й далі» and
      «Пропустити» reaching the 52nd past the page, its «Зберегти · L × 52
      шт.» back to the big tag at «Розібрано 2 з 52»;
    - «Сьогодні»: one list ready is three taps from its approval with no
      scrolling, «5 шт.» large in the sheet;
    - «Сьогодні»: two lists ready, the verb opens the lists.
  - **Rewritten to the new screens:** every journey of `openings.spec.ts`
    and `openings-file.spec.ts` — the line's screen for the inline form,
    the switch and ⋯ for the five filters, «Назад до «Початкові залишки»»
    for «Закрити», the evidence and the range's question on the line's
    screen, `aria-describedby` of the read size; the rights journey now
    answers its line first, so only the right hides «Затвердити»;
    «Сьогодні»'s verbs reach the list and come back.

## The independent review

A separate agent read the uncommitted change against the TZ, the rules,
the old screens and the server, with no access to my reasoning. Eleven
findings:

- **Fixed:**
  1. «Рядок N з L» divided by the lines left, which leaves out a removed
     file's: «Рядок 15 з 10» could be. Now by the last line's number.
  2. A restored draft whose warehouse was no longer offered showed the
     only other one, while the list would be sent for the old. A warehouse
     not offered is no choice now.
  3. The evidence had moved to the line's screen only, so an approver who
     does not answer lines, a list only to reject — the photo twice the
     usual reason — and a decided list showed none. The row keeps it
     where the screen does not open.
  4. With lines added by hand, Telegram's MainButton still said
     «Затвердити · N шт.». It is the form's then.
  5. Each «Зберегти й далі» waited for the lists, files and every page to
     be read again before the next line opened, and a later failure would
     have said «Немає відповіді сервера» of a saved answer. The next line
     opens from what is read; the reading goes on behind it, outside the
     answer's `try`.
  6. A failed re-read with rows present said nothing. It is said above
     the rows, and a failed next page lands on the big tag under it.
  7. A ready list opened from «Сьогодні» showed «Чекають» and «Тут рядків
     немає.». It opens on «Розібрані».
  8. «Новий список» flashed as the MainButton while the tag's list was
     read; the tag's path kept an old draft. Both gone.
  9. a11y: the new list opened with the cursor on the page — its heading
     now, and the lists' heading back; the bar said «3 з 3» where the text
     said «2 з 3» — `aria-valuetext`; «Назад» lost the visible name —
     «Назад до списку «…»», «Назад до «Початкові залишки»»; the dashed
     size was only seen — the hint is its description.
  10. `.opening-part` styled both file rows and answer parts — the answer
     parts are `.opening-alloc`; an unread ref removed.
  11. Journeys weaker than their titles: every answering journey switched
     to «Усі» first, and no page boundary was run — the 52-line journey;
     the rights journey asserted no «Затвердити» where readiness hid it
     anyway — it answers the line first; the double press depended on
     timing — the sheet is awaited, the second press let go, and a press
     after it is ready approves; the 360 px title said «a tap away each»
     — renamed.
- **Not changed:** the headings' levels as the screens have them; the
  split's radio in «Розмір», outside «Звідки кількість» (decided:
  «Розмір» is where the sizes are chosen); «Прибрати» on the extra size
  rows only, the first being the answer itself; no MainButton and no word
  when every line is «Не товар» — as at the baseline, the server's
  readiness.

## Mutants

44 mutants (`mutate28.py`, `mutants28.sh`): each one change to the source
— the dashed reading and its words, the size read and its hint, the
MainButton's words, held and progress, the next line (after, skipped, past
the page, back to the row or the tag), the menu aside, the heading's focus,
«Назад» held, the lists' and the new list's MainButton, the only warehouse
said and taken, the bar's words and its text for a screen reader, the
switch and ⋯, the approval's readiness, words, quiet under a sheet or the
hand-typed lines, the carried tap, the sheet's number, «Сьогодні»'s one
list and its reset, and every review fix — applied on a fresh seed, its
journey run, the source restored.

- First pass: 35 caught where their journeys say.
  - One survived: `opensone` (the tag opening the first of two lists).
    The journey's checks held while «Завантажуємо список…» stood under
    the same heading, before the list would open. It now waits for the
    lists' tags, four of them, and no big tag.
  - Eight proved nothing, the machine stalled beside `xcodebuild`: Vite's
    web server timed out (`moreword`), the browser never launched
    (`headfocus`, `mainactive`, `skipnext`), the API did not answer
    (`taskaside`, `mainprogress`), the search's rows never came
    (`backheld`) or a click never landed (`whatword`).
- Second pass of those nine, the Mac held awake: all caught, each at its
  own step — the last line's «Зберегти · не товар», the lists' count, the
  line's heading focused, «Зберегти й далі» held, «Рядок 2 з 3» focused
  after «Пропустити», the menu hidden, the progress shown, «Назад» hidden,
  «Зберегти й далі · M × 3 шт.». **44 of 44.**
- `advancerefresh` (the lines not read again after an answer) is caught
  by the next row's answer standing in the list, though the next line no
  longer waits for that read.

## Evidence

- **Runs** (`~/.cache/birka-runtime/helpers/`):
  - before the review, the three specs on fresh seeds: 15, then 5, then 2
    failures, every one a journey's expectation — a sheet's taps wait for
    its `data-ready`, «Сьогодні»'s tag below the parcels' (their reads
    stubbed empty), the one warehouse said rather than chips, the notes
    moved to the line's screen, «Закрити» become «Назад»
    (`go-b11-run1..3.log`);
  - after the review's fixes: `openings`, `openings-file` and `today` on a
    fresh seed, 62 of 62 (`go-b11-run4.log`); the two-lists journey again
    after its check was made stronger, 1 of 1 (`go-b11-td2.log`);
  - the last: every journey on a fresh seed, 982 of 983 in 25 minutes
    (`go-b11-full1.log`). The one failure is `backups.spec.ts:93`, which
    fails on the Mac only (the copies' clock: 14 nights where 3 are
    expected), as in every batch.
- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build`
  clean; Prettier clean on `Line.tsx`, `Openings.tsx`, `Parts.tsx`,
  `openings.spec.ts` and `openings-file.spec.ts`, and on my hunks only in
  `App.tsx`, `styles.css`, `Today.tsx`, `waiting.ts` and `today.spec.ts`,
  which are not clean at the baseline.
- **Screenshots** (Mac's font; CI's DejaVu checks the bounds), from the
  last run: `openings-lists-360-{light,dark}.png`,
  `openings-list-360-{light,dark}.png`, `openings-line-360-{light,dark}.png`.
  Seen: the lists as tags with «Розібрано 0 з 3 · не товар 1» and the
  docked «Новий список» over the menu; the big tag with the bar a third
  full (the line not stock) over «Не товар 1 · чекають 2 · 0 шт.»; the
  line's screen with the menu gone, the line on paper, the cells and
  «Зберегти й далі» held. Small things seen: a long list name runs to two
  lines in the line's «←» and to seven in the list's title at 360 px;
  «Змінити магазин» stays on the line's screen.

## For the owner

Nothing new to ask. В-Г7 was taken at its (а); the decisions above are
theirs to overturn, each in business-rules.md.

## Not covered

- A real phone: Telegram's MainButton between lines, the keyboard over the
  model's search, the line's screen at 412 lines.
- CI's font: the 360 px bounds are checked on GitHub's run.
- A draft's warehouse no longer offered has no journey: it needs a
  warehouse closed under a kept draft.
- A failed re-read with rows present, and «Розібрані» as the first filter
  of a list opened to approve, have no journey of their own.
- The rest of the goods list: P1-2 («Моделі») and P2-5; money P1-1;
  `Borrowed.tsx` and `Invoices.tsx` still search their own way.
