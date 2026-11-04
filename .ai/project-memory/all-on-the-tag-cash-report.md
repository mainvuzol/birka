# «Усе на бірці», «Каса» — 2026-11-03

Baseline: `9bd5c57` (#166, on main), and the sections task list
([P1-1, P1-2, P1-3](redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md),
their decisions and acceptance), with the spec's S25–S28.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/cash`. Task: the sections task list's P1-2, P1-3 and P1-1
as one (chosen in chat, 2026-11-03, «Yes, start «Каса»»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-03 («Каса»: the
count, its result, the drawer; sections P1-2, P1-3, P1-1)". The design's
questions stay «if no».

The evening count was a form: the phone's keyboard over the panel, «Так,
закрити» rising where «Закрити касу» had stood, the result two cards of
the old direction, «Видати з каси» a screen of its own that took the
seller off the count. Now the count is a task's screen with the app's
keypad and «Закрити касу» in the dock; «Так, закрити» is Telegram's
MainButton in a sheet that says the sum large; the result is a stub with
a sticker for the difference and the reason under the MainButton; «Каса»
is the ink tag and rows, and cash taken out or put in is a sheet over
whatever it was opened from. Still four taps and the sum; still blind
(G32); nothing changes on the server.

## What exists now

- **«Каса» (S25):** where the drawer stands in one line; «Закрити касу» /
  «Перший підрахунок» the ink tag — dark in both themes, cut corners, an
  eyelet ring, the title in the thread's lime, the whole tag one button;
  the rows as before, in their order, a chevron each.
- **The count (S26):** a task's screen — the menu away, «Змінити магазин»
  held, the phone kept upright, Telegram asking before closing while a sum
  is typed. «Підрахунок каси», «{Магазин} · {Ім’я} · 20:06» (the phone's
  time), the approved reminders, and in the dock «Скільки готівки в касі
  зараз», the keypad's display (56) and «Закрити касу», held until a
  figure is typed. The phone's keyboard never opens; a key that would make
  the sum not money does nothing. At 360 × 640 the keys come down to 44.
- **The confirmation (S27):** a sheet named «Закрити касу: у касі 2 000,00
  грн?», the sum large, «Змінити потім не можна.», «Скасувати», and
  Telegram's MainButton «Так, закрити», turning while the server answers
  (outside Telegram, the sheet's own button). A press sooner than 0.7 s,
  or a key held from «Закрити касу», is let go. Refused: the sheet goes,
  the dock says why, the sum kept.
- **The result (S28):** the check in its eyelet, «Касу закрито»; the stub
  — «Мало бути», «Порахували», the sticker «Нестача X» / «Надлишок X»
  (warning, the triangle) or «Збіглося до копійки» (the accent, the
  knot), a perforation, the card's and transfer's rows; its eyelet filled
  while a reason is owed, knotted once nothing is.
- **The reason:** the approved question, the three quick reasons as chips
  (the one in the field pressed), the field, «Поки причину не записано, …»
  and Telegram's MainButton «Записати причину» (held while the field is
  empty; outside Telegram, the dock's button). Written: the stub knots,
  «success» is felt, «Готово».
- **«Видати з каси» / «Внести в касу»:** a sheet with the kinds as chips,
  the sum, the note, «Коли?» for whoever corrects, and the app's
  «Видати 150,00 грн» (never the MainButton: it moves money). From the
  count, over the count, its sum kept.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the count is a task's screen, «Змінити магазин» held while it stands;
- «Впишіть суму» / «У касі 2 000,00 грн» are no longer said: the display
  shows the sum and the sheet says it;
- the keys at 44 under 700 px of height;
- the sticker is the stub's figure, 20 rather than 14;
- inside Telegram «Поки причину не записано, …» is a line with no dock;
- a reason owed waits while a sheet is open; a sheet goes with its screen.

## How it was built and proven

- **Files:**
  - `frontend/src/cash/Count.tsx`: S26 and S27, rewritten;
  - `frontend/src/cash/Closed.tsx`: S28, the stub and the reason;
  - `frontend/src/cash/Cash.tsx`: S25, the ink tag, the rows, the sheets;
  - `frontend/src/cash/Move.tsx`: a sheet;
  - `frontend/src/App.tsx`: the count as a task's screen;
  - `frontend/src/shared/Sheet.tsx`, `ScreenHeader.tsx`: a title with the
    sum in it, a line after the store's;
  - `frontend/src/styles.css`: the screens on the page, the ink tag, the
    dock, the stub's figures.
- **Journeys:** 877 in all (874 after #166).
  - **`cash-close.spec.ts`** (2 new): inside Telegram 8.0 — kept upright,
    closing asked, «Назад» over cash taken out keeping the sum, no
    MainButton on the count, «Так, закрити» its MainButton with a carried
    press let go and the turning shown, «Записати причину» held then
    ready, the buzzes; a reason owed that comes while «Видати з каси»
    stands, its result opening once the sheet goes; and on the new
    screens: the ink tag and rows, the keypad (a sum that is not money
    refused, 360 × 640 unscrolled, the cursor on the title), the sheet's
    name with the sum, «Скасувати» and Escape keeping it, a refusal said
    in the dock at 360 × 640, a read failing under the take-out's sheet,
    the stub with its sticker, the reason at 360 × 640, a double tap and
    a held Enter, both themes at 4.5:1 and the tag's ring at 3:1;
  - **`cash-move-fix.spec.ts`** (1 new): cash taken out and unanswered,
    its sheet closed while its row waits — the cursor on «Каса»'s title;
    and the cursor never lost once an unanswered one is confirmed;
  - **moved to the new screens:** `cash.spec.ts`, `cash-move-fix.spec.ts`,
    `cash-polish.spec.ts`, `cash-kept.spec.ts`; `fixtures.ts`
    (`closeSheet`, `confirmClose`, `moveSheet`).

## The independent review

An agent read the change cold (2026-11-03). It found no second send of a
count, no expected sum before the count, «Так, закрити»'s moment and the
reason's owner kept (G31, G12), the carried tap and the held key let go,
and the outcomes as before. What else it found, and what was done:
- **Fixed:**
  - a refusal of «Закрити касу» was said over the dock, which at 360 × 640
    stood over it: said in the dock now, over the keypad (the buzz
    journey, at 360 × 640);
  - the count opened with the cursor nowhere, the tag that opened it gone:
    on «Підрахунок каси» now; a refusal while the drawer is read again,
    «Закрити касу» held, lost it too: the title takes it then; and a sheet
    closing on a row that waits for its answer gives it to «Каса»;
  - the ink tag's focus ring was drawn under its face, and in light ink on
    ink: drawn over the face in the thread's lime now, at 3:1 or more on
    it in both themes (the themes' journey; seen on screenshots);
  - a reason owed that came while «Видати з каси» stood never opened its
    result by itself: it opens once the sheet goes (a new journey);
  - a drawer's read failing as the sheet opened over the count left the
    count at once, its sum lost: the count waits behind the sheet, and for
    the read that follows, and is left only if the drawer is still unread
    once both are done (the take-out journey). Found by the journey, not
    the review: the movement's answer closed the sheet while its own read
    of the drawer was still on the way.
- **Checked and left:** a sum of 9 999 999,99 грн, the most the keypad
  takes, is 316 px wide in the sheet at 360, inside it.

## Mutants

38 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate15.py`,
`mutants15.sh`): the count as a task's screen, upright, asking before
closing; the empty sum; the cursor on the title; the keys at 44; the
refusal in the dock; the carried press and the held key; the refused
sheet going; the sum in the sheet's name; the MainButton's turning; the
title as the fallback; the warning's buzz; the stub's state, sticker,
icon, check and top; the chips pressed; «Записати причину» held; the
reason's buzz; the ink tag, its chevrons and its ring; one banner, in
the sheet; the reason owed after the sheet; the count held behind the
sheet and through the read; the take-out's read; the sheet's fallback;
the movement's buzzes, cursor and one kind. All 38 are caught. Four were
not at first:
- the carried press let go by the confirmation is the MainButton's: the
  sheet already lets go of a pointer's, so the double tap's journey
  passes without it; Telegram's journey, which presses the MainButton as
  the sheet opens, catches it;
- the sticker's icon: the journeys now compare it with the set's triangle
  and knot;
- the count's `over`, a confirmation never shown under a sheet: the
  screen behind a confirmation is out of reach, so it could never be
  true — removed;
- «Каса»'s title as a sheet's fallback: a row waits only while a command
  is kept, and confirmed it is back before the sheet goes; the new
  journey closes the sheet while it waits.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-04): 876 of 877 pass
  in 17.9 minutes. `backups.spec.ts:78` fails only on this Mac, as on
  every batch before; CI runs it.
- Before that seed, `cash.spec.ts:216` and `:959` failed on a database
  this batch's runs had already closed for the day (one close a day):
  «Каса» showed that close. Both pass on the fresh seed.
- `tsc -b`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).
- The 38 mutants above, all caught.
- Screenshots, 360 × 640: the ink tag's ring in both themes; a refusal in
  the dock with the sum kept; sums up to 9 999 999,99 грн in the sheet.

## For the owner

Asked as the screens' words and places, each built by its «if no»
(business-rules.md, the heading above): «Впишіть суму» and «У касі
2 000,00 грн» no longer said on the count; the sheet's name «Закрити
касу: у касі … ?»; «Змінити магазин» held while the cash is counted.

## Not covered

- A real phone and Telegram's own web view: the screens at 360 × 640 are
  proven in Chromium's phone profile in both themes.
- The knot's tying under 600 ms is drawn, not timed by a journey.
