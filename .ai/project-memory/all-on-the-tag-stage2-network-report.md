# «Усе на бірці», stage 2's seventh batch: the network's screens — «Магазини» as tags with a screen per store, a state's change in a sheet, «Резервні копії» as one verdict; the door with no store — 2026-11-07

Baseline: `fc73d558` (#175, on main), and the stage-2 admin task list's
points that were left ([P0-3, P0-4, P0-5, P2-3](redesign/2026-11-05-redesign-tz-stage2-admin.md)),
their decisions and acceptance. P1-1 was built with the quick wins (#170);
P2-1 and P2-2 build nothing by their (а). With them that task list is built
whole.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-network`. Task: the seventh batch proposed after #175
(chosen in chat, 2026-11-07, «Network screens»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-07 (stage 2 batch 7:
…)". The owner's questions stand by their (а): В-А3 (a store a screen of
its own), В-А5 («Цей розділ бачить лише власник.» stays), В-А6 (no state
line under «Магазини»), В-А4 (the archive's words as now), В-А7 (the
reason's hint as now).

Where these screens still did their own way:
- «Магазини» was a hint of four sentences over cards, each with every
  button of its state and a folded «Історія змін»; all the switches of all
  the stores at once.
- A state's change was asked inline under the card, its refusal and its
  result plain paragraphs over the list.
- «Резервні копії» was a hint of two sentences over four blocks of the same
  weight — the verdict, «Стан сервера», «Сповіщення в Telegram», «Останні
  ночі» — and «Завантажуємо стан копій…» while loading; Telegram's line
  looked the same whether the bot could write or not.
- With no store at all, the door said «Доступних магазинів немає.
  Зверніться до адміністратора.» — a word the app no longer uses.

## What exists now

- **«Магазини» as tags (P0-3, В-А3 (а)):** the door's tags, one a store —
  its name, its code, and for one that does not trade its sticker,
  «Заблоковано з 12.10»; read «Магазин Ринок, Заблоковано з 12.10»; a
  tap a light «selection» buzz. A store's own screen: «← Магазини» and
  Telegram's «Назад» back to the list (its heading taking the cursor), then
  to «Ще»; the big tag with «Причина: …» while it does not trade;
  «Історія змін» as a thread, newest first, every node a knot; the state's
  buttons at its foot, ordinary, «Закрити в архів» the quiet one. Two taps
  from «Ще» to «Заблокувати». The section opens at its top.
- **A state's change in a sheet (P0-4):** «Заблокувати «Ринок»?» and its
  kin; what it means; «Причина» with «Її бачите ви й менеджери мережі, не
  продавці.» under it; «Так, …» dark with no reason, or once the change is
  no longer offered. Sending holds every way out. A refusal stays in the
  sheet, the reason kept, the cursor on why — the archive's with what is
  left, «… · N шт.»; a warning buzz for «not empty», an error for the rest.
  Recorded: the sheet closes, the stub tears off on the store's screen —
  ««Ринок»: заблоковано.», «14:05 · Причина: Ревізія каси» — the cursor on
  it, a success buzz. A lost answer: «Незавершена зміна стану» on the list
  and on every store's screen, with since when, checked by its button
  alone.
- **«Резервні копії» as one verdict (P0-5, В-А5 (а)):** one big tag first,
  its title the largest words on the screen, its eyelet a knot when the
  copies are in order and filled in the warning's colour otherwise; under
  it what the verdict rests on. Then each trouble open on the server a row
  that waits, a quiet watcher a row, otherwise «Стан сервера · …» one
  line; the week's past troubles one line opening a sheet; Telegram a row
  only when it refused or failed, otherwise one line. «Останні ночі» a
  thread. The explanation one line at the foot. A skeleton while loading.
  The screen opens at its top.
- **The door with no store (P2-3):** one blank tag under the app's name —
  «Магазинів поки немає», «Зверніться до власника.», «Спробувати ще раз».
  The kept change's corrupt entry: «Збережену зміну стану магазину не
  прочитати. Перевірте стан магазину в списку.»

## Decided here, not by the owner

All in business-rules.md under the heading above: the tag's spoken name;
the history's day only; the kept change never checked by itself and shown
with since when; refusals in the sheet and their buzzes; the stub's time
and reason; «Так» dark once the change is not offered; «Спробувати ще раз»
on the door with no store; the corrupt words; no caption over what is
wrong now; Telegram's rows no longer alerts; the PENDING line; the FAILED
verdict without the night's own line; the nights' meta; the verdict at 34
over the title's 28; past troubles in a sheet; the skeleton; the
explanation always at the foot; each section of this batch opening at its
top; the review's fixes below.

## How it was built and proven

- **Files:**
  - `frontend/src/stores/Stores.tsx` (rewritten): the list of tags, the
    store's screen, the sheet, the stub, the kept stub's words, the cursor;
  - `frontend/src/stores/commands.ts`: the corrupt entry's words;
  - `frontend/src/backups/Backups.tsx` (its screen rewritten; its exports
    for «Сьогодні» kept): the verdict, the rows, the lines, the sheet, the
    thread, the skeleton;
  - `frontend/src/App.tsx`: the door with no store; the stores' buttons
    held over an unreadable kept change;
  - `frontend/src/shared/journal.ts`: an entry cut short read as corrupt,
    for every journal;
  - `frontend/src/styles.css`: the stores' list and screen, the sheet's
    hint and refusal, the backups' verdict, rows, lines and thread; the
    unused `.badge.failed` removed.
  - No backend change: every read and command is the one before.
- **Journeys:** 958 in all (949 after #175).
  - **9 new:**
    - «Магазини» as the door's tags, a store's screen two taps from «Ще»:
      Telegram's «Назад» to the list and «Ще», the tap felt, the history a
      thread of knots, ordinary buttons, the keyboard;
    - the light and the dark theme at 360 × 640: five stores' tags (two
      long-named), a store's screen and its sheet at 4.5:1, nothing wider
      than the phone, the section at its top;
    - a change made meanwhile elsewhere: refused as done already, felt as
      an error, «Так» dark;
    - no store to choose: the blank tag, «Спробувати ще раз» letting in
      once a store is added, never «адміністратор»;
    - a kept change the phone cannot read: the words, the cursor; one cut
      short too; found so as the app opens, the buttons held;
    - the light and the dark theme at 360 × 640: the verdict first and
      largest with the first row of what is wrong in view above the menu,
      every line at 4.5:1, nothing wider than the phone, the past
      troubles' sheet;
    - the skeleton while the state is on its way, read as loading,
      «Оновити» waiting.
  - **Rewritten or extended:** `stores` (the block in a sheet: its
    refusal in the sheet with the cursor and an error buzz, held while
    sending, the answer said with the list's read held, the stub and its
    cursor, a success buzz; the archive's refusal with «· N шт.» and a
    warning buzz; the archived store reopened; the lost answer as a stub
    on the screen and the list, never «UNREACHABLE», a check answered with
    no proof in the shared words; the debt journey opened outside
    Telegram 8.0, where «Внесок» is the page's own button), `session`
    (a seller's blocked store reached through the sheet), `backups` (the
    verdict's eyelet in each state, Telegram's row and lines, the nights'
    nodes, the explanation), `failures` (the server's rows, the watcher's
    line and row, the past troubles' sheet and its cursor back).

## The independent review

An agent read the change cold (2026-11-07). Nothing lost a change or sent
one twice through the journal, but it found:
- **Fixed:**
  - Recorded or refused, `change` waited for the list's read before the
    sheet heard the answer: for one round trip «Так» was there again, the
    reason still typed — a second press sent a new command. The answer is
    said at once now; the read runs behind it.
  - A lost answer showed `UNREACHABLE` as an alert beside the kept stub,
    and a check answered with no proof said nothing. Filtered as every
    kept command's words, in the owner's form.
  - The stub, the kept stub and the corrupt alert came in under the
    sheet's inert page, and stood before the store's tag, where focus on
    the name never led a reader; a refusal left the cursor on a held
    button. The cursor goes to what is said now.
  - A kept entry cut short raised the parser's English words through the
    journal; it is read as corrupt now (every journal).
  - An unreadable kept change found as the app opens left «Заблокувати»
    open, to fail after a reason was typed; held now.
  - Journeys that would have missed these: no alert beside the lost stub,
    a frame before «held while sending» is read, the answer with the
    list's read held.
- **Recorded, left as built:** a check pressed on another store's screen
  tears its stub there (it names its store); «Спробувати ще раз» on the
  door with no store says nothing when there is still none, as the closed
  store's tag does; at 360 px with the keyboard up, the sheet's «Так» in
  view cannot be checked by a journey.

## Mutants

49 mutants (`mutate24.py`, `mutants24.sh`, log `go-mutants24.log`), each
applied alone and run against the journeys meant to catch it: all 49
caught.
- **«Магазини» (P0-3):** the tag's buzz; its spoken name without the
  sticker; its code; the sticker without its date; the list not opening at
  its top; the list's heading not taking the cursor back; the name not
  taking it on a store's screen; «Причина» under the sticker; the thread's
  knot; the archive's button not quiet; a state's button in the action's
  colour.
- **The sheet (P0-4):** closed while sending; «Скасувати» not held; «Так»
  open with no reason, or once the change is not offered; a refusal
  closing the sheet; the cursor not on it; a warning for every refusal, or
  for none; no success buzz; the stub without its time; the reason's hint
  not its description; what is left without «шт.»; the kept stub missing
  from the list, or without since when.
- **The review's fixes:** the answer waiting for the list's read; the
  cursor not on what is said; «UNREACHABLE» shown; the kept stub's why
  missing; an entry cut short read by the parser; the buttons open over an
  unreadable entry found at opening.
- **P2-3:** no blank tag with no store; no «Спробувати ще раз» on it; the
  old «Некоректн… Зверніться до…» words.
- **«Резервні копії» (P0-5):** the verdict's eyelet filled when in order,
  or a knot when not; its title not the largest; the screen not at its
  top; Telegram's refusal a line, not a row; its last message without
  «останнє»; nothing said when no message was ever sent; the in-order line
  not joined by «·»; the open troubles' list unnamed; «проблем не
  помічено» missing; the quiet watcher's row not the watcher's; the past
  troubles' sheet not opening; a failed night's node a knot; the
  explanation's second sentence; the skeleton not read as loading.
- **Two survived the first run and were caught once their journeys were
  tightened:** the tag's buzz (the journey also heard «Ще»'s own before
  it — now only those after the tag's tap count) and the list's top (a
  first visit draws the list short while it loads, so the browser puts the
  page at its top anyway — the journey now opens «Магазини» a second time,
  read already, from «Ще» scrolled to its foot).
- **Not mutated:** colours in CSS (the 4.5:1 checks read the result, not
  the token); the confirm's pressed look while sending.

## Evidence

- **Every journey on a fresh seed:** 957 of 958 passed in 22.4 min
  (`go-full24.log`). `backups.spec.ts:93` (was :78) fails on the Mac alone
  as before and passes on CI: the seed is additive, so this database holds
  14 nights where CI's fresh one holds the seed's 3.
- **The specs this batch touches** (`stores`, `session`, `backups`,
  `failures`, `more-lines`, `till-sections`, `today`): 16 of 16 for
  `stores` and `session` after the review's fixes; 91 of 94 for the other
  five before them on the crowded database — `backups:93` as above, and two
  `today` journeys (:1419, :2261) that passed alone straight after and in
  the full run.
- **The checks:** `tsc -b`, `eslint src e2e` and Prettier (whole files; my
  own hunks in `App.tsx` and `styles.css`) are clean. No backend change.
- **CI on #176 (head e676e2e2):** the end-to-end check failed on two
  journeys this batch does not touch. Both had failed on main's runs
  before (42351148961, 42279273576, 42250523233, 42179022979). Both were
  steadied in the journeys alone, with nothing they prove taken away:
  - `orders-new.spec.ts` «a new order whose answer never came»: its stub
    lost only the first `POST /orders`. On CI's slower runner any other
    read's answer made the phone check the order by itself first
    (ADR-0013 §4.3), so «Перевірити результат замовлення» was disabled,
    then gone, before the journey could press it. The stub's new
    `loseAll` loses every answer until the press. The journey then checks
    that every body sent was the same command byte for byte, with
    nothing only shown in it. Before, it checked exactly two bodies. The
    warning is still felt once. «The MainButton pressed over the sheet
    «У замовленні»» used the same single loss and now uses `loseAll`
    too.
  - `today.spec.ts` «at most twenty reads…»: «Tearing down "context"
    exceeded the test timeout». The trace shows two warehouse reads
    still in their `route.fetch` when the fixture's
    `unrouteAll({ behavior: "wait" })` began. The first to finish
    made Playwright 1.63 drop the page's interception, and the second
    request went on to the server unrouted. Its handler's late `fulfill`
    then failed «Route is already handled!», and the wait never ended.
    The journey now ends only once every read it saw asked has been
    answered (`answered()`, from `requestfinished` / `requestfailed`).
  - Run locally six times each (`--repeat-each 6`): 18 of 18. `tsc -b`,
    `eslint src e2e` and Prettier on my own hunks are clean.

## For the owner

Nothing new to ask: the store's own screen is В-А3 (а), the copies'
explanation В-А5 (а), «Магазини» with no line in «Ще» В-А6 (а), the
archive's words В-А4 (а), the reason's hint В-А7 (а). What was decided
here is in business-rules.md under the heading above. Words were not
changed except where the task list said so (the door with no store, the
corrupt entry, the copies' lines).

## Not covered

- **A real phone:** Telegram's «Назад», the buzzes and a reader's speech
  are checked by their stubs and the accessibility tree in Chromium, not
  on a phone or with VoiceOver / TalkBack.
- **Sections opened from a scrolled «Ще»:** this batch's two open at their
  top. The app's other sections do not reset the scroll as they open: one
  already read (drawn whole at once) and taller than «Ще» can open part-way
  down. A frame-wide reset is not part of this task list.
- **The rest:** the admin task list is built whole; the money task list's
  P1-1 and the others wait for the next pick.
