# «Повернення»'s list in the new design — 2026-10-17

Baseline: `353c5d3` (both warehouses in the till's search, PR #98).
Status: TODO.
Branch: `feat/returns-list`. Tasks: [the returns task list](redesign/2026-10-17-redesign-tz-returns.md),
P0-1, P0-2 (with P1-1's button). Owner: business-rules.md, "«Повернення» in
the new design: its task list's questions" (2026-10-17).

## Why this was next

With the till's task list done, the owner chose «Повернення» next, the
counter's second section; its task list was written the same day and its
six questions answered. Two of its first tasks were chosen to start. To
return a coat the seller read two lines of explanation, chose «Де купили»,
pressed «Знайти» and found their sale among twenty identical «Оформити
повернення»; every sale of the store showed its sum, a colleague's of the
day among them, before the drawer was counted; and a third «Показати ще»
broke the list with words about an order.

## What exists now

- **«Що повертають?»** searches as it is typed, from two letters, after a
  pause, as the till does; Enter searches at once; a search with nothing
  found says so and is cleared in one tap.
- **The sales by day,** «Сьогодні», «Вчора», «15 жовтня», newest first.
  A row is the sale's goods, «Лоран шоколад · M» (two, then «+ ще N»,
  «… · повернено 1 шт.»), its hour and count, «14:32 · 1 шт.», and its
  marks: «Оплата частинами», «Продано з паперу» / «Продано під час збою»,
  «Магазин «Другий»», «Усе вже повернено». **No sum and no way, for
  anyone** (G32; owner, В1): the sum shows once a sale is opened.
- **The whole row opens the sale,** a target of 56 px, named «Оформити
  повернення: Лоран шоколад · M, 14:32» for a screen reader; a sale
  returned whole opens nothing.
- **«Оновити» and the two lines of explanation are gone;** the list is
  read again when the section opens and the app comes back.
- **«Шукати в інших магазинах мережі»** stands under the results (owner,
  В3), and «Шукати в цьому магазині» brings this store's back; what was
  typed is kept. Only the button moved: the rest of P1-1 is to do.
- **A list read again and refused says so** above the rows it had, with
  «Спробувати ще раз»; back from a sale, the list is read again, so a
  return refused because part of it came back meanwhile finds it.
- **A search typed keeps the list in place** until the new one comes —
  this store's or the other stores', never one for the other.
- **«Показати ще» reads twenty more at a time,** by `offset`, never past
  the server's fifty; a sale read twice across a page's edge is shown once;
  a page that cannot be read keeps those read, with «Спробувати ще раз».

Nothing about money, stock or who may do what changes. The server is
untouched; it still sends each sale's `total`, which the list no longer
shows (the task list's §12).

## Decided here, not by the owner

- **«Де купили» became the button under the results now,** with P0-1,
  rather than a quiet button above them: only the heading and the field
  stand above the sales at 360 px, as P0-1 asks, and the owner chose the
  button under them (В3).
- **The days by the phone's own clock,** as the hour in the row already
  was; a year is named only when it is not this one.
- **A row names two of a sale's lines,** then «+ ще N».
- **For a screen reader** a row is «Оформити повернення: Лоран шоколад ·
  M, 14:32» — with its day when it is not today's — and its marks are its
  description.
- **A sale's hour and day are when it was typed,** as before: a sale typed
  from the first days' paper lies under «Сьогодні», not under the paper's
  day; the mark says it is from paper.

## How it was built and proven

- **The list** (`returns-list.spec.ts`, 10; the store's sales stubbed):
  - no sum and no way in the list, this store's or the other stores'; the
    sale opened shows its sum; the marks seen, and heard as the row's
    description; a sale returned whole has nothing to press;
  - the search on a clock that moves only when told: one letter asks
    nothing, three letters ask once the pause is over, Enter asks at once
    with the clock still; nothing found is said and cleared in one tap,
    the cursor back in the field;
  - a search typed keeps the rows until its answer comes, with no
    «Завантажуємо…»;
  - «Показати ще» twice over forty-five sales: twenty at a time by offset,
    never more; a sale read twice across a page's edge shown once; a page
    refused keeping those read, with «Спробувати ще раз»;
  - the list read again and refused, said above the rows it had; back
    from a sale, the list read again;
  - at 360 px only the heading and the field above the sales, by day, a
    row a target of 44 px or more, the other stores' button under them.
- **The journeys before** (`returns`, `returns-elsewhere`,
  `outage-mark-debts-returns`, `credits`, `outside-text`, `till-receipt`,
  `outage`): the field «Що повертають?» and Enter where «Знайти» was, the
  other stores by the button, the new words.
- **Mutation:** seventeen ways of breaking it, one at a time, each
  against the journeys meant to catch it, after the unchanged tree passed:
  all caught on the first run
  (`output/verification/2026-10-17-returns-list/`) — a sum back in the
  row, a row that opens nothing or a sale returned whole that opens, the
  search waiting for Enter or Enter doing nothing, one letter filtering,
  the limit growing again, a sale shown twice, a failed page losing the
  list or offering nothing, a list read again and refused saying nothing,
  back not reading it again, a search blanking the list, the days unheaded,
  the marks not described, the other stores never searched, «Очистити»
  keeping the words.

## Review

An independent review before the first commit found the list free of sums
and ways, the paging unable to skip a sale, the receipt's sale opened from
a fresh read and the days right across midnight, months, the new year and
the clock's changes, and the following, all addressed before the first
commit:
- **A blocker:** a list read again and refused kept its old rows and said
  nothing — the till's receipt opening a return while the server was down
  showed a stale list. It says so now, above the rows, with «Спробувати ще
  раз».
- **A return refused because part came back meanwhile** sent the seller
  back to a list never read again: going back reads it now, and the words
  say the list shows what may come back.
- **Unproven:** Enter searching at once, the other stores' list without
  sums, the layout at 360 px, which only looked for some elements — each
  proven now.
- **A screen reader** never heard a row's marks or its day: they are its
  description and its name.
- **The docs claimed P1-1 done;** only its button moved, and the rest is
  named.
- **Smaller:** the list kept while a search loads, the field at the
  server's hundred letters, «Показати ще» and «Спробувати ще раз» waiting
  for a read in progress, the cursor back after «Очистити».

## Evidence

TODO

## Not covered here

- **On a real phone:** the rows at 360 px and the field with the keyboard
  open, in Telegram's own web view, on Android and on iOS.
- **The rest of the task list:** one sale's screen (P0-3), the bottom
  panel (P0-4), the result (P0-5), and the P1 and P2 tasks.
- **The server still sends `total`** in the list: the blind count holds on
  the screens (ADR-0012), as the task list's §12 records.
- **Not measured:** the taps from the till to the form (2 → 2, 4 → 3); the
  return screens in the dark theme.
- **«Показати ще» against the real server:** the journeys page a stubbed
  list; the server's own paging is its tests'.
- **The rest of P1-1:** its words, shown from two letters, the other
  stores' heading, warehouse chips.
