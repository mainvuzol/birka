# «Усе на бірці», «Сьогодні», part 2: what waits — 2026-10-30

Baseline: `9bc4af4` (#156, on main), and the frame's task list
([P0-6](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), items 3–6 and
8 for the work tags; item 7 for their reads; its acceptance where it
concerns them).
Status: built, reviewed and proven on this Mac; evidence below. CI is
GitHub's, on the pull request. Not yet seen on a real phone (С8).
Branch: `feat/today-work-tags`. Task: the frame's P0-6, part 2 of 3.
Chosen: business-rules.md, "Chosen in chat — 2026-10-30 («Сьогодні», part
2: what waits, «Усе на бірці» P0-6)".

The day-tag answered «how are we doing». «What needs me» still lay in
four places: the backups' «⚠» in «Ще», the parcels in «Замовлення», «Брак»
in «Ще» › «Товар», the lists of existing stock waiting unseen in «Ще»
(`App.tsx`). Here «Сьогодні» says it under the day-tag, a tag each, and
the tab says how many. Nothing is added to the backend: each tag is a read
the server already answers, by the right it already needs.

Part 3 is left: the news tags (the drawer's difference, a stocktake) with
«Бачу», the toast with «Повернути», what was seen kept on this phone, and
«Зроблено сьогодні».

## What exists now

- **«Чекає на вас · N»** (spec S04 #10, §6.9) under the day-tag: a row tag
  each, 8 apart, the frame's order:
  1. **the backups** (`GET /backups`, `backup:view` of the network), while
     they are not in order or something is wrong on the server: the
     backups screen's own heading for the state — «Остання нічна копія не
     вдалася», «Копія не робилася вже N год», «Резервне копіювання ще не
     налаштоване», or «Проблема на сервері» / «Проблеми на сервері» while
     the copies are fine — and, in its meta, what is wrong on the server
     now, in that screen's words; verb «Переглянути»;
  2. **the parcels** of each store (its open orders, `sale:view`): «Відправити
     1 посилку / 3 посилки / 5 посилок», «+» after the count past the
     store's hundred; its meta, the oldest order's goods first, three of
     them as «{модель і колір} {розмір}», «× 2» for more than one, and
     «+ ще N»; verb «Зібрати й відправити» → «Замовлення»;
  3. **«Брак»** of each store (`GET /damaged-units`, `damaged:handle`):
     «У «Браку» «Центр» 1 річ очікує / 3 речі очікують / 5 речей очікують
     перевірки», counting the units awaiting inspection — not one being
     looked at; two of them in its meta, the oldest first; verb «Оглянути»;
  4. **the lists of existing stock** of each store (`GET /snapshots`,
     `snapshot:approve`): «Затвердьте початкові залишки», its meta «412
     рядків» for one list, «2 списки» for more; a list of a warehouse two
     stores share counts in the store that keeps it; verb «Переглянути й
     затвердити».
- **Each tag** (spec §6.9): its eyelet filled in its kind's colour where
  its title's first line is — warning for the backups, online for the
  parcels, damaged for «Брак», ink for the lists — its glyph left of the
  title, two lines of meta at most, one verb bottom right, never black.
- **How old it is** (task list, item 7): the block's, as the day-tag's —
  any of its reads older than five minutes, or failed at its last asking,
  and the day-tag's stamp «дані на 11:32» stands by «Чекає на вас · N», or
  under «Вас нічого не чекає.». The tags stay as last read.
- **Verbs only where the work is done from here:** on the open store's
  tags and the network's backups. Another store's tag has none (В-Т2 (а))
  and its meta names the store. A store is named whenever the day holds
  two or more, so the open store's parcels are not read as another's.
  The open store's tags come first in their kind, the others by code. A
  kept operation holding the sections holds the verbs too.
- **A verb opens its section with «← Сьогодні»**, and Telegram's «Назад»
  does the same; the same section opened from «Ще» keeps «← Ще». The
  cursor stays on the menu's «Сьогодні» — after the verb and after «←» —
  as «Ще» keeps it; on «Замовлення» after the parcels'. «← Сьогодні» is
  held as the menu's «Сьогодні» is.
- **Past seven** (spec §6.9), the rest fold into «+ ще N»; tapped, they are
  shown in place, and the cursor goes to the first of them.
- **Nothing waits** (spec §6.28): «Вас нічого не чекає.» under a blank tag,
  in place of the list — only once every read has answered. A read not
  answered yet holds a tag's place in grey; one that failed says so there
  («не вдалося прочитати», «сервер не відповідає») and nothing is said to
  be done. Whoever reads none of the four has no list at all.
- **«Копії в порядку · сьогодні о 03:15»** under it all, for whoever reads
  the backups, while they are in order and nothing is wrong on the
  server; «учора о …», or the date, for an older copy.
- **The badge** (spec §6.3): the number of open tags on «Сьогодні»'s glyph,
  «9+» past nine. It is drawn, never part of the tab's name or words: a
  reader hears «Сьогодні» and its description «Чекає на вас: 6».
- **Its reads** (`today/reads.ts`, `today/waiting.ts`): each store of the
  day's «Брак» and lists, under the keys of their own screens, and the
  backups', with the parcels the day-tag already read. Read by «Сьогодні»,
  so on its tab once a minute has gone, and by the tab's badge, the same
  reads; at entry, on the tab and as the app comes back, never more than
  once a minute. The backups' own read for «Ще ⚠» now keeps to that minute
  too.

## Decided here, not by the owner

- **The backups' tag says the screen's heading** for the state; with the
  copies in order and trouble on the server, the server block's heading.
  Its meta is what is wrong on the server now, in that screen's words.
- **The parcels' goods:** «{модель і колір} {розмір}», as the frame writes
  them, with «× 2» from «Замовлення»'s own words; the oldest order first.
- **«Брак»** counts the units awaiting inspection, as its row in «Ще»
  does; one being looked at waits on nobody here.
- **The lists:** those in review, as the frame names; a list of a shared
  warehouse in the store that keeps it, so it is never counted twice.
- **The kinds' colours:** the frame gives none for the lists: ink.
- **A store is named** in a tag's meta whenever the day holds two stores or
  more — the frame names only another store's.
- **The order inside a kind:** the open store first, then by code.
- **«+ ще N» from the eighth tag**, as the spec has it: past seven.
- **The empty state** says «Вас нічого не чекає.» alone, without the spec's
  «Обидва магазини торгують.» (the frame has only the first); it waits
  until every read has answered.
- **«Копії в порядку · {коли}»:** «сьогодні о», «учора о», or the date —
  the stocktake tag's «учора о 18:30» in the frame.
- **The badge is the tab's description,** not its name: every journey and
  every reader finds «Сьогодні» by its name.
- **«← Сьогодні»** for a section a tag opened; the cursor on the menu's
  «Сьогодні», not on the verb, whose tag may be gone once the work is done.
- **One stamp for the block,** not one a tag: the reads are asked together,
  and a kind that failed with nothing to show would otherwise say nothing.
- **«Ще ⚠» stays** until P1-5, which turns it into a dot with all its
  journeys; «Сьогодні» itself shows no «⚠».

## How it was built and proven

- **Files:**
  - `frontend/src/today/waiting.ts` (new): the tags from the reads;
  - `frontend/src/today/reads.ts`: the backups, «Брак» and lists reads;
    the open orders by store;
  - `frontend/src/today/Today.tsx`: «Чекає на вас», the tags, «+ ще N»,
    the empty state, the backups' line;
  - `frontend/src/App.tsx`: the badge's reads, the verbs, «← Сьогодні»,
    the cursor on «Сьогодні» and on «Замовлення»;
  - `frontend/src/shared/TabBar.tsx`: the badge;
  - `frontend/src/shared/More.tsx`: «←» back to where a section was opened;
  - `frontend/src/backups/Backups.tsx`: its headings shared; its read once a
    minute at most;
  - `frontend/src/styles.css`;
  - `frontend/e2e/today.spec.ts`; `frontend/e2e/orders-card.spec.ts` (below).
- **Journeys** (`today.spec.ts`; the reads stubbed, «Брак» empty, no list
  and the backups in order unless a journey says otherwise):
  - what waits: six tags in the frame's order, each title and meta the
    stub's fields, verbs on «Центр»'s and the backups' only, the badge and
    its description 6, no copies' line, no «⚠»;
  - opened at «Ринок»: its parcels first, with the verb; «Центр»'s named,
    without; trouble on the server with the copies in order;
  - each verb opens its section with «← Сьогодні», which comes back, the
    cursor on «Сьогодні» both ways; left by the menu and opened from «Ще»,
    «← Ще»; the parcels' verb, «Замовлення» with the cursor on it;
  - a tag goes once its work is done, a minute on, and the badge with it;
  - ten tags: seven and «+ ще 3», the badge «9+»; tapped, ten, the cursor
    on the eighth;
  - nothing waiting: «Вас нічого не чекає.», no count, no badge, «Копії в
    порядку · сьогодні о 03:15»;
  - a read that fails: its place held, «не вдалося прочитати», nothing said
    to be done, the day-tag and the copies' line standing;
  - a read that fails again a minute on: the tags as they were, «дані на
    HH:MM» by the heading; and under «Вас нічого не чекає.»;
  - a manager of one store: the parcels and «Брак», unnamed; the backups
    and lists never asked;
  - part 1's reads journeys count «Брак», the lists and the backups too:
    once at entry, none again within the minute, each again after it; none
    of the store that does not trade.
- **Proven to catch:** each break was applied once, its journey run, then
  undone. All 29 failed the journey named for them, each at the check
  written for it:
  - the lists before the parcels;
  - the open store not first of its kind;
  - a verb on another store's tag;
  - another store's tag unnamed;
  - a unit being looked at counted;
  - a shared warehouse's list counted where it is not kept;
  - an approved list counted;
  - the parcels' goods newest first;
  - no «+ ще N» in the parcels' meta;
  - no «9+»;
  - the badge counting other reads;
  - never folded;
  - the cursor nowhere once unfolded;
  - nothing said to wait while a read failed;
  - no place held for a read not answered;
  - «Копії в порядку» with trouble on the server;
  - no copies' line when they are in order;
  - trouble on the server unsaid while the copies are fine;
  - a tag's section going back to «Ще»;
  - «← Сьогодні» kept after «Сьогодні» or «Ще» opened again;
  - the backups re-read at every return;
  - the backups read without the right;
  - the lists read without the right to approve;
  - tags of a store that does not trade;
  - the cursor left on the page by a verb, by «← Сьогодні», by the
    parcels' verb;
  - tags from a read that failed since, without how old;
  - «Вас нічого не чекає.» from a read that failed since, without how old.
- **Journeys:** 790 — 780 on main and the 10 here.

## Review

An independent review of the change, read-only, before these fixes. Fixed:
- **The parcels' tag and the badge stale after a dispatch** (high): their
  read was under «Сьогодні»'s own key, which no step re-reads. Now under
  «Замовлення»'s prefix, `["orders", store, {today}]`, as «Брак» and the
  lists already were under theirs (`["stock-lists", {today}, store]`).
- **Two equal goods in a tag's meta** («Лоран шоколад M» in two parcels)
  gave React equal keys: each part is keyed by its place.
- **«Вас нічого не чекає.» said as fresh after a read that failed since**:
  the block's age, with the day-tag's stamp by its heading or under the
  empty title (above); a kind that failed with no tag is no longer
  silent.
- **The cursor lost to the page** after a verb and after «← Сьогодні»: on
  the menu's «Сьогодні», and on «Замовлення» after the parcels' verb.
- **«Початкові залишки» under the report's key** shared a list's lines
  between stores, which the server authorises each by its own: back under
  the store's key, as on main.
- **«← Сьогодні» went to «Сьогодні» while the menu held it:** held the same.
- **The unread place was an empty item to a reader** until it failed:
  hidden from it until it says something.
- **Journeys weaker than their titles:** the «⚠» check says it is
  «Сьогодні»'s own blocks (the menu's «Ще ⚠» stays until P1-5); a section a
  tag opened is left by the menu and opened from «Ще»; a re-read that
  fails, over tags and under the empty state; the title and the meta
  checked apart, not glued; the cursor after a verb and after «←».

Found by the full run, after the review:
- **orders-card.spec:664, a step lost and checked by itself** before the
  journey saw it: «Сьогодні»'s reads at entry («Брак», the lists) answered
  just after the lost step, which is the server back, and the kept step was
  checked at once (ADR-0013 §4.3) — the app as it should be, the journey
  pressing its step with reads in flight. Held until the step was lost,
  those reads failed it every time. Its journeys that lose a step now
  start with nothing in flight, as till-sections' do; 47/47, and the five
  of them 35/35 over five runs.

Kept, not journeyed:
- the verbs held while a kept operation holds the sections — the same
  `blocked` as the menu's, journeyed there;
- Telegram's «Назад» from a section a tag opened — it does what its «←»
  does (P1-1's journeys);
- the badge after a dispatch or an inspection while «Сьогодні» is not on
  screen — the keys above, under each screen's own prefix;
- two equal goods in one meta — React warns, the screen shows both.

For the owner (not bugs):
- every eyelet is filled; §6.9 says «ring — waiting on someone else», which
  could fit another store's tag, without a verb (В-Т2 (а));
- «сьогодні о / учора о / 28.10 о» in «Копії в порядку · {коли}» is new
  copy: S04 has «уночі о 03:15».

## Evidence

On 2026-10-31, on this Mac, against the E2E API and PostgreSQL 17 on a
fresh seed; CI is GitHub's, on the pull request.
- **Every journey:** 789 of 790 passed (13.6 min). The one left is
  `backups.spec.ts:76`, which fails on this Mac only (its night's count),
  as on main. The run before it, 788: that one and `orders-card.spec.ts:664`
  (Review, above), fixed since.
- **`today.spec.ts`** 25 of 25; **`orders-card.spec.ts`** 47 of 47.
- **Mutants:** 29 of 29 caught (above).
- **eslint** and **tsc** clean; **build** passes, the app's own file
  533.63 kB, past the 500 kB warning as on main (still to choose).
- **Heights at 390 × 741** (the frame's acceptance), with the stubbed day
  of two stores:
  - the day-tag 136–485 px; «Чекає на вас · 4» under it; the first tag,
    the open store's parcels with three goods and its verb, 527–669 (142);
    the menu from 676: one tag over the menu, not the frame's two;
  - nothing waiting: «Вас нічого не чекає.» 503–617, «Копії в порядку»
    633–652, both over the menu.
- **Screenshots**, light and dark, of the tags and of the empty state at
  390 × 741 — seen, not kept in the repository.

## Not covered here

- **On a real phone** (С8): Telegram's steady height, the badge on the
  menu, the reads as the app comes back.
- **The frame's «two tags over the menu at 390 × 741»**, with 64 px for the
  search: the day-tag ends at 485 px, the first tag at 669 with a verb and
  three goods, the menu begins at 676. The day-tag's height is the open
  question of part 1 («≤ 240 px»); a tag with a verb is 120–142 px, the
  spec's 76 being a tag without one. A reading for the owner.
- **Part 3** (above).
- **The app's own file past 500 kB:** still to choose.
