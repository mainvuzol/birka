# The bottom menu, third step: «Товар», the minimal one — 2026-10-26

Baseline: `416c05c` (#141, on main), and the bottom menu's task list
([redesign/2026-10-26-redesign-tz-navigation.md](redesign/2026-10-26-redesign-tz-navigation.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`1365b0b`, and 19 of 19 ways of breaking it caught, as the runner stands. The
section, its tiles and their icons wait for the owner's approval by the
screens; not yet tried on a real phone.
Branch: `feat/navigation-goods`. Task: P0-3; with it, the receipt's
sentence the owner changed.
Owner: business-rules.md, "after #141 was merged" (2026-10-26).

## Why this was next

When #141 was merged the owner approved «Клієнти» as built, chose the
receipt's «Наступні внески — у розділі «Клієнти».», and chose P0-3 with the
task list's words: what is in stock and what came in is the second thing a
seller does after selling — one page of the notebook — but «Приймання»,
«Залишки» and «Брак» were three entries under «Ще», two taps each, and how
many units wait in «Брак» was seen only inside it.

## What exists now

- **The row: «Продаж · Товар · Клієнти · Каса · Ще».** A seller's «Ще»
  holds «Каталог». «Товар» stands for the stock, receiving and «Брак»,
  marked on each, shown with any of their rights.
- **«Товар» is the stock's screen,** headed «Товар», «Оновити залишки»
  beside it; under the heading two tiles, each by its own right:
  «Прийшов товар», leading to «Приймання товару», and «Брак» with how many
  units wait — «2 очікують перевірки», «1 очікує перевірки», «нічого не
  чекає» — grey while read, and no line if unread. One alone the whole
  width. The stock's list below, unchanged. Whoever may not read the stock
  has the heading and the tiles alone, told nothing of the rule.
- **«← Товар» over «Приймання товару» and «Брак»,** read «Назад до
  товару»; it, the tiles and the row held together.
- **The receipt of a sale paid in parts** says «Наступні внески — у розділі
  «Клієнти».».
- **The taps** ([hot-path-budget-report.md](hot-path-budget-report.md)): the
  stock 2 → 1, receiving 2 → 2, «Брак» 2 → 2.

No backend change.

## Decided here, not by the owner

- **The tiles' icons:** an arrow into a tray, a tag with a cross, drawn
  here; the app has no icon set before the bottom menu (P0-6).
- **One unit: «1 очікує перевірки»** (and 21, 31…), the task list naming
  only «2 очікують перевірки».
- **«← Товар» read «Назад до товару»,** as «← Каса» is read «Назад до
  каси»; held with the row; leaving receiving drops the lines typed, as
  leaving for any section did, and as «← До замовлень» does on a new order.
- **Whoever neither sells nor reads orders opens on «Товар»,** now the
  first section shown (the rule of §3, п. 4, unchanged).
- **Texts kept, the owner's words:** the till's «Решту — у «Боргах» цього
  магазину.», an order's «Клієнт забрав» «Наступні внески — у «Боргах».»,
  the price hint «Ціну для всіх задає менеджер у «Залишках».» and
  «Початкові залишки»'s «…а відсутній товар прийміть через «Приймання».».

## How it was built and proven

- **`till-sections.spec.ts`:** the row «Продаж · Товар · Клієнти · Каса ·
  Ще» in one line at 360 px, «Ще» with «Каталог»; «Товар» a tap, receiving
  and «Брак» two, counted by the page's own `pointerdown`; «Товар» marked on
  each, «Ще» not; the tiles in a row, 64 px or more, their words whole;
  «← Товар» back, read «Назад до товару»; «Ще» opened over the tiles or over
  «Брак» not opened again by a tile or «← Товар»; «Брак»'s count from a
  stubbed read — two waiting of four, none, one, grey while read, no line
  when unread or read again and refused; both themes at 4.5:1, the icons at
  3:1; whoever reads orders alone opens on them with «Товар», «Клієнти» and
  «Ще»; whoever has neither opens on «Товар».
- **`stock.spec.ts`:** without the right to the stock, «Товар» is its tiles
  alone, nothing said; without any of the three, no «Товар».
- **`receive.spec.ts`, `damaged.spec.ts`:** without its right, a tile gone,
  the other alone the whole width.
- **`stores.spec.ts`:** a store that does not trade has no «Прийшов товар»,
  its «Брак» read.
- **`outage.spec.ts`:** a kept delivery opens on «Приймання товару»,
  «Товар» marked, it and «← Товар» held; a kept correction on «Товар»,
  marked, its tile held.
- **`credits.spec.ts`:** the receipt's new sentence.
- **Held where «Залишки» was:** `models`, `suppliers`, `supplier-invoices`,
  `stores`, `sale`.
- **The journeys' way there:** `section(page, "Залишки")`, «Приймання» and
  «Брак» go through «Товар» and its tile.
- **Journeys:** 653 in the whole run before the review — every one passed
  but the backups' night copy, known to fail on this machine; after the
  review's fixes, the eight specs it touched and the kept operations.
- **Mutation:** 20 ways of breaking it, one at a time, after the
  unchanged tree passed with everything they name: 18 caught. The two left
  were one fix seen twice — the tile's closing of «Ще» and «← Товар»'s,
  each covering the other, so neither alone could be seen. They became one
  helper, `goodsTo`, and its one mutant was caught: 19 of 19 as the runner
  stands
  ([`mutants.txt`](../../output/verification/2026-10-26-navigation-goods/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
found «Товар» marked on each of its screens, the kept operations landing
where they should, the holds and the rights right, the first screen by the
rule, and only the units waiting counted, read again after every action.
It found, all addressed before the first commit:
- **«Ще» opened again by itself:** opened over the tiles and left by a tile,
  «← Товар» brought it back. A tile and «← Товар» now close it.
- **«← Товар» read as «Товар»,** the row's name. Now «Назад до товару».
- **A count kept after a read refused,** once one had been read; the screen
  said none. Now no line.
- **Untested:** «Ще» not marked on receiving and «Брак», a kept correction
  on «Товар», one tile the whole width, no «Товар» without its three
  rights, «нічого не чекає» for none at all. Now each is.
- **Three checks that only saw the row** under an open «Ще». Now
  «Каталог».
- **Stale titles and comments.** Now not.

Not changed, for the owner: the two texts that still name «Залишки» and
«Приймання» (above); «Товар прийнято» has no «← Товар» (the task list puts
it over the form; the row's «Товар» leads back); focus after a tile goes to
the page, as after «← Каса».

## Evidence

- [`output/verification/2026-10-26-navigation-goods/`](../../output/verification/2026-10-26-navigation-goods/):
  `mutants.py`, `mutants.txt`, `screens/` («Товар» and its tiles, both
  themes).
- **CI, run locally at `1365b0b`**
  ([summary](../../output/verification/2026-10-26-navigation-goods-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 468 on PostgreSQL 17;
  - e2e: 654 journeys;
  - hot path: worst p95 92.9 ms (the search by six sellers) and 71.5 ms
    (`POST /sales`, the same coat by six sellers), within 300 and 500;
  - frontend: eslint and tsc clean, the build; `npm audit` 0;
  - python-audit: 43 packages, 0 known vulnerabilities;
  - restore drill and edge passed.

## Not covered here

- **On a real phone:** «Товар» and its tiles under a thumb.
- **For the owner:** the tiles and their icons; the two texts above.
- **Left:** the task list's P0-4…P0-6, P1-1, P1-2 and P2; «Товар» whole,
  its own task list (В1).
