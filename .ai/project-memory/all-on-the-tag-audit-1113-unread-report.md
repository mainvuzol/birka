# «Усе на бірці», audit 2026-11-13, batch 1: «Сьогодні»'s places never read say «не вдалося прочитати», one «Спробувати ще раз» a tag; a failed next page in four «Товар» lists keeps the rows, one plate at the foot; an order step's refusal said where it was pressed (frame P1-1, goods P1-1, orders-cash P1-1) — 2026-11-13

Baseline: `2a6551b3` (the audit after stage 2's eighteenth batch, PR #201,
merged). The new audit of the whole app was written the same day
(`.ai/project-memory/redesign/2026-11-13-redesign-tz-audit-{frame,sale,orders-cash,money,goods}.md`
and their `-owner.md`; no P0, nine P1). This batch is the user's pick,
«Unread and refusals»: the first P1 of three of its task lists. The audit's
documents go with it.

Status: built and proven in the journeys (the full run before the review's
fixes 1093 of 1095 — the stand's own `backups:93`, and `design-system:750`,
this batch's, its list brought up to date; the six specs touched after them
176 of 176); 50 of 50 mutants caught; the review's findings fixed; not
committed.
Not yet seen on a real phone.
- Branch: `feat/audit-1113-unread`.
- Task: the audit's first batch, picked after the audit was written
  (2026-11-13, «Unread and refusals»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-13 (audit
  2026-11-13, batch 1: …)".

Where it stood:
- «Сьогодні»: a read that failed before it ever answered stayed a grey
  place for good — the day's total, a store's sum, drawer and debts lines,
  the online orders' line, «Чекає на вас»'s place; only the stamp said
  «не вдалося прочитати», and nothing asked it again.
- «Товар»: a failed next page hid every row read in the stocktake's lists
  and in «Розбіжності»; in «Залишки» and a list's lines its plate stood
  over the rows with «Показати ще» still at the foot — two buttons for one
  page, the plate's reading the whole list again.
- «Замовлення»: an order's step refused — «Прибув на пошту» on its row or
  card, «Скасувати замовлення», «Прийняти повернення» — was said by the
  app's banner above the screen's title, and everything under it moved
  down by ≈ 80–100 px under the finger.

## What exists now

- **«Сьогодні»** (frame P1-1; `frontend/src/today/Today.tsx`, `age.tsx`,
  `waiting.ts`):
  - a figure whose read failed before it ever answered says «не вдалося
    прочитати» in its place (`pencil`, meta), never a grey line: the day's
    total, each store's sum, drawer and debts, the online orders' line, the
    folded line;
  - one plate at the day-tag's foot (`Unreads`, the shared `Unread`),
    however many of its reads failed; its «Спробувати ще раз» asks only
    those again; the server silent, «Сервер не відповідає.»; folded, the
    plate under the folded line;
  - «Чекає на вас»: its reads failed before answering — the plate in the
    grey tag's place, never «Вас нічого не чекає.»;
  - nothing read at all and a read failed: no stamp; what was read and
    failed later keeps its figures, its stamp and no plate, as before.
- **Four «Товар» lists** (goods P1-1; `frontend/src/inventory/Stocktake.tsx`,
  `Stock.tsx`, `frontend/src/openings/Openings.tsx`): «Не пораховані» and
  «Пораховані», a finished stocktake's «Розбіжності», «Залишки», a list's
  lines — batch 14's shared form (`useNextPageFailed`):
  - a next page refused: the rows stand, one plate at the foot in «Показати
    ще»'s place, its retry reading that page alone; the cursor on the first
    position it brings (the stocktake, «Залишки»);
  - read again whole and refused: the plate over the rows, which stand,
    «Показати ще» held under it;
  - refused for the right (403): nothing read before in sight, in all four
    (the shared `denied`, `frontend/src/shared/api.ts`).
- **An order's step refused** (orders-cash P1-1; `frontend/src/App.tsx`,
  `frontend/src/orders/{StepRefused,Orders,Order,Returned,types}.ts(x)`):
  - «Прибув на пошту» on its row: under its tag, inside its row; its order
    moved on meanwhile, where its tag stood until the next tap;
  - the card's steps, a moved-on sheet's step: at the card's foot, over the
    dock;
  - «Прийняти повернення»: under the tick; the order taken back meanwhile,
    at the card's foot;
  - the cursor on it, scrolled to only when out of sight; nothing above it
    moves;
  - forgotten with its screen; a kept step's refusal and the «… ще не
    підтверджено» banners at the app's top, as before.

## The independent review

An independent review (a fresh agent, the diff, the three points of the
task lists; no conclusions handed to it) found:
- **High, fixed:** after the first row refusal every later one was silent —
  the refusal's count restarted at 1 with each step, so the list took the
  second for the first already heard, and the app's banner stood aside.
  Now one count for the page (`nextRefusal`); a journey refuses twice.
- **Medium, fixed:**
  - the refusal outlived its screen: a card opened again later brought it
    back with the cursor and a scroll to the card's foot; the return's,
    after «←», came onto the card; a card left before the answer had it
    said nowhere. Now it is forgotten with its screen as a new order's is
    (`forgetStep`), and while its place is not on the screen the app's
    banner says it, as before; drawn again it is not brought to the cursor
    again;
  - its dismissal on the next touch moved the rows under that touch before
    the tap landed. Now the plate under its tag stays until the next step,
    place or search; the one where a moved-on tag stood goes once the next
    tap is delivered.
- **Low–medium, fixed:** the stocktake's cursor aim outlived its list and
  a refused page: the other list's page, or a later read, could move the
  cursor. Now forgotten on either.
- **Low, fixed:** the plate where a moved-on tag stood was drawn anew
  whenever the rows read again changed — a second cursor jump and a second
  announcement. Now its own keyed place.
- **Low, left for the owner:** at 360 px the column's «не вдалося
  прочитати» takes two lines where the task list asked one (the debts'
  line does too); the journey checks two at most.
- **Coverage, added:** a second row refusal and the moved-on place
  (`orders-list`, new); a card opened again after a refusal (`orders-list`,
  the cancel's); the return's left by «←» (`orders-card`).
- **Checked and fine** (the review's words): the banner and the plate never
  together; a kept step's refusal keeps the banner; the reserve's and the
  sheets' unchanged; a card's refusal only on its own order; every state of
  `useNextPageFailed` in all four lists, 403 hiding the rows; «Сьогодні»'s
  retries asking only what failed; the stamp never claiming a time with
  nothing read.

## How it was built and proven

**Code:**
- `frontend/src/today/Today.tsx`, `age.tsx` (`UNREAD`, `failedOf`,
  `Unreads`), `waiting.ts` (`unreadFailed`, `unreadPending`).
- `frontend/src/inventory/Stocktake.tsx`, `Stock.tsx`,
  `frontend/src/openings/Openings.tsx`, `frontend/src/shared/api.ts`
  (`denied`).
- `frontend/src/App.tsx`, `frontend/src/orders/StepRefused.tsx` (new),
  `Orders.tsx`, `Order.tsx`, `Returned.tsx`, `types.ts`.
- `frontend/src/styles.css`: `.day-unread`, `.day-total-unread`, the plates'
  margins, `.step-refused`'s.
- No backend change.

**Journeys:** 1097 in all; 1089 before.
- New (8):
  - `today` (3): the report and a drawer unread at 360, light and dark;
    under 700 px nothing read; the tag unfolded and nothing read;
  - `stocktake` (2): «Пораховані»'s next page refused, then the whole list;
    a finished stocktake's «Розбіжності», a next page refused;
  - `stock` (1): read again and refused for anything but the right;
  - `openings` (1): a list's next page of lines refused, the whole list
    refused before and after it, «Показати ще» held;
  - `orders-list` (1): a row's step refused as another phone moved its
    order on, twice, among eight parcels, nothing scrolled; a card opened
    forgetting it.
- Changed:
  - `today`: the report unread, a read that fails hides nothing else,
    «Чекає на вас»'s failed read;
  - `stocktake`: the long count, a page refused once;
  - `stock`: the paging journey, the first next page refused once;
  - `today`: the stamp's — read before and failed since, no plate;
  - `orders-list`: the row's refusal under its tag, nothing above it moved;
    the cancel's at the card's foot, its title where it stood on the page,
    left and opened again with nothing said;
  - `orders-card`: the return's under the tick, left by «←» and opened
    again with nothing said, then taken back meanwhile — at the card's foot;
  - `design-system`: the screens that say what they could not read include
    «Сьогодні».

## Mutants

`mutate49.py`, 50 mutants, each applied alone, its journey run, the source
restored (`mutants49.sh`, the stand reseeded before each `openings` one):
50 of 50 caught, each at the check meant for it.
- «Сьогодні» (15): a read that answered once taken for one never read; the
  retry asking every read, or only the first that failed; the drawer's,
  the debts', a store's sum's, the total's, the folded line's words
  waiting grey; the tag's plate, the folded plate gone; the stamp over
  nothing read, folded and not; the online line waiting for good; «Чекає
  на вас»'s grey place kept beside its plate, or its plate gone.
- «Залишки» (5): 403 keeping the tags; the read-again plate gone; the tags
  hidden under it; the foot's plate gone; its retry reading every page.
- «Інвентаризація» (9): the foot's plate gone; its retry reading every
  page; the cursor not on «Перерахувати», or not moved; the read-again plate
  gone; «Пораховані» taking «Не пораховані»'s page state; «Показати ще» not
  held; «Розбіжності»'s plate gone, or every difference hidden.
- A list's lines (4): the foot's plate gone; a second plate over the
  lines; «Показати ще» not held; the lines hidden by any refusal.
- An order's step (17): said nowhere; a row's said on the card; a
  return's on the card; the banner beside the plate; the row's, the
  card's, the return's plate gone; the moved-on return's gone; no cursor; a
  scroll though in sight; the count restarting (the review's high); the
  next tap not letting it go; placed at the list's end; the cursor not
  back after a redraw; not forgotten with its screen, or its words left
  for the banner; the return's carried onto the card.
- The first pass had 50, 48 caught. Two lived, and each found a check
  missing: `tfailedof` — a read that answered once, then failed, drew the
  plate unseen; the stamp's journey now checks no plate, the task list's
  own criterion. `oscroll` — a scroll to a plate already in sight went
  unseen on a page too short to scroll; the moved-on journey now holds
  eight parcels and checks the screen did not scroll.

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1093 of
  1095 in 30.9 min. The two: `backups:93` — the stand's own, as in every
  full run since batch 8; `design-system:750` — this batch's: «Сьогодні»
  now draws a plate when every read fails, and the journey's list of such
  screens said it did not; brought up to date.
- After the review's fixes, the six specs touched (`orders-list`,
  `orders-card`, `today`, `stocktake`, `openings`, `design-system`) on a
  fresh seed: 176 of 176 in 5.2 min. The fixes touch the orders' files, the
  stocktake's cursor and these specs alone.
- Seen at 360 × 800, light and dark (the journey's screenshots): a store's
  drawer unread in its column, two lines, nothing past it.
- Types: `tsc --noEmit` clean; ESLint clean on every file touched; Prettier
  clean on what this batch changed — `App.tsx`, `Today.tsx`, `waiting.ts`
  and `today.spec.ts` are unformatted on main and left so outside it;
  `styles.css` left as on main.

## Not covered

- A real phone; Telegram's MainButton over the card's foot plate.
- «Залишки»'s «Показати ще» held under the read-again plate: its stand has
  one page; the same rule is proven in «Пораховані» and a list's lines.
- The stocktake's cursor aim forgotten with the other list or a refused
  page: no journey.
- The card's MainButton «Прибув на пошту» refused (the cancel's place is
  the same), and a card left before its step's answer (the banner, as
  before): no journey.
- The goods lists' plates at 360 in the dark: the shared `Unread`, seen in
  earlier batches; not screenshotted here.

## For the owner

- **Done:** «Сьогодні» says what it could not read where the figure would
  stand, with one «Спробувати ще раз» a tag; a long count, «Залишки» and a
  list's lines keep what was read when the next page fails; a refused
  order step is said under the finger, nothing above it moving.
- **To read** (decided here): no stamp when nothing was read; «Чекає на
  вас» its own plate; 403 hides what was read in every list, other
  refusals keep it; the cursor on the first position brought; a row's
  refusal kept until the next step, a moved-on one until the next tap;
  forgotten with its screen.
- **A deviation:** at 360 px the store's column says «не вдалося прочитати»
  in two lines — the task list asked one; the debts' line wraps the same
  way.
- **Still open:** the audit's new questions (В13-П1/П2, В13-З1, В13-Г1/Г2,
  В13-Т1/Т2); «Каса»'s and orders' refusals by В-П1 (batch 15);
  «Закриття · Центр»; «Продано»'s stub words; the «Початкові залишки» hold
  line; the readings of batches 16–18.
