# «Усе на бірці», the search on «Сьогодні» — 2026-11-04

Baseline: `576b19d` (#167, on main), and the frame task list
([P2-2](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), its decision
and acceptance), with the spec's S04 #3 and §6.6.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/today-search`. Task: the frame task list's P2-2, the last
of it but what waits for the sections (chosen in chat, 2026-11-04, «Yes,
start P2-2»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-04 (search on
«Сьогодні»; frame P2-2)". The design's questions stay «if no».

A model, a customer or a parcel could be found only in its own section:
the owner who wanted «чи є Кокон M», «що з Дариною», «де посилка 20 4512…»
went to three places. Now «Сьогодні» has one field, and what it finds in
the open store stands in the day's place, a group by right, each row
opening what its section opens. Nothing changes on the server: each group
is read by its section's own request and right.

## What exists now

- **The field (S04 #3, §6.6):** «Модель, покупець або ТТН», the app's
  search field (52, the magnifier, «×»), under the title's line and over
  the day-tag; for whoever has one of the groups' rights in the open
  store, none otherwise. From two letters, 300 ms after the last key, or
  at once by Enter — and what Enter found stands while more is typed,
  until the next pause. Under two letters, or «×», the day comes back as
  it was, what waits and its toast with it.
- **The groups, in the TZ's order, each under its heading:**
  - «Товар» (`inventory:view`): the till's own request, a hundred rows; a
    row a model — its name, and what is free of it by size, the store's
    warehouses summed, held units not counted: «S 2 · M 2», or «Усе в
    резерві». A model whose rows may run past the page is not shown: no
    number is made up.
  - «Покупці» (`sale:credit`): «Покупці»'s own rows, by name or phone,
    every debt; an erased customer, with no name nor phone to be found
    by, is not shown.
  - «Замовлення» (`sale:view`): by its waybill, asked only while what is
    typed can be one (Latin letters and digits, a digit at least): the
    server keeps a waybill's letters and digits alone, so «кокон» would
    match every order. A row: the card's title, «Нова пошта · ТТН … ·
    Відправлено»; never its sum (G32).
  - Five rows a group at most, «Знайдено більше — уточніть пошук.» past
    them; grey rows while read, never an earlier search's; a failed group
    says why in its place with «Спробувати ще раз», the others standing;
    nothing anywhere: «Нічого не знайшли за «…»». What a reader hears —
    «Шукаємо…», or that nothing was found — is said in one line that
    stands from the start.
- **A row opens** the model's detail (S23) or the customer's card (S20)
  with «← Сьогодні», or the order's card (S17) in «Замовлення» with «← До
  замовлень», as the parcels' verb opens it; the keyboard goes (Telegram
  9.1); the menu marks where it went; the cursor on «Сьогодні» in the
  menu, on «Замовлення» for an order. Back, the field and its groups as
  left, read afresh; anywhere else, the search is forgotten.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the field only for whoever has a group's right in the open store;
- «Товар» sums the store's warehouses by size and leaves out a model the
  page may cut;
- «Замовлення» asked only for text that can be a waybill;
- erased customers not shown;
- the search kept while what a row opened stands, forgotten anywhere else;
- with only «Замовлення»'s right and text that can be no waybill, nothing
  is asked and «Нічого не знайшли» says so.

## How it was built and proven

- **Files:**
  - `frontend/src/today/Search.tsx` (new): the field, the groups' reads,
    the rows, the pause;
  - `frontend/src/today/Today.tsx`: the field over the day, the day and
    what waits unseen while searched, «Повернути» while searched;
  - `frontend/src/App.tsx`: where a row goes, «← Сьогодні», what is kept
    and when it is forgotten;
  - `frontend/src/credits/Credits.tsx`, `Customer.tsx`, `CustomerRow.tsx`:
    a card opened from outside the list, «← Сьогодні» over it; a row held;
  - `frontend/src/styles.css`: the groups.
- **Journeys:** 888 in all (877 after #167).
  - **`today-search.spec.ts`** (11 new): the field's place, 52 high, from
    two letters, every word in every row, the day unseen and back as it
    was, what waits shown before; the pause, Enter, and Enter's result
    standing while more is typed (on Playwright's clock); five a group,
    «Знайдено більше», a model cut by the page; nothing found, «Шукаємо…»
    said, a group failing and read again; a model with «← Сьогодні», then
    the till's own with «← Продаж»; Telegram's keyboard; a customer's card
    with «← Сьогодні», «Ще» marked, an erased one not shown, what was owed
    before never shown on the way back; an order of the server's by part
    of its waybill, its card, kept and forgotten; no group without its
    right and no field without any; 360 × 640 in both themes at 4.5:1,
    nothing wider than the screen.
  - **`today.spec.ts`:** the field between the title's line and the
    day-tag; the double tap's screen 64 px taller for it; «Повернути»
    while searched.

## The independent review

An agent read the change cold (2026-11-04). It found the rights, the
store, the waybill's guard and the figures as the sections have them.
What else it found, and what was done:
- **Fixed:**
  - Enter, then more typed before the pause, fell back to an earlier
    pause's search, or to the day, until the next pause: what Enter
    searched stands now (the pause's journey);
  - «Повернути» on a toast while searched brought the tag back unseen and
    lost the cursor with it: it stays by the search (`today.spec.ts`);
  - «Шукаємо…» and «Нічого не знайшли» were said in lines mounted with
    their words already in them, which a screen reader may not read: one
    line stands from the start and says them;
  - back from a card, a payment or a step made there, the groups showed
    what they had read before for a moment: read afresh, grey rows
    meanwhile (the customer's journey holds the answer and checks);
  - every key redrew the whole app: what is typed is «Сьогодні»'s, the
    app keeping it as a row opens;
  - the journeys: what waits checked before searching; the till's own
    model opened before «Сьогодні» comes back, so a stale way back would
    show.
- **Recorded, left as built:** «Нічого не знайшли» with only
  «Замовлення»'s right and no waybill typed; a single model in more than
  a page's hundred rows, «Знайдено більше» alone; a model opened in a
  store that does not trade marks «Ще», as the till's own does; «Ще»'s
  other store forgets the search. P0-6's two tags on the first screen
  stay an owner's reading; the field does not change it.

## Mutants

37 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate16.py`,
`mutants16.sh`): Enter; «Шукаємо…» and «Нічого не знайшли» in the line
that stands; nothing searched before standing under two letters; the
cursor by the search after «Повернути»; the groups read afresh; what was
typed kept as a row opens; the day and what waits unseen; the field and
each group by its right; the waybill's guard; the till's hundred; every
debt; a query a read; held units, the sum by size, «Усе в резерві», the
model a page cuts; five a group and «Знайдено більше»; a found-nothing
group gone, a failed one standing; erased customers; the keyboard; the
model's way back, cursor and forgetting, and the till's own way back
after it; the card opened from outside, «← Сьогодні» over it, its
cursor; the order kept, its cursor, and forgotten off its card. All 37
are caught, each by the check written for it. Two would have passed the
journeys as they stood before the review: the till's own model going back
to «Сьогодні» (the journey came back by «Сьогодні», which forgets it
anyway) and the old figures on the way back (never checked).

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-04, after the
  review's fixes): 887 of 888 pass in 18.3 minutes. `backups.spec.ts:78`
  fails only on this Mac, as on every batch before; CI runs it.
- Before the review, a full run on a database earlier runs had used:
  886 of 888, `till-basket.spec.ts:337` the second — «Route is already
  handled» in its fixture's stub (`fixtures.ts`, `sellsFrom`) as the page
  reloads. Run alone it failed once in three right after, then passed
  seventeen times in a row; on main, six of six. It passes on the fresh
  seed above. Taken for the fixture's race with a slow server; to watch
  on CI.
- `today-search.spec.ts` three times over: 33 of 33; with `today.spec.ts`
  after the fixes, 42 of 42.
- `tsc -b`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).
- The 37 mutants above, all caught.
- Screenshots, 360 × 640: the groups and «Нічого не знайшли» in both
  themes.

## For the owner

Nothing new to ask: the field's words and the groups are the TZ's. What
was decided here is in business-rules.md under the heading above, each
by the TZ's text or the sections' own rows.

## Not covered

- A real phone: Telegram's keyboard going is checked through its event
  only.
- «Товар» counts what is free across the store's warehouses as the till
  reads them; another store's stock is not searched (only the open store,
  by the TZ).
- The frame task list's P2-2 is done; what is left of the frame waits for
  nothing now but the stage-2 audit.
