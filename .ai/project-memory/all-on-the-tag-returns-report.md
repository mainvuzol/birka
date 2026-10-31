# «Усе на бірці», «Повернути» in the new system — 2026-10-31

Baseline: `fdcce9f` (#159, on main), and the frame's task list
([P1-3](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), its decision
and acceptance), with the spec's S08 («Повернути»'s state), §6.6 (the
search), §6.8 (a list row) and §10 (no sums or ways in the list).
Status: built and proven on this Mac; evidence below. CI is GitHub's, on
the pull request.
Branch: `feat/returns-new-system`. Task: the frame's P1-3.
Chosen: business-rules.md, "Chosen in chat — 2026-10-31 («Повернути» in
the new system, «Усе на бірці» P1-3)".

Under the till's switch, «Повернути» opened a screen with a heading of its
own, «Повернення», and over its field a second, «Що повертають?» — two
titles for one place, and rows lower than the spec's list rows. Now the
returns' list is the till's place: «Продаж» over it, «Повернути» pressed,
the till's search where the till's stands, and the sales in rows of 64.
Nothing changes on the server, and no word changes.

## What exists now

- **One heading, the till's:** the returns' list is headed «Продаж», as
  the till and its «Внесок» are, «Повернути» pressed under it; for whoever
  only takes returns, «Продаж» opens it with no switch, headed the same.
  The sale's screen keeps «Повернення», nested, at 28.
- **The till's search** (spec §6.6, `shared/SearchField.tsx`): 52 high,
  the magnifier on its left and «×» on its right once something is typed,
  in the till's place under the switch, so switching from «Продати» to
  «Повернути» leaves the field where it was while nothing is said over the
  till's field. Its «×» forgets an Enter, as «Очистити» does: the same
  letters typed again wait for the pause. Its name «Що повертають?»
  is read; its hint «Модель або колір» is what is seen. It takes 100
  letters, as the server's search of sales does.
- **Rows of 64** (§6.8): the goods the row's title, 17/600 in ink, «+ ще
  N» after two; the hour, the count and the stickers under them in
  pencil; the chevron. A sale returned whole, which opens nothing, has its
  goods in pencil too (§6.8's row that takes no tap). No sum and no way,
  as before (G32). Their places while read are as tall.
- **As before:** «Купили в іншому магазині мережі? Шукати там» under the
  results; the sale's screen with «← До списку» and «Продаж {день, ГГ:ХХ}
  · {сума}»; its dock over the menu, with the button's words; the result
  as a stub (P0-2).
- **A return is 4 taps** from the till: «Повернути», the sale's row,
  «Цілі: більше», «Повернути покупцю …» — the way the sale's own.

## Decided here, not by the owner

Recorded in business-rules.md, "Chosen in chat — 2026-10-31 («Повернути»
in the new system, «Усе на бірці» P1-3)":
- **The field's words:** «Що повертають?» is its name, read; «Модель або
  колір» is what is seen in it — both the owner's words of 2026-10-17. The
  spec's «search «Що повертають?»» is read as the field's name, and the
  frame's «подпись — для чтения, видимый текст — в поле» so: no word is
  changed.
- **The row's hour** leads the line under the goods, with the count and
  the stickers, as before: the frame's «{Модель} {колір} · {розмір} ·
  ГГ:ХХ» is read as the row's reading order, since a sale of two lines
  cannot carry its hour after each size.
- **The rows keep the app's lists' rhythm** — on the page, a line between
  — as «Борги», «Каса», «Ще» and the orders draw theirs, not on a card of
  their own (§6.8's card and its inset line): one list unlike the rest
  would read as a different thing.
- **The field where the till's stands:** in the till's place under the
  switch, so «Продати» ⇄ «Повернути» moves nothing under the finger. A
  notice over the till's field (the server back, the paper's mode) moves
  the till's, not the returns'; «Внесок» keeps its own form until its task
  takes the till's search (`SearchField`'s note).
- **A sale returned whole** has its goods in pencil, as §6.8's row that
  takes no tap; its «Усе вже повернено» sticker says why.
- **The sale's screen, its dock and the result** are as P0-2 and P0-4
  built them: nothing of P1-3 is left there.

## How it was built and proven

- **Files:**
  - `frontend/src/returns/Returns.tsx`: «Продаж» over the list; the
    till's `SearchField` in a `role="search"` form in the till's place; its
    «×» forgetting an Enter;
  - `frontend/src/shared/SearchField.tsx`: the letters it takes, the
    till's 200 unless said;
  - `frontend/src/styles.css`: the rows of 64 and their type, a sale
    returned whole in pencil; the field's place under the switch.
- **Journeys:**
  - **new:** `returns-sale-screen.spec.ts` — a return in four taps from the
    till, counted by the page's own counter of presses (`countTaps`, moved
    from `till-taps.spec.ts` to `fixtures.ts` so both count alike), and the
    returns' field where the till's stood, on a till of one warehouse the
    journey stubs;
  - **changed:** `returns-list.spec.ts` — at 360 × 640 one h1 «Продаж»
    and no «Повернення», «Повернути» pressed, the field 52 under it with
    its hint seen and its name on the page in no more than a pixel, 100
    letters, no sum, rows of 64; in both themes the goods 17/600 and the
    line under them 14/500, a sale returned whole in pencil at 4.5:1; the
    field's «×» forgetting an Enter, on the page's stopped clock;
    «Очистити» named exactly, the field's «×» being «Очистити пошук»;
    `till-sections.spec.ts` — whoever only takes returns headed «Продаж»;
  - **the list's root found by its field** where it was found by
    «Повернення»: the `section` helper in `fixtures.ts`, and
    `till-basket`, `till-receipt`, `till-sections`. The sale's screen keeps
    «Повернення», and the journeys that look for it there are unchanged.
- **Mutants:** 12, each applied alone and its journey run. 11 failed it at
  the check written for it: the list headed «Повернення» — for everyone,
  or for whoever only takes returns; the question as the field's hint; the
  field taking 200 letters; its name seen; the field off the till's place;
  the goods and the line under them in their old type; a sale returned
  whole drawn as one that opens; «×» keeping an Enter; the sale's way not
  offered, a fifth tap. One changes nothing a journey can reach: the rows'
  floor of 64 — their two lines and padding make them 69 at least, so the
  rule holds the floor only should their type shrink.

## Review

An independent review of the whole change found no bug of the app's.
- **Fixed:**
  - the field's «×» kept an Enter, so the same letters typed again were
    searched at once — it now forgets it, as «Очистити» does;
  - the check that the returns' field stands where the till's stood read
    Ліда's till in the shared E2E database, which another journey's list
    waiting for approval would hide — it is now made on a till the journey
    stubs;
  - a sale returned whole kept its goods in ink — now in pencil, as §6.8's
    row that takes no tap;
  - in the journeys: the field's hidden name is first found on the page,
    then measured; the root is checked for no «Повернення», not for no h2;
    the field is checked under the switch; `toTill` keeps its comment.
- **Kept, and said:**
  - the rows keep the app's lists' rhythm (12 4, a line), not §6.8's card,
    16 at the sides and its pressed fill (above, «Decided here»);
  - the row's hour on the line under the goods (the same);
  - the field's seen words, «Модель або колір», are not in its name — a
    voice that says them misses it. The till's field is so since P0-5, and
    the frame asks for it here;
  - the 18 that sets the field under the switch is the form's fieldset's;
    the four-tap journey fails should either move.

## Evidence

- **Full run** on a fresh seed, on this Mac, before the review's fixes:
  813 of 814 journeys passed (14.6 min) — 813 before, and the four-tap
  journey. The one failure is `backups.spec.ts:76`, which fails only on
  this Mac, as on main.
- **After the review's fixes:** the four touched specs, 64 of 64; every
  other journey that opens or types into the returns' list, 78 of 79 —
  the one, `outside-text.spec.ts:119`, a model not on the owner's stock's
  first page of a database crowded by a day's runs, passed alone on a fresh
  seed.
- `tsc -b` and `eslint .` clean; the build passes — its main chunk
  542.63 kB, with main's warning over 500 kB.
- Screenshots in both themes at 360 px (`returns-list.spec.ts`): one
  heading, the switch, the field, the rows with their stickers.

## For the owner

Each built as said until answered:
- the row's hour on the line under the goods, where the frame writes it
  after the size;
- the rows in the app's lists' rhythm, not on a card of their own;
- «Що повертають?» read and «Модель або колір» seen, as at the till.

## Not covered here

- **A real phone:** the list at 360 × 640 inside Telegram (С1).
- **«Внесок»'s field:** still its own form under the same switch, its
  label seen; it takes the till's search with its own task.
- **§6.8's pressed fill** for a row, and its sides of 16: the app's lists
  have neither; a change for every list at once.
