# «Усе на бірці», the frame, part 2: each screen's own title heads the page, the store's line under it — 2026-10-29

Baseline: `82fa5d9` (#150, on main), and the frame's task list
([P0-4](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), item 2).
Status: built and reviewed; every journey passes locally but the backups'
seed one. CI is GitHub's, on the pull request. Not yet seen on a real
phone.
Branch: `feat/frame-titles`. Task: the frame's P0-4, part 2.
Chosen: business-rules.md, "Chosen in chat — 2026-10-29 (the frame of «Усе
на бірці», part 2)".

Part 1 moved the places; this part gives every screen of a store the head
the design draws (spec §6.2): its own title as the page's heading, and one
line of context under it. P0-4 is done with it.

## What exists now

- **The screen's head** (`shared/ScreenHeader.tsx`), on the page over the
  screen's card:
  - its title, the page's one heading — a tab's first screen at 34/800
    (`title-xl`), a screen opened from another at 28/800 (`title-l`)
    under its «←»;
  - one line under it, «{Магазин} · {Ім’я}», 14/500 in pencil;
  - «Змінити магазин» at that line's right, for whoever has two stores or
    more, held as the menu is — on S21 too.
- **34:** the till on each of its ways («Продаж», «Повернення», «Продаж»
  for «Внесок»), «Замовлення», a seller's «Каса», «Ще».
- **28, as its heading was:** every other screen — «Каса» opened from
  «Ще», «Борги», a customer, a debt, S21, the order's card (23 before),
  «Нове замовлення», «Доставка», the goods back on the shelf, a return's
  sale, the cash's count, movements, closes and fixes, «Залишки»,
  «Приймання товару», «Брак», the catalogue's screens, the openings, the
  invoices, suppliers, stores, backups, the sales report, «Товар і
  каталог», and the results without a stub («Продажу немає», «Товар
  прийнято», «Касу закрито»).
- **The results with a stub** — the receipt (S11), a return's — keep their
  title at the sheet's 24 with its check, and the line under it.
- **What stood beside a title stands beside it:** «Оновити», «Оновити
  залишки», «До списку», «До списку накладних», «До списків», «До пошуку»,
  «+ Нова пропозиція», orders' «+».
- **A store that cannot be worked in**, for whoever has no right in it:
  its state is the heading, the line and «Змінити магазин» under it.
- **The old line** «{Магазин} · {Ім’я}» as the page's heading over every
  screen is gone, and with it the «·»'s second size.
- **Kept as it was:** the screens before a store opens («Бірка», the
  store's choice, sign-in, no access, the crash screen) until P1-4; every
  word; every heading's focus as its screen opens; the kept and settled
  banners over the screen.

No backend change. No right or rule changes.

## Decided here, not by the owner

- **The title and its line on the page, over the card**, as the design
  draws them, not inside the card where the old heading stood.
- **The results with a stub keep the line and «Змінити магазин»**, though
  the design draws S11 without a context line: the task list asks for
  «Змінити магазин» one tap from any screen of a store.
- **28 for every screen that is not a tab's first**, the results without a
  stub among them — the size their heading had; the order's card from 23
  to 28, the design's `title-l` (its К2).
- **«Повернення» stays the till's title on its way**: words are not this
  part's.
- **The headings inside a screen keep their levels**: a third level
  follows the page's heading where a second stood before. Renumbering
  them would restyle every third-level heading; it waits for each screen's
  own task.

## How it was built and proven

- **Files:**
  - new: `shared/ScreenHeader.tsx` (`ScreenHeader`, `WorkspaceLineContext`);
  - `App.tsx`: `StoreLine` gone; the workspace and a store that cannot be
    worked in give the line to every screen;
  - 29 screens' files: the `<h2>` and what stood beside it into a
    `ScreenHeader`, over the card; the order's card read with its «←» and
    its title's place in the head (`App.tsx`, `orders/Order.tsx`);
  - `styles.css`: the head's rules; the old line's, the toolbar's heading,
    orders' head and the order's title rules gone, the headings' focus in
    one rule;
  - `e2e/fixtures.ts`: `storeLine`, and `openStore` waits for it.
- **Journeys:** a new one in `till-sections.spec.ts` — a seller's «Продаж»,
  «Замовлення», «Каса» and «Ще» at 34, «Залишки» at 28 under «← Ще», each
  the page's one heading, «Центр · Ліда» under it and its card under both;
  and the owner's «Змінити магазин» journey checks the button stands on
  that line, at its right. Changed in 10 journey files and the fixtures:
  the store read from the line under the title, not from the page's
  heading; second-level titles read as first; «Каса»'s card with its
  heading over it; orders' «+» beside its title; the kept count watched at
  every level. The order's journey that holds its «←» and title in place
  while it is read passes unchanged.
- **Journeys:** 723.

## Review

An independent review of the uncommitted tree found every title moved —
none dropped or doubled, every focused heading still focused, nothing
depending on the order card's hidden section — and found, fixed before the
first commit:
- **The order's card moved as it came:** while it was read, or once its
  read failed, «← До замовлень» stood in the card, and the card's own came
  in the head above it. The head holds both now, the title's place held
  while it is read (orders task list, P2-2), and the store's line with
  them.
- **«← Каса», «← До боргів» and a debt's «←» lost their quiet line:** their
  rules were the cards' they left. One rule is the head's now.
- **A card's first line kept the room it had under the old heading** —
  `.cash-context`'s −4 px, a hint's 1 em: none now.
- **Five journeys looked for a title in its card, or a second level**; and
  the kept count's journey watched the second and third levels for
  «Підрахунок каси», so it would have passed whatever was drawn: it
  watches the first too.
- **Two store lines in the page under «Доставка»**: the order's card stays
  mounted, hidden, with its own head. A person sees one; the journeys'
  `storeLine` reads the shown one.

Not changed:
- **On S21 and the order's card the design's one line under the title is
  the screen's own** — «Дарина Мельник · «Центр» · з 01.10», «Центр ·
  Instagram · замовлено 13.10» — not the store's. Both stand now, the
  store's under the title and the screen's at the card's top. Which one
  stays there, and where «Змінити магазин» goes, is those screens' tasks'
  (the sections' task list).

## Evidence

- Locally on `feat/frame-titles`, against the E2E API and PostgreSQL 17:
  - before the review's fixes, on a fresh seed, 722 journeys: 715 passed.
    Five failed on the title moved out of its card and the order's place
    while read — the review's findings, fixed — one on the app's code that
    never arrives, which passed alone after, and `backups.spec.ts`;
  - after them, the nine files of the journeys changed or failed,
    `till-sections.spec.ts` with its new journey among them: 198 passed;
  - then all 723 again, on the same database: 694 passed. 26 failed and 3
    did not run, in ten files that list the seed's goods — a list paged,
    a count with more positions than its journey made — and
    `backups.spec.ts`; on a fresh seed those ten files passed, 103 of 103.
    `backups.spec.ts` finds 14 nights rather than 3: the local seed only
    adds, as before;
  - the throwaway screenshots at 360 × 640 — the till, «Замовлення» with
    its «+», a count under «← Каса», «Залишки» under «← Ще», an order, the
    owner's line with «Змінити магазин» — looked as the design draws them;
  - eslint, tsc and the build are clean: app 511.70 kB, parts 2.61 kB,
    icons 6.56 kB, vendor 210.85 kB. The app's own file is past the 500 kB
    warning; the build only warns.
- **CI:** GitHub Actions on the pull request.

## Not covered here

- **On a real phone:** the head at 360 px in Telegram, a long store or
  person's name on the line with «Змінити магазин».
- **The headings inside each screen** (third levels under the page's
  heading): with each screen's own task.
- **S21 and the order's card:** the screen's own line or the store's under
  the title (see the review).
- **The orders' «←»** keeps its bordered button, as before; the cash's,
  the debts' and «Ще»'s are quiet lines. One look for them comes with
  Telegram's «Назад» (P1-1).
- **The screens before a store opens:** P1-4.
- **The 500 kB warning:** still to choose — raise it, or load screens when
  opened.
- **«До відправлення»** is still a warning (В5 (а)). To ask the owner.
- **Next:** P1-1 (Telegram's «Назад» as the screen's «←»).
