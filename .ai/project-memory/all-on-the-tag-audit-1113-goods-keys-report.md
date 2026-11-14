# «Усе на бірці», audit 2026-11-13, batch 9: every field's Enter as its key says, a size cell lets the keyboard go, and the guard; «Товар»'s last plain empties and reads; a rejected list's stub (goods P2-3, P2-1 without its two new lines, P2-4, frame P2-5 p. 1) — 2026-11-14

Baseline: `df1419ff` (the audit's eighth batch, PR #209, merged). This
batch is the audit's next in its own order («merged, go next»):
- the goods list's quick wins that wait on no one (its §8): P2-3, P2-1
  without its two new lines, P2-4; P1-2 part 1 was built in batch 4;
- the frame's P2-5 p. 1, the `enterKeyHint` guard, which waited on goods
  P2-3 and orders-cash P2-3.

No request body, right or rule of what is recorded changes.

Status: built and proven, not committed, not yet seen on a real phone.
- The 8 specs touched, after the review's fixes and on a fresh seed:
  151 of 151.
- The full run before the fixes: 1135 of 1137. One failure was the
  stand's own `backups:93`; the other was a race in a new journey, since
  fixed.
- After the fixes the whole suite is left to GitHub CI, by the user's
  word.
- Mutants: 34 of 34 caught.
- The review's findings are fixed.
- Branch: `feat/audit-1113-goods-keys`.
- Task: the audit's ninth batch, after #209's merge (2026-11-14).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-14 (audit
  2026-11-13, batch 9: …)".

Where it stood:
- 32 fields had no label on their Enter key:
  - the delivery, the correction, «Ще ознаки», a list's line;
  - the rename sheet, «Ще про список», «Додати рядки вручну»;
  - the suppliers' sheet and their return;
  - six fields of several lines.
- Off a form, Enter did nothing. A size cell of «Нова модель» or of a
  list's line left the keyboard up.
- No rule kept a new field from coming without one.
- Five of «Товар»'s empties were a plain line: «Тут рядків немає.» and
  three «no warehouse». One visible «Перевіряємо, чи на складі не чекає
  список…».
- The models' search, read for the first time, was blank.
- Two texts were off:
  - «Нічого не знайшли за «…».» had a full stop;
  - a stocktake's warehouse lost said «… зі списку», with no list there.
- A rejected list was a plain line under the approved one's stub.

## What exists now

- **Enter as its key says** (goods P2-3, frame P2-5 p. 1;
  `frontend/src/shared/enter.ts`, and the fields in
  `frontend/src/inventory/Receive.tsx`, `Correction.tsx`,
  `frontend/src/catalog/NewModel.tsx`, `Models.tsx`, `Catalog.tsx`,
  `frontend/src/openings/Line.tsx`, `Openings.tsx`, `Parts.tsx`,
  `frontend/src/suppliers/NewReturn.tsx`, `SupplierList.tsx`,
  `frontend/src/damaged/Damaged.tsx`):
  - every one-line field says «next», «done» on the last; a field of
    several lines «enter».
  - Off a form, `enterGoes` does what the key says:
    - «next» puts the cursor in the next field its sheet or screen
      shows, past buttons, choices, a date, a read-only field and the
      app's keypad;
    - «done», or no field after it, puts the keyboard away, the cursor
      left on its sheet, where Escape still closes it;
    - nothing is sent.
  - The fields that take it:
    - the delivery's size counts, price and note;
    - a supplier return's counts and note;
    - a supplier's sheet, and a new supplier's two fields;
    - a correction's note;
    - «Нова модель»'s name, colour, a size typed by hand and «Ще
      ознаки»;
    - a list's line.
  - Where Enter saves by earlier decisions, it still does; their fields
    say «done»:
    - the rename sheet;
    - «Додати рядки вручну»;
    - «Новий список» outside Telegram.

    Inside Telegram, where no button submits those two forms, their
    «done» puts the keyboard away.
- **A size cell lets the keyboard go** (goods P2-3): «Нова модель»'s
  cells and a list's line's, «Розмір невідомий» too.
- **The guard** (frame P2-5 p. 1; `frontend/eslint.config.js`):
  `no-restricted-syntax` refuses an `<input>` or `<textarea>` with no
  `enterKeyHint` in every screen. It lets through radio, checkbox, date,
  file, hidden and `inputMode="none"`.
- **The empties and reads** (goods P2-1;
  `frontend/src/openings/Openings.tsx`, `frontend/src/inventory/Receive.tsx`,
  `Stocktaking.tsx`, `Stock.tsx`, `frontend/src/catalog/Models.tsx`,
  `frontend/src/shared/Placeholder.tsx`, `frontend/src/styles.css`):
  - the four plain empties are the blank tag, in the same words.
    «Прийшов товар» with no warehouse is the blank tag alone, with no
    search, count or dock under it.
  - The waiting check is a grey line (`Placeholder line`); its words go
    to a screen reader alone.
  - The models' search, read with nothing found before, shows three grey
    rows, one line each, in its found rows' shape. A screen reader hears
    «Шукаємо моделі…».
  - The two texts are fixed: no full stop; «Оберіть інший склад.».
- **A rejected list's stub** (goods P2-4; `frontend/src/openings/Openings.tsx`):
  the same settled stub as «Затверджено…», its eyelet knotted, the same
  words.
  - A stub that begins with its line keeps that line clear of the eyelet
    (32 px) and of a knot's loop (52 px) (`frontend/src/styles.css`).
  - This covers «Затверджено…», a stocktake's result and «Продано»'s
    stub too.

## The independent review

An independent reviewer read the diff cold, during the full run. Nothing
was edited and no Playwright was run. No High.
- **Medium, fixed:** «done» in a sheet put the cursor on the page's body,
  so Escape no longer closed the sheet. Now the cursor is left on the
  sheet, as a rejection's reason does (batch 10 after stage 2). The
  journeys check that the sheet is focused.
- **Medium, fixed:** inside Telegram, «Новий список» and «Додати рядки
  вручну» draw no button that submits, so their «done» fields did nothing
  on Enter.
  - Now `enterGoes` runs there in Telegram alone; outside Telegram Enter
    still saves.
  - The line's journey presses Enter in «Звідки список» in Telegram:
    `web_app_hide_keyboard`, nothing saved.
- **Low, fixed:**
  - Fields in the same sheets were labelled but went nowhere: «Назва
    моделі», «Колір», a size typed by hand, and a new supplier's two
    fields. They now take `enterGoes`. A journey covers a new supplier's
    fields.
  - «Як записано», several lines, said «next»: now «enter».
  - `enterGoes` reads the attribute, which an older WebView without the
    property still has. It passes over a date and a read-only field.
  - «Прийшов товар» with no warehouse showed the blank tag over a
    working search and dock. Now the blank tag stands alone, as in
    «Залишки» and «Інвентаризація».
  - Docs: the guard's block lets off the shared `Unread` and `Sticker`,
    which hold no field; with a supplier list open, the price's «next»
    goes to its search.
- **Low, not taken:** the review's 229 check for Safari's Enter that ends
  a composition. `keyCode` and `which` are deprecated and the lint
  refuses them, and Ukrainian keyboards compose nothing.
- **Seen on the screenshot, fixed:** the rejected stub's first line ran
  under the eyelet and its knot, in both themes. «Затверджено…» did too,
  as did a stocktake's result and «Продано»'s stub.
  - A stub that begins with its line now keeps it clear: 32 px beside an
    eyelet, 52 px beside a knot.
  - The journey checks that the line ends before the eyelet.
- **Checked, no defect:**
  - no `enterGoes` field sits in a `<form>`, and nothing it does can
    send;
  - every «next» chain reaches its intended field;
  - the guard's selector, probed;
  - both size cells' `hideKeyboard`;
  - the models' grey rows never stand with «Нічого не знайшли» or over
    rows;
  - the screen reader's statuses are kept;
  - `Placeholder line`;
  - the journeys' counters are registered before the Enter steps and
    taken off after;
  - the checklist's 1137.

## How it was built and proven

- Journeys, new:
  - `catalog`: in Telegram:
    - «Як записано» says «enter»;
    - the name goes on to the colour;
    - «Ще ознаки» go on by Enter one after another;
    - «Довжина, см»'s «done» lets the keyboard go
      (`web_app_hide_keyboard`), the cursor on the sheet;
    - a size cell tapped lets it go too;
    - nothing is sent.
  - `openings`: a list's line in Telegram:
    - «Звідки список»'s «done» lets the keyboard go, nothing saved;
    - the MainButton is waited for, active, before it is pressed;
    - «Кількість» goes on to the note;
    - the note's «done», a size cell and «Чому це не товар» let the
      keyboard go;
    - nothing is sent;
    - «Ще про список»'s fields say «done».
  - `openings`: the waiting check read slowly — a grey line, the words
    hidden, gone when answered.
  - `models`: the search read slowly — three grey rows of a line each, no
    meta, the words hidden. The rows come where the grey stood.
  - `stocktake`: a warehouse taken away while chosen — «Оберіть інший
    склад.», no «зі списку».
- Journeys, changed:
  - `receive`:
    - each size's count «next» to the next, the last «done»;
    - the price «next» to the note, the note «done»;
    - nothing sent, the cursor on the sheet;
    - «no warehouse» on the blank tag alone: no search, no «Як
      надійшов», no dock.
  - `suppliers`:
    - the sheet's «Назва» «next» to «Телефон», whose «done» leaves the
      cursor on the sheet, nothing saved;
    - a new supplier's «Назва постачальника» «next» to its phone, whose
      «done» leaves the cursor on the list's sheet, nothing added;
    - the return's one size «done», its note «done», nothing sent.
  - `correct`: the note's «done», the cursor on the sheet, nothing
    recorded.
  - `models`:
    - the rename's «done» still saves;
    - «Нічого не знайшли за «…»» with no full stop.
  - `openings`:
    - «Тут рядків немає.» on the blank tag;
    - the rejected list's settled stub, its knot, its line clear of the
      eyelet, in both themes.
  - `stock`, `stocktake`: «no warehouse» on the blank tag.

## Mutants

`mutate57.py`, 34 mutants. Each was applied alone, its journey run, and
the source restored (`mutants57.sh`). All 34 were caught, each at the
check meant for it.
- Enter (19):
  - `enterGoes`:
    - never moves the cursor;
    - never puts the keyboard away;
    - never reads «next»;
    - leaves the cursor off the sheet.
  - The Telegram form's «done» unwired.
  - Without their handler:
    - a new supplier's name;
    - the delivery's price;
    - a supplier return's note;
    - the supplier's name;
    - the correction's note;
    - «Назва моделі»;
    - «Джерело»;
    - a line's «Кількість»;
    - «Чому це не товар».
  - The last size's «done» lost, on the delivery and on a supplier
    return.
  - «Як записано» back to «next», «Довжина, см» to «next».
  - The rename's «done» gone.
- A size cell (2): «Нова модель»'s or a line's leaves the keyboard up.
- The empties and reads (10):
  - the models' search not grey, or grey with a meta line;
  - its full stop back;
  - «Тут рядків немає.» plain;
  - «Перевіряємо…» visible;
  - «Прийшов товар»'s blank tag over its form, or plain;
  - «Залишки»'s and «Інвентаризація»'s plain;
  - «… зі списку» back.
- The stub (3):
  - the rejected list plain, or recorded;
  - its line under the knot.
- Proven outside the journeys: the guard. A probe file with a bare
  `<input>` and `<textarea>` was flagged twice by ESLint. Its checkbox,
  its `inputMode="none"` field and a labelled field were not.
- Equivalent here, left:
  - `preventDefault` dropped: no `enterGoes` field is in a form, so
    nothing would send either way;
  - the dialog's scope widened to the page: an open sheet makes the page
    inert;
  - «Колір», a size typed by hand and the Telegram «Додати рядки
    вручну»'s fields unwired: the same code as the ones mutated, with no
    journey of their own.

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1135 of
  1137 in 31.7 min.
  - `backups:93`: the stand's own, as in every full run since batch 8 of
    stage 2.
  - The new line journey pressed Telegram's MainButton before the
    waiting check made it active. It passed in the touched run before
    it, so this is a race. It now waits, as the older Telegram journey
    does, for «Новий список» and «Зберегти список» to be active.
- The touched specs before that, on a fresh seed: 150 of 151.
  - The one was the catalogue journey's setup: in Telegram «Далі» is the
    MainButton. It is pressed so now: 1 of 1.
- After the review's fixes, on a fresh seed, `catalog`, `openings`,
  `models`, `receive`, `stock`, `stocktake`, `suppliers` and `correct`:
  151 of 151 in 6.8 min.
- The catalogue journey after its last two checks: 1 of 1.
- The whole suite after the fixes: GitHub CI on the PR. The local full
  run is no longer made, by the user's word (2026-11-14).
- Screenshots of the rejected stub in both themes:
  - before the fix, the line ran under the eyelet and knot;
  - after it, the line is clear.
- Journeys: 1137 by `--list` (1132 before).
- Types: `tsc --noEmit` clean; the e2e config's errors are main's.
- ESLint: `npm run lint`'s `src` is clean with the new rule, and the
  touched specs are clean.
- Prettier is clean on what this batch changed. `styles.css` and
  `eslint.config.js` are unformatted on main and left so outside this
  batch's lines.

## Not covered

- A real phone: whether each phone's keyboard shows the labels.
- Safari's composing Enter. The review suggested a 229 check, but the
  lint refuses deprecated `keyCode`/`which`, and Ukrainian keyboards
  compose nothing.
- The first stocktake's blank tag and an empty answer of sizes wait on
  two new lines [нужно утверждение].
- Left on the goods list:
  - P2-5, the catalogue in one PR;
  - P2-2, after the owner reads it;
  - P1-2 part 2, after В13-Т1.
- Left on the frame list:
  - P2-2…P2-4, with money P2-4;
  - P2-5 p. 2, haptics by S12, after the owner reads it;
  - P2-7, after В13-Т1.
