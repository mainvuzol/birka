# «Усе на бірці», audit 2026-11-13, batch 8: no «Змінити магазин» on a task's screen; a session's end in S02's words, kept said only where it is; one «not now»; Telegram's closing question for every kept operation and «Нова накладна»; a toast over the dock (frame P2-1, P2-6, P2-5 pp. 3, 5, money P2-6) — 2026-11-14

Baseline: `bc78ee43` (the audit's seventh batch, PR #208, merged). This
batch is the audit's next in its own order («merged, go next»): the frame
list's points that wait on no one — P2-1, P2-6, P2-5 pp. 3 and 5 — and the
money list's P2-6, which shares the closing question's one place in the
code. No request body, right or rule of what is recorded changes.

Status: built and proven in the journeys (the full run before the review's
fixes 1131 of 1132 — the stand's own `backups:93`; the 6 specs touched
again after them, on a fresh seed, 190 of 190); 29 of 29 mutants caught;
the review's findings fixed; not committed. Not yet seen on a real phone.
- Branch: `feat/audit-1113-frame-door`.
- Task: the audit's eighth batch, after #208's merge (2026-11-14).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-14 (audit
  2026-11-13, batch 8: …)".

Where it stood:
- On a task's screen — S21, the cash counted, an invoice paid, an order's
  goods back… — «Змінити магазин» stood held, at 45 %, taking about 130
  px of a 328 px line: S21's «Оксана Петренко · «Основний» · з 01.10»
  broke onto two lines, an order's goods back onto three.
- A 401 said «Сесія завершилась. Закрийте й відкрийте застосунок у
  Telegram. Незавершену команду збережено.» — not S02's words, and «kept»
  said where nothing was.
- The stocktake's finish sheet said «Ще ні» where every other confirming
  sheet says «Скасувати».
- Telegram let Бірка close with no question while a catalogue operation, a
  correction, a store's state, an invoice's operation or a supplier
  return was kept on the phone, or while «Нова накладна» was typed.
- A toast stood 16 over the menu wherever a dock was: outside Telegram,
  over an order's card's dock button.

## What exists now

- **No «Змінити магазин» on a task's screen** (frame P2-1;
  `frontend/src/App.tsx`, `frontend/src/shared/ScreenHeader.tsx`): the
  header draws the store's line alone, the whole width; «←» and Telegram's
  «Назад» the way out. S21's line one line at 360, an order's goods back
  two at most. Elsewhere as before: shown for two stores or more, held
  while an operation holds the store.
- **A session's end** (frame P2-6; `frontend/src/shared/api.ts`,
  `frontend/src/App.tsx`, `frontend/src/shared/CrashScreen.tsx`): «Сесію
  завершено. Закрийте Бірку й відкрийте знову кнопкою в боті.», and «
  Незавершене збережено.» only while this phone keeps a journal of the
  person signed in (`keepFor` after `/me`; `keptOnPhone` reads the keys'
  names alone). The crash screen reads the same keys through the same
  function, for anyone's. The stocktake's finish sheet: «Скасувати».
- **Telegram's closing question** (frame P2-5 p. 3, money P2-6;
  `frontend/src/App.tsx`, `frontend/src/catalog/commands.ts`,
  `frontend/src/suppliers/Invoices.tsx`): beside the eight journals it held
  for, a catalogue operation, a correction, a store's state, an invoice's
  operation and a supplier return — a first send on its way not counted;
  the catalogue's journal marks its first send (`firstSend`) as the shared
  journal does. «Нова накладна» asks while a supplier is chosen or a sum
  typed and it is not recorded.
- **A toast over the dock** (frame P2-5 p. 5; `frontend/src/shared/Toast.tsx`,
  `frontend/src/shared/panel.ts`): 16 over a bottom dock or panel that
  stands in its place, measured each frame while the toast stands, never
  past the screen's top; where the dock stands higher, in its flow, the
  toast keeps its place over the menu. The till's search held at the top
  is not a dock.

## The independent review

An independent reviewer read the diff cold (no Playwright, nothing
edited), during the full run. No High.
- **Medium, fixed:** the session journey's second and fourth steps
  expected the words already on the screen, so a regression ignoring whose
  key it is, or reading the orders' key alone, could pass — the steps now
  alternate «ended» and «kept», each waiting for its own answer, and a
  sale's key is the first «kept».
- **Low, fixed:**
  - `usePanelRoom` registered the till's top search as a dock, and a lift
    had no bound: the search is left out, the lift clamped on screen;
  - the menu's height read through `getComputedStyle` each frame — now
    from the root's inline style it is set in, nothing measured with no
    dock;
  - Toast's comment had the dock «higher up» on a short screen — on content
    shorter than the screen;
  - business-rules named «Нова накладна» a task's screen — only the
    payment is;
  - two orders-card checks lost the button's positive control — the card
    shows «Змінити магазин» before the task's screen hides it;
  - the catalogue's `firstSend` comment said a first send is «its form's
    to say» while its stub shows it — reworded to what it does: the
    closing question waits until its answer is lost.
- **Checked, no defect:** every task screen in `taskScreen`, «Ще»
  unreachable there; `cash.spec`'s held «Змінити магазин» a blocked
  screen, not a task's; S02's words exact; a 401 never `refusedOutright`,
  so a journal answered by one stays and «збережено» is true; all 13
  journal key formats matched, `birka:seen:` and the lists' keys never;
  `keeper` cannot go stale; strict mode; no other 401 words in the code;
  all 13 journals in the question; `firstSend` set with `pending` and
  cleared in `finally`; the question's holds ref-counted; «first send not
  asked» and «off the form» checks deterministic; the toast never lifted
  below its place, hidden docks skipped, before the first paint; docks
  never drawn in Telegram.

## How it was built and proven

- Journeys, new:
  - `catalog`: a proposal kept asks before closing, never while its first
    send is on its way, and lets it go once its check answers it;
  - `models`: the same for a correction, inside Telegram;
  - `stores`: the same for a store's state;
  - `supplier-invoices`: a payment kept asks off its own screen and after
    a reload, until its check; «Нова накладна» asks for a supplier chosen
    or a sum alone, never once recorded or left by «←»;
  - `suppliers`: a return kept asks off its form too, until its check;
  - `borrowed`: «Продано» kept asks, never while its first send is on its
    way, until its check;
  - `orders-card`: outside Telegram a toast 16 over the card's dock at 360
    × 640, and over the menu, under the dock, at 360 × 1600.
- Journeys, changed:
  - `credits-debt`: «Змінити магазин» on the till's list, none on S21; in
    both themes at 360 S21's line one line, wider than the 186 px left
    beside the button, screenshots as before;
  - `orders-card`: the card's «Змінити магазин» there, none on «Товар
    повернувся на склад»; its long line two lines at most;
  - `session` (real API): a 401 in S02's words; nothing kept, another
    person's or network's key — no «збережено»; this person's sale in
    another store, their order — «Незавершене збережено.»;
  - `people`, `first-sign-in`: the new words absent where they must be;
  - `stocktake`: the finish sheet's «Скасувати», no «Ще ні»; it closes,
    nothing finished.

## Mutants

`mutate56.py`, 29 mutants, each applied alone, its journey run, the source
restored (`mutants56.sh`): 29 caught, each at the check meant for it.
- No «Змінити магазин» on a task's screen (4): held there as before (S21,
  an order's goods back); gone everywhere; the line kept narrow.
- A session's end (7): the old words; «збережено» always; for anyone's
  key; the orders' key missed; the sales' keys missed; the person never
  known; «Ще ні» back.
- The closing question (14): a catalogue operation, a correction, a
  store's state, an invoice's operation, a supplier return not asked; the
  catalogue, a correction, a store's state and «Продано» asked during a
  first send; the catalogue's first send never marked; «Нова накладна»
  never asking, asking for a sum or a supplier alone, asking once
  recorded.
- The toast (3): never lifted; always lifted; the dock never registered.
- Left as equivalent here: the till's top search registered as a dock and
  the clamp (no screen shows a toast while the search sticks or a dock
  reaches the top); the frame-by-frame following (no journey moves a dock
  under a standing toast).

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1131 of
  1132 in 31.4 min. The one: `backups:93` — the stand's own, as in every
  full run since batch 8 of stage 2.
- Before it, the 11 specs this batch touches: 202 of 214 at first — the
  12 the stand's crowded seed (catalogue's «Лоран» not offered, the
  stocktake's model with an extra cell) and S21's width check, which
  measured the line's text against 300; on a fresh seed, with the check
  against the 186 px left beside the button, 110 of 110.
- After the review's fixes, on a fresh seed, `session`, `orders-card`,
  `stocktake`, `credits-debt`, `today`, `catalog`: 190 of 190 in 5.0 min.
- `finishold` first failed on the stand's crowded stocktake (`:336`);
  alone on a fresh seed, at its own check (`:527`).
- Journeys: 1132 by `--list` (1125 before).
- Types: `tsc --noEmit` clean (the e2e config's errors are main's);
  ESLint clean on every file touched; Prettier clean on what this batch
  changed — `credits-debt.spec.ts`, `App.tsx` and `Toast.tsx` are
  unformatted on main and left so outside this batch's lines.

## Not covered

- A real phone; Telegram's own closing question as the person sees it.
- frame P2-2…P2-4 (with money P2-4), P2-5 pp. 1–2 (the `enterKeyHint`
  guard, after goods P2-3 and orders-cash P2-3; haptics by S12, an owner's
  reading), P2-7 (В13-Т1); money P2-1, P2-4, P2-5 (б) (В13-Г2), P2-7
  (В13-Г1).
- A reading for later (review): the catalogue's kept stub shows during a
  first send, where the shared journals hide one; `firstSend` is read by
  the closing question alone.
