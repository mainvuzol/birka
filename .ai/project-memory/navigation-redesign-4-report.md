# The bottom menu, fourth step: «Ще» by groups — 2026-10-26

Baseline: `42d3b62` (#142, on main), and the bottom menu's task list
([redesign/2026-10-26-redesign-tz-navigation.md](redesign/2026-10-26-redesign-tz-navigation.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`f4b566d`, and 20 of 20 ways of breaking it caught. The screen, its words and one
deviation (below) wait for the owner's approval; not yet tried on a real
phone.
Branch: `feat/navigation-more`. Task: P0-4; with it, the two texts the owner
changed.
Owner: business-rules.md, "after #142 was merged" (2026-10-26).

## Why this was next

When #142 was merged the owner approved «Товар» as built, changed two texts
that named places gone from «Ще», and chose P0-4 as the task list has it:
«Ще» opened a grid of equal buttons under the row, thirteen for the owner,
with no groups, two named otherwise than their screens; «Змінити магазин»
stood in the header, where the direction puts the store and the person
alone.

## What exists now

- **«Ще» is a screen of its own,** headed «Ще», its sections by groups —
  «Гроші» («Звіт про продажі»), «Постачальники» («Накладні»,
  «Постачальникам»), «Товар і каталог» («Перевірка каталогу», «Моделі»,
  «Початкові залишки»), «Мережа» («Магазини», «Резервні копії» with its
  «⚠») — a group with nothing in it not shown; a row each with its
  chevron, held by its own section's rule.
- **«Змінити магазин» at the bottom of «Ще»,** for whoever has two stores or
  more, held as the row is; the header «{Магазин} · {Ім’я}» alone.
- **«← Ще» over every section opened from «Ще»,** read «Назад до «Ще»»;
  «Ще» pressed again does the same; the focus stays on «Ще».
- **«Ще» in the row only when it holds something;** marked on its screen and
  on its sections.
- **The two texts:** «Ціну для всіх задає менеджер у «Товарі».» and «…а
  відсутній товар прийміть через «Товар» › «Прийшов товар».».
- **The taps** ([hot-path-budget-report.md](hot-path-budget-report.md)): a
  section of «Ще» 2 → 2; another store 1 → 2.

No backend change.

## Decided here, not by the owner

- **«Ще» and «← Ще» are held while a first send is in flight,** and only
  then. The task list says «Ще» is never held — written for a list opened
  over the screen, so that a manager owing «Каса» a reason could still
  reach it. «Ще» now leaves the screen: a sale's answer is said on the till
  alone, so whoever pressed «Ще» while it was sent would never see it, and
  might type the sale again. Held for those seconds only, «Ще» stays free
  while something is kept or a reason owed.
- **The focus stays on «Ще»** after a row is chosen or «← Ще» pressed, as it
  did when «Ще» was a list; the task list let that go with the list.
- **«← Ще» read «Назад до «Ще»»,** as «← Каса» and «← Товар».
- **«Змінити магазин» stays in the header of a store that cannot be worked
  in,** which has no «Ще».
- **The rows are the lists' own, 56 px.**
- **«Каса» joins «Гроші» with «Огляд» (P1-1):** until then the tab rule's
  first four are the row as it is, so nothing of it is built yet.

## How it was built and proven

- **`till-sections.spec.ts`:** a seller's «Ще» — «Товар і каталог» alone,
  «Перевірка каталогу»; «Ще» marked on its screen and on the section;
  «← Ще» and «Ще» again back to the groups; the focus on «Ще»; no «Змінити
  магазин» for one store; the owner's four groups and eight rows in order,
  each 56 px, the list's width, words whole, nothing wider than 360 px,
  «Змінити магазин» last and none in the header, «← Ще» from each of the
  eight; a manager's three groups, no «Мережа»; both themes at 4.5:1.
- **`till-redesign.spec.ts`:** nothing under «Ще» and one store, no «Ще»; two
  stores, «Ще» with «Змінити магазин» alone, no group; two stores chosen,
  the header without it, «Ще» with it last, and it works; a store that
  cannot be worked in, among two, keeps it in its header.
- **`till-receipt.spec.ts`:** while a sale is sent «Ще» is held, then free
  with the receipt said.
- **`stores.spec.ts`:** while a store's state is sent «← Ще» is held.
- **`cash.spec.ts`:** a reason owed — «Ще» opens; its rows and «Змінити
  магазин» held, «Каса» free.
- **The texts:** `till-search.spec.ts`, `orders-new.spec.ts`,
  `openings.spec.ts`.
- **The journeys' way there:** `more()` opens the screen, `sections()` finds
  the row's buttons and «Ще»'s, `changeStore()` presses «Змінити магазин» on
  «Ще»; «Каталог» and «Звіт» by their new names; where «Змінити магазин» in
  the header was the sign of the till held or free, the row's «Товар» is.
- **Journeys:** 658 — the whole run after the review's fixes passed but for
  the backups' night copy, known to fail on this machine.
- **Mutation:** 20 ways of breaking it, one at a time, after the unchanged tree passed
  with everything they name: all 20 caught
  ([`mutants.txt`](../../output/verification/2026-10-26-navigation-more/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
found the marks, the groups, every row's hold, the first screen and the kept
operations as they should be, and the texts word for word. It found, all
addressed before the first commit:
- **«Ще» and «← Ще» never held** let a screen be left while its first send
  was in flight, its answer lost (a sale's receipt or refusal). Held for
  that time now; see above.
- **The focus fell to the page** after a row or «← Ще». Now on «Ще».
- **An empty «Ще» landmark** for whoever has only «Змінити магазин». None
  now.
- **The header's dead code.** Gone.
- **Untested:** a manager's «Ще»; «Ще» hidden with nothing in it; a store
  that cannot be worked in, among two; «← Ще» on four of eight sections.
  Now each is. **Two checks that proved nothing** — «Змінити магазин» absent
  where it never is, a section pressed without waiting for it. Now they do.
- **A stale comment.** Now not.

Found on the way, by the screens: the generic rules for a row of buttons in
a `nav` shrank «Ще»'s rows to their words. «Ще»'s list is out of them now,
and a journey checks every row is the list's width.

## Evidence

- [`output/verification/2026-10-26-navigation-more/`](../../output/verification/2026-10-26-navigation-more/):
  `mutants.py`, `mutants.txt`, `screens/` (the owner's «Ще», a seller's in
  both themes).
- **CI, run locally at `f4b566d`**
  ([summary](../../output/verification/2026-10-26-navigation-more-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 468 on PostgreSQL 17;
  - e2e: 658 journeys;
  - hot path: worst p95 96.3 ms (every warehouse by six sellers) and
    111.0 ms (`POST /sales`, the same coat by six sellers), within 300 and
    500;
  - frontend: eslint and tsc clean, the build; `npm audit` 0;
  - python-audit: 43 packages, 0 known vulnerabilities;
  - restore drill and edge passed.

  The first run, at `a6605c5`, passed every job but one journey of 658:
  `stock.spec.ts` waited for the first stock list answered, and the till —
  open first, reading the same address for its own warehouse — answered
  after the stock's was asked; «Товар» a tap away (P0-3) made that race
  likelier. It now waits for the chosen warehouse's list (`f4b566d`), three
  runs of it passed, and the run above is at that commit.

## Not covered here

- **On a real phone:** «Ще» under a thumb, the owner's scrolled.
- **For the owner:** the screen; «Ще» held while a send is in flight.
- **Left:** the task list's P0-5, P0-6, P1-1, P1-2 and P2.
