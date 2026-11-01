# «Усе на бірці», the way in, the door, «Ще»'s lines, other stores' units — 2026-10-31

Baseline: `942d950` (#160, on main), and the frame's task list
([P1-4, P1-5, P2-3](redesign/2026-10-27-redesign-tz-all-on-the-tag.md),
their decisions and acceptance), with the spec's S02, S03, S06 (its door
variant), S07, S09 (the owner's variant), §6.10 (the big tag) and §6.23
(the toast).
Status: built, reviewed and proven on this Mac; evidence below. CI is
GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/entry-door-more`. Tasks: the frame's P1-4, P1-5 and P2-3,
one batch (chosen in chat, 2026-10-31).
Chosen: business-rules.md, "Chosen in chat — 2026-10-31 (the way in, the
door, «Ще»'s lines, other stores' units; «Усе на бірці» P1-4, P1-5,
P2-3)".

A new seller's first screen was a refusal, their Telegram ID inside a
paragraph where it read like a phone number; the store was chosen from a
column of buttons under «Бірка»; «Ще» hid what waited behind «⚠», which
some phones draw as an emoji, and said nothing of who was signed in; and a
coat sold out here sent the seller to the phone to ask the other store.
Now the ID stands large on a blank tag and copies with one tap, the door
asks «Де ви сьогодні?» with a tag a store, «Ще» says under each row what
waits there, and a search at the till says what is free in the person's
other stores. Nothing changes on the server.

## What exists now

- **«Доступу ще немає» (S03):** «Ви відкрили Бірку як {Ім’я Прізвище}»
  over a blank tag — Telegram's name from the launch data, on the phone,
  sent nowhere; the tag's dashed eyelet, the heading, «Цей акаунт Telegram
  не має доступу до жодного магазину.», a perforation, «Ваш Telegram ID»,
  the ID at 32/800 in threes («5820 114 377»), «Це не номер телефону.
  Надішліть його власнику магазину.», «Скопіювати ID» at 52 with the toast
  «ID скопійовано»; «Коли вас додадуть…» and «Спробувати ще раз» as a text
  button, which reads again with the screen kept and, still refused, says
  «Доступу поки немає. Попросіть власника магазину додати ваш ID.». No
  menu, no MainButton. A copy refused says the current words as a toast; a
  phone with no clipboard has no button and one tap selects the ID whole.
- **A failed sign-in:** the same blank tag, headed «Вхід через Telegram»,
  its words as they were (К12); «Бірка» over it, the app's mark beside.
- **Opening (S02):** a first screen's places — a title, a line, a field,
  three rows — with «Входимо в магазин…» read, and no menu until the
  rights are read.
- **The door (S06):** «Де ви сьогодні?» (h1), «Продажі запишуться на той
  магазин, у якому ви зараз.», a big tag a store — 96 high, its eyelet,
  the whole tag pressable, the name 22/700, its code under it, a store
  that does not trade with its state's sticker. Nothing chosen beforehand
  or remembered (В6); at 360 × 640 two tags stand whole.
- **«Ще» (S07):** a glyph at 24 on every row; under them «Борги · 4
  людини винні» in the debts' colour, «Брак · 2 очікують перевірки» in
  «Брак»'s, «Товар і каталог» and «Початкові залишки» · «2 на
  затвердження» («2+» past the read's hundred), «Резервні копії · в
  порядку, уночі о 03:15» or a dot in the warning's colour and «потрібна
  ваша увага», «Змінити магазин · {Магазин}»; the same dot on «Ще» in the
  menu, read «Ще — є що перевірити»; at the foot «Ви увійшли як {ім’я} ·
  сесія до ГГ:ХХ», the sign-in's moment plus `expires_in`. No «⚠» in the
  app.
- **Other stores' units (S09):** under a model's tag at the till, «Ще в
  магазині «Ринок»: M 1 · L 1» for each of the person's other trading
  stores where they read the stock — free units by size, a warehouse this
  till sells from left out, a store whose answer did not end or failed
  saying nothing; one request a search and store, none while nothing is
  typed; never pressed.

## Decided here, not by the owner

Recorded in business-rules.md, "Chosen in chat — 2026-10-31 (the way in,
the door, «Ще»'s lines, other stores' units; «Усе на бірці» P1-4, P1-5,
P2-3)":
- **The store's name undeclined:** «Ще в магазині «Ринок»» for the
  frame's «Ще в «Ринку»», as «Усього винні магазину «X»» (P0-3).
- **A model this store holds none of has no tag, so no line:** the line
  stands under the tags the till lists. «Зараз нема M, але в «Ринку» є»
  is answered; «нема зовсім» is not.
- **«{N} людини винні»** for the frame's «{N} винні», the count said with
  its noun, by number; «ніхто не винен» when none, as «Борги» says.
- **The failed sign-in's heading** is its own title, «Вхід через
  Telegram»; «Бірка» stays on it as the line over the tag (В4).
- **The ID's groups:** threes from the right, a lone first digit with the
  next three, as the frame's «5820 114 377».
- **No end said** when the sign-in's answer gives no `expires_in`, or one
  no session has.
- **The door has no name over it:** every screen after it says who.

## How it was built and proven

- **Files:**
  - `frontend/src/App.tsx`: the session's end at sign-in; `NoAccess` and
    its `BlankTag`, the toasts and the status line present from the start;
    the screen kept while «Спробувати ще раз» reads (`asking`: a read again
    with no data is pending in React Query v5, and the screen would drop
    to the opening's); the failure screen; the door; «Ще»'s glyphs, lines,
    the menu's dot and the foot; the other stores the till reads;
  - `frontend/src/shared/MoreLines.tsx` (new): «Борги»'s, the approvals'
    and the backups' lines;
  - `frontend/src/shared/More.tsx`, `TabBar.tsx`: a glyph a row, a foot; a
    tab's `attention`, its dot and its read name;
  - `frontend/src/shared/Placeholder.tsx` (`Opening`), `Toast.tsx` (a toast
    with no action, 4 s; `live`), `telegram.ts` (the launch's name);
  - `frontend/src/inventory/Goods.tsx`: «Брак»'s count in its colour;
  - `frontend/src/sales/StockSearch.tsx` (`useElsewhere`), `Sale.tsx`: the
    other stores' read and its lines;
  - `frontend/src/styles.css`: the blank tag, the door's tags, the
    opening's places, «Ще»'s rows, counts and dots, the line under a tag.
- **Journeys:**
  - **new:** `more-lines.spec.ts` — every row's line and glyph, the foot's
    time, the first two groups whole at 360 × 640, the counts at 4.5:1 and
    the dots at 3:1 in both themes, the dot drawn; `stock-elsewhere.spec.ts`
    — the owner at «Центр» sees «Ринок»'s free units and not the shared
    warehouse's, a store not read, not trading or with more than a page
    asks or says nothing, one request a search and store, the line never a
    button, at 4.5:1 and no sideways scroll; a seller whose stock is read
    at «Центр» alone asks nothing more; `first-sign-in.spec.ts` — S02's
    places and no menu, and the door at 360 × 640 in both themes;
  - **changed:** `first-sign-in.spec.ts` — S03's ID, copy, refusal and
    retry; the failure's tag; `backups.spec.ts`, `today.spec.ts` — the dot
    and «Ще — є що перевірити» for «⚠»; `fixtures.ts` — the door's heading
    in `openStore`, «Ще»'s rows found by their label with what follows it
    (`rowNamed`); `session`, `design-system`, `orders`, `till-redesign`,
    `till-sections`, `till-receipt`, `failures`, `outage`, `credits` — the
    door's and the failure's words, rows read with their lines;
  - **signing in:** `till-placeholders.spec.ts` — a first screen's
    places, not the till's tags (2026-10-17's «how it is carried out»);
    «Товар і каталог»'s line in `models`, `catalog`, `till-sections` with
    the lists waiting before what it holds;
  - **the till's search reads other stores:** `till-search.spec.ts` counts
    the open store's requests alone — its seller has a second store;
    `outage.spec.ts`'s kept sale gives «Борги»'s read, as «Ще» opens, no
    answer while the server is gone — any answer is the server back
    (ADR-0013 §4.3), and the 404 its stub gave unknown paths resent the
    sale early.
- **Mutants:** 24, each applied alone and its journey run; all 24 fail
  it. Two first passed and were mended: the menu's dot taken away — a
  colour is read off a dot not drawn as well, so the journey now checks it
  is drawn, 10 across; the door's tags at 64 — the floor of 96 stood on
  the outer tag, where the inner's 94 and the outline's lines made it
  anyway, so it now stands on the inner alone.

## Review

An independent review of the whole change found nothing serious.
- **Fixed:**
  - the toasts on «Доступу ще немає» came onto the page with their words,
    which a screen reader often leaves unread — a status line present from
    the start now says them, as the old screen's did;
  - a store's line stayed when its read again failed — it now goes;
  - «N на затвердження» counted the read's first hundred lists — past them
    it says «N+», as «Сьогодні»'s parcels do;
  - a session's length no session has would have broken «Ще» — it now says
    no end;
  - the seller's journey proved nothing of the right it is about: she had
    one store — she now has «Ринок» too, without its stock's right;
  - the foot's journey takes the moment before the sign-in is asked too,
    should a minute turn in between.
- **Kept, and said:** «в порядку, уночі о ГГ:ХХ» says «уночі» of a copy
  made by day too — the spec's words, for the owner; the approvals' «+»
  and a failed read again of another store have no journey of their own.

## Evidence

- **Full run** on a fresh seed, on this Mac, after the review's fixes:
  817 of 820 journeys passed (15.2 min) — 814 before, and the six new.
  The three failures:
  - `backups.spec.ts:78`, which fails only on this Mac, as on main;
  - `till-placeholders.spec.ts:82` still looked for the till's three tags
    while signing in — the frame's S02 draws a first screen's rows there
    (below, «Changed after the full run»);
  - `models.spec.ts:897`, a lost receipt's banner, passed alone twice.
- **Changed after the full run:** `till-placeholders.spec.ts` — signing in
  shows a field and three rows, no tag of the till's; `models.spec.ts:641`,
  `catalog.spec.ts:276` and `till-sections.spec.ts:763` read «Товар і
  каталог»'s line with as many lists waiting as the shared database holds
  (none on a fresh seed, eight after a run). `models`, `catalog` and
  `till-placeholders` on a fresh seed: 43 of 43.
- **The review's fixes:** `first-sign-in`, `more-lines`,
  `stock-elsewhere`, `backups`, `today` — 44 of 45; the one,
  `backups.spec.ts:78`, fails only on this Mac, as on main.
- `tsc -b` and `eslint .` clean; the build passes — its main chunk
  549.64 kB, with main's warning over 500 kB.
- Screenshots in both themes at 360 px: S03, S02, the door, the failure,
  «Ще» with its lines and dots, the till's line under «Кокон графіт».

## For the owner

Each built as said until answered:
- the store's name undeclined: «Ще в магазині «Ринок»»;
- a model this store has none of shows no other store's line;
- «{N} людини винні» for «{N} винні»;
- the failed sign-in headed «Вхід через Telegram», «Бірка» over its tag;
- «уночі о ГГ:ХХ» for a copy made by day.

## Not covered here

- **A real phone:** S03's copy and its buzz, the door and «Ще» inside
  Telegram (С1).
- **«Надіслати власниці»** (Q-10), **«Мова»** and **«Додати Бірку…»**
  (Q-13, Q-10): not built, as the frame says.
- **A model held only elsewhere:** no tag, so no line — a change to the
  till's list, for the owner to choose.
