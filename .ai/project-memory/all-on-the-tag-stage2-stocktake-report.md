# «Усе на бірці», stage 2's eighth batch: «Інвентаризація» — its entry, start and end in the tag's system; counting by the model's tag — 2026-11-07

Baseline: `90fd7e71` (#176, on main), and the stage-2 goods task list's
first two points ([P0-2, P0-3](redesign/2026-11-05-redesign-tz-stage2-goods.md)),
their decisions and acceptance.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-stocktake`. Task: the eighth batch, chosen in chat
after #176 (2026-11-07, «Goods: «Інвентаризація»»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-07 (stage 2 batch 8:
«Інвентаризація» — …; goods P0-2, P0-3)". The owner's questions stand by
their (а): В-Г3 (no one-tap «Збігається» — the number is always typed),
В-Г5 (no server change: the phone glues a model's sizes into one tag, the
models in the server's order).

Where these screens still did their own way:
- The entry was notices: «Продовжити інвентаризацію» in a plain box, «Почати
  інвентаризацію» asked inline under it, the finished ones as plain
  articles.
- Counting stayed under the menu, under «Інвентаризація: …» and a hint;
  «Не пораховані · Пораховані» a radio group; each position a row of its
  own with its own field, the phone's keyboard opening over the dock; a
  model of four sizes four rows, four fields and four «Записати».
- The end was asked inline at the foot of the list, its sums plain text;
  the result a heading and paragraphs.

## What exists now

- **The entry (P0-2):** the warehouses as before; the open stocktake a row
  tag, its eyelet live, «Триває з 10:20 · Тетяна», «Пораховано 34 ·
  нестача 2 шт. · надлишок 1 шт.» and «Продовжити», felt lightly. None
  open: Telegram's MainButton «Почати інвентаризацію» (the dock's own
  outside Telegram). «Попередні» a thread, newest first — the day, a knot,
  «Нестача 2 шт. · надлишок 1 шт. · не перевірено 140», who finished and
  when — the last three and «Ще N»; «Показати розбіжності» kept.
- **The start (P0-2):** a sheet «Почати інвентаризацію складу «…»?», its
  text as before, Telegram's «Почати» (a press carried from the opener let
  go), «Скасувати». Started: a success buzz and straight to counting — two
  taps. Refused: in the sheet, as before, an error buzz.
- **Counting, a task's screen (P0-3):** the menu aside, the phone kept
  upright; «Інвентаризація · «…»», «Почато о 10:20 · Тетяна»,
  «← Інвентаризація» and Telegram's «Назад» back, «Завершити» quiet at the
  title's right. «Не пораховані N · Пораховані N» as the stocktake's own
  sums. A tag a model, a cell a size — the letter, «в обліку 3», the pin
  badge with what orders hold, «?» for a size not known — in the
  organization's order of sizes. «Пораховані» rows, newest first — «… · M —
  3 → 1 (−2)» or «… — 3, збігається», who and when — each «Перерахувати».
  «Знайшли товар, якого немає в списку» as before, its position a cell.
- **The count's sheet (P0-3):** «Марсель молочний · M», «В обліку 3 ·
  склад «…»», the reserve's hint; the app's keypad for pieces («Фактично,
  шт.», no comma, five figures, the phone's keyboard never open); «3 → 1 ·
  −2» as typed, a shortage in the warning's colour; Telegram's «Записати ·
  1 шт.»; closing asked while a number is typed. Recorded: a light buzz,
  on to the model's next cell, round, closing after the last — five taps
  and four numbers for four sizes; «Записано: …» in the sheet while it goes
  on, a toast once it closes. Refused: a warning buzz, the sheet stays, the
  keypad empty, why in the words of before. Lost: the kept count's stub,
  as before.
- **The end and the result (P0-2):** «Завершити інвентаризацію складу
  «…»?» — «Нестача» and «Надлишок» large in pieces (or «Розбіжностей
  немає»), what is not checked, the text about after and the bot as
  before; Telegram's «Так, завершити», «Ще ні». The result: its title with
  the check, «Склад «…» · {who}», the stub knotted — «Пораховано позицій:
  N», «Нестача 2 шт. · 1 позиція», «Надлишок 1 шт. · 1 позиція», what is
  not checked — the differences, five and «Ще N»; «До інвентаризації».
- **No right, no server rule and no command changed.** No «од.» anywhere
  in it.

## Decided here, not by the owner

All in business-rules.md under the heading above: the live eyelet's
colour; «Триває з …» and the history's words, time and «Показати
розбіжності» kept; the warehouse's name not declined in the sheets'
titles; the phone kept upright while counting, not on the result; the
models' positions glued across pages read; the sizes' order only where it
may be read, an unknown size last; the list kept while the order is read
and read again from its top after each count; the found goods' own cell;
«3 → 1» in «Пораховані» from the stocktake's own change; the sheet's title
with the name whole; the next cell round from the one counted; «Записано»
in the sheet while it goes on, a toast only after it closes by itself;
«Розбіжностей немає» large; the result's line; the review's fixes below.

## How it was built and proven

- **Files:**
  - `frontend/src/inventory/Stocktake.tsx` (rewritten): the entry's open
    tag, «Попередні» and its differences, the start's and the end's
    sheets, the counting screen, the tags and cells, «Пораховані» rows,
    the count's sheet, the found goods' cell, the result's stub; the
    refusal words and the kept count's words kept as they were;
  - `frontend/src/inventory/Stocktaking.tsx`: counting a task's screen of
    its own in place of the entry, the menu aside;
  - `frontend/src/shared/Keypad.tsx`: `pieces` — no comma (its place
    empty), five figures, typed digits only;
  - `frontend/src/shared/ScreenHeader.tsx`: `context`, the line's words
    in place of the store and the person;
  - `frontend/src/App.tsx`: `stocktakeTask` in the task screens;
  - `frontend/src/styles.css`: the open tag's live eyelet, the history,
    the modes, the cells, the counted rows, the sheet's lines, the
    finish's sums.
  - No backend change: every read and command is the one before.
- **Journeys:** 961 in all (958 after #176).
  - **3 new:**
    - inside Telegram 8.0, a model of four sizes listed out of order: one
      tag, its cells in the organization's order at 360 px, wrapping 8 px
      apart; «Почати інвентаризацію» and «Почати» Telegram's, a press
      carried from the first let go; the menu aside and the phone kept
      upright; M tapped first — its reserve refused with a warning buzz,
      then counted — L, XL and round to S, five taps and four numbers, the
      status line «Записано: … Далі: L.», a light buzz each, the bodies'
      counts and balances; the size not known only counted down;
      Telegram's «Назад» closing the sheet alone, the last toast not back;
      «Пораховані» newest first and «Перерахувати»; the open tag on the
      entry; the light and the dark screenshots;
    - a long count inside Telegram: fifty-two positions read fifty at a
      time, «Показати ще» held while the list is read again, a model
      across two pages one tag once both are read, the cursor on the next
      model after a model's last cell, a cell counted meanwhile by someone
      else passed, the finish's MainButton, the result's «До
      інвентаризації» letting go a press carried onto it, the entry's
      history after it;
    - «Попередні» three and «Ще 2»; a finished one's differences five and
      «Ще 2», in the words of before.
  - **Rewritten:** the main journey on the real server (the start refused
    twice in its sheet, the task screen, the cell's sheet and the pieces'
    keypad, «3 → 1 · −2» in the warning's colour, a refusal emptying the
    keypad, the toast, the cursor on the title and on «Знайшли товар…»,
    found goods counted by their cell — once against nought, once held —
    the bodies sent, the finish's sums large, a refused finish read again,
    the result's stub and differences, the history, the model's grid);
    sold while counted; a kept count (its stub on the counting screen,
    «Завершити» and the cells held, the menu aside); the rights; a balance
    read again while the sheet is open.

## The independent review

An agent read the change cold (2026-11-07). Nothing lost a count, sent one
against a wrong balance or took a refusal's words away, but it found:
- **Fixed:**
  - The last sheet's toast came back once another sheet was closed by
    hand, or its answer lost: the toast was only hidden while a sheet was
    open. It is gone as the next sheet opens.
  - After a model's last cell the cursor went back to the tapped cell,
    which left with its tag as the list was read again — or, the cell gone
    with its own count, to the title far above. It goes to the next
    model's first cell now, the title only when none is left. After goods
    found it went to the title, the page jumping to its top; it goes to
    «Знайшли товар…» now.
  - «Показати ще» pressed while the list was read again cancelled that
    read and read the next page from where the old pages ended, past a
    position that moved up. It waits for the read now, and is not shown
    under a read that failed.
  - The sheet's status line came onto the page with its words, which a
    reader often does not hear, and the title moved to the next cell
    without a word. The line stands from the start; a reader hears «Далі:
    L.» after it.
  - The sheet went on to a cell someone else had counted meanwhile. It
    passes a cell the list no longer holds as not counted.
  - «До інвентаризації» stood where «Так, завершити» was pressed: a
    double tap left the result unseen. A press sooner than 0.7 s is let
    go, as «Почати»'s and «Так, завершити»'s are.
  - The start's sheet, refused because one had opened elsewhere, sent the
    cursor back to a button gone with it; it goes to «Продовжити» now.
  - The journey's carried press waited for the MainButton at the
    default poll's pace and could miss the 0.7 s on a slow runner; it
    polls every 10 ms now.
  - Journeys that would have missed these: none read the next page, glued
    a model across pages or opened the folds; they do now (above).
- **Recorded, left as built:** offsets shift when someone else counts
  between two reads of the next page — the list is read again from its top
  after each count of one's own, as the server pages it.

## Mutants

In progress: 62 mutants (`mutate25.py`, `mutants25.sh`), each applied
alone and run against the journeys meant to catch it, on a fresh seed each
time — the real server's journeys leave a stocktake open and its stock
moved, and could not run twice on one. 44 run so far: 42 caught. Two
survived, and their journeys are being tightened:
- `nextskip` — the sheet passing a cell already recorded in it relied on
  the list being read again before the next count; no journey counted two
  cells of a model while that read was late.
- `moved` — counting against the balance the server named in its refusal
  was never needed, because the list read again already showed it; no
  journey kept the old balance on the list.

## Evidence

So far:
- **The stocktake journeys:** 9 of 9 on a fresh seed after the review's
  fixes.
- **The neighbouring journeys that open «Інвентаризація»** (`correct`,
  `model`, `telegram-back`, `people`, `person-limit`, the stocktake ones
  of `outage`): 33 of 33, before the review's fixes, which touch only the
  stocktake's own screen.
- **The checks:** `tsc -b`, `eslint src e2e` and Prettier (whole files;
  my own hunks in `App.tsx` and `styles.css`) are clean. No backend
  change.
- **Every journey on a fresh seed:** next.

## For the owner

Nothing new to ask: one tap never records «Збігається» (В-Г3 (а)), and
the server is unchanged — the phone glues a model's sizes into one tag
(В-Г5 (а)). What was decided here is in business-rules.md under the
heading above. The words of refusals, of the start's sheet and of the
finish's bot line were not changed.

## Not covered

- **A real phone:** Telegram's MainButton, «Назад», the orientation lock,
  the buzzes and a reader's speech are checked by their stubs and the
  accessibility tree in Chromium, not on a phone or with VoiceOver /
  TalkBack.
- **The rest of the goods task list:** P0-1, P0-4, P0-5, P0-6, P1-1…P1-4,
  P2-4 and P2-5 wait for the next pick (P1-5, P2-1…P2-3 were built with
  the quick wins).
