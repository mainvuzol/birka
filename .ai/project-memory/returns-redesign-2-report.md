# One sale's return and its result in the new design — 2026-10-17

Baseline: `602b2d0` («Повернення»'s list, PR #99).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-nine of twenty-nine ways of breaking it caught. Not yet tried on a
real phone.
Branch: `feat/returns-sale-screen`. Tasks: [the returns task list](redesign/2026-10-17-redesign-tz-returns.md),
P0-3, P0-4, P0-5. Owner: business-rules.md, "«Повернення» in the new
design: its task list's questions" (2026-10-17; В2 (а), В6 (а)).

## Why this was next

With the list done, the user chose the task list's next three: one sale's
screen, the panel under the thumb, and the result. To return a coat the
seller typed counts on the keyboard into «Цілих» and «Пошкоджених», read up
to three lines of explanation, found the way and the button at the bottom
of a long form, and was told what to hand back in an ordinary paragraph
above the same list of twenty sales.

## What exists now

- **One sale's screen** (P0-3): «Повернення» and «← До списку»; one line,
  «Продаж 17.10, 14:32 · 6 000,00 грн» (« · магазин «Другий»» for another
  store's), the sale's own sum (G33); its marks as pills, «Оплата
  частинами», «Продано з паперу» / «Продано під час збою»; the paper switch
  as before.
  - **Each line a tag,** «Лоран шоколад · M», «3 000,00 грн за 1 шт. ·
    можна повернути 2 шт.» (« · уже повернено 1 шт.»), and two rows,
    «Цілі [−] 0 [+]» and «Пошкоджені [−] 0 [+]», targets of 48 px,
    «Пошкоджені» in the colour of «Брак». **Nothing is counted
    beforehand:** the state of each unit is the seller's to name (owner
    decisions, 2026-09-15, §3). «+» stops at what may still come back, the
    two rows sharing it; the server checks it again (I9).
  - **One line of explanation:** another store's sale, «Куплено в іншому
    магазині: гроші віддаєте ви, пошкоджене лишається у вашому «Браку».»;
    a sale paid in parts says its part in the panel.
  - **The reason behind «Додати причину»,** the field then opened with its
    hint, «Без імен і телефонів покупців.»
  - **No field opens the keyboard,** and nothing can be typed wrong: the
    input errors are gone.
- **The panel under the thumb** (P0-4), as the till's, once a unit is
  counted: what comes back, «Лоран шоколад · M × 1» or «Повертають 3 шт.»;
  «Повернути 3 000,00 грн» large — paid in parts, «Товар на 1 500,00 грн»
  and «Спершу зменшимо борг; скільки віддати — покажемо після.» (В6 (а));
  a switch «Готівкою | На картку | Переказом», the sale's own way chosen
  (G4, G5), none when it suggests none; and one button, its words as
  before — «Повернути покупцю 3 000,00 грн готівкою», «З паперу · …», paid
  in parts «Повернути товар на 1 500,00 грн». From paper, the large line
  carries the button's «З паперу · ». A way that cannot be read says «Не
  вдалося прочитати, як платили. Оберіть, як повертаєте.» The panel's
  height is kept clear, and each tag counted is brought above it.
- **The result** (P0-5), in place of the form, as the till's receipt:
  «Повернення записано»; the sum to hand back, large, from the server's
  answer, never worked out on the phone, with the way as a pill over it,
  «Готівка · Поверніть покупцю», «Картка · Поверніть на картку через
  термінал», «Переказ · Надішліть покупцю переказом»; a screen reader hears
  the one sentence, «Поверніть покупцю 3 000,00 грн готівкою.»
  - Paid in parts with nothing back: «0,00 грн» and «Грошей покупцю не
    повертаємо.», then the debt's fall and what is still owed, as before.
  - Typed from paper: its mark, «Уже повернули під час збою» / «Уже
    повернули раніше» over the sum, and «… повернули під час збою — вдруге
    не повертайте.»; never «Поверніть».
  - **Where the goods went, by the answer's lines:** «Цілі: 1 шт. — на
    склад, з якого продали.», or «— на склад «Склад Б» вашого магазину.»;
    «Пошкоджені: 1 шт. — у «Брак».», with «Перевірити можна в розділі
    «Брак».» only for whoever handles «Брак».
  - **«Новий продаж»** opens the till with the cursor in its search (В2
    (а): a mistake is mended by selling again); **«Ще повернення»** goes
    back to the list as it was searched. Whoever may not sell is offered
    «До списку».

Nothing about money, stock or who may do what changes; the body sent is the
same, and the server is untouched.

## Decided here, not by the owner

- **From paper, the panel's large line says «З паперу · Повернути …»,** as
  the button does, and a sale in parts does not say «скільки віддати —
  покажемо після»: the money went back already. The task list does not
  speak of paper in the panel; the owner may want to confirm the words.
- **«Не вдалося прочитати, як платили. Оберіть, як повертаєте.»** shows for
  a sale paid in parts too, as the task list writes it, though its way is
  still not required (G35); the owner may want words of their own there.
- **One line in the panel always carries «× N»,** «Лоран шоколад · M × 1»,
  as the task list's example writes it; the till's leaves out «× 1».
- **The way's group names** — «Як повертаємо гроші», the paper's and the
  parts' — are heard, not seen: the large line and its note say the rest.
- **Another store's own warehouse is asked for once an intact unit of that
  line is counted;** until it is chosen the button says «Оберіть склад для
  цілого товару». The alert and «Вкажіть, що повертають» went with the
  typed counts.
- **Two texts keep their words:** «Борг покупця зменшено на …» (the task
  list's solution shortens it, but its texts list no change and its
  criteria look for the old sentence), and «Товар куплено в іншому магазині
  мережі — гроші віддаєте ви.» («без изменений», though quoted without
  «Товар»).
- **Whoever may not sell gets «До списку» alone,** not that and «Ще
  повернення», which go to the same list.
- **«Новий продаж» is held while the app is held,** as the sections are.
- **The context line names a year** only when it is not this one.
- **For a screen reader and the thumb:** the result takes the focus on its
  heading; each count is heard as «Цілі: 1»; the tag counted, the
  warehouse it then asks for, and a refusal are brought above the panel.
- **The other store's explanation** is one sentence, but two lines at
  360 px.

## How it was built and proven

- **One sale's screen, the panel and the result** (`returns-sale-screen.spec.ts`,
  10; the sale, its way and the answer stubbed, a phone of 360 × 640):
  - before a tap: 9 things to see, as the task list counts them, nothing
    to type in and nothing to press; with a unit counted, 13; the sum, the
    way and the button wholly in view, the tag above the panel; the large
    sum the button's; no sideways scroll; the count heard as «Цілі: 1»;
  - the way not read: said, nothing chosen, the seller's own sent; the
    result's sum the server's, 2 950,00 грн where the phone had 3 000,00,
    the pill and the sum hidden from a screen reader, which hears the one
    sentence;
  - two lines: each tag counts its own, «Повертають 3 шт.», a line part of
    which came back says «уже повернено 1 шт.» and stops at what is left;
    the body as counted;
  - a return refused: said above the panel, in view, the counts kept;
  - without «Брак» and the till: no pointer to «Брак», «До списку» alone;
  - paid in parts and suggesting no way: none chosen, «Повернути товар на
    …» sent without one (G35), «0,00 грн» and «Грошей покупцю не
    повертаємо.»;
  - from paper: «З паперу · Товар на …», no word of what comes later;
  - a warehouse to choose: brought above the panel with its tag;
  - light and dark: the tags, the panel and the result at 4.5:1 or more.
- **The journeys before, on the real API** (`returns`, `returns-elsewhere`,
  `credits`, `outage-mark-debts-returns`, `till-receipt`, `returns-list`):
  every count tapped with `returnUnits`, never typed; nothing to press
  before a tap; «+» and «−» stopping at their ends; «Додати причину»
  focusing its field; the panel's button and ways held while a return's
  answer is unknown; the result's pill, sum and goods; «Ще повернення»
  back to the list as searched; «Новий продаж» from a receipt's return to
  the till with the cursor in its search.
- **Mutation:** twenty-nine ways of breaking it, one at a time, each
  against the journeys meant to catch it, after the unchanged tree passed:
  all caught on the first run
  (`output/verification/2026-10-17-returns-sale-screen/`) — a unit preset
  intact, «+» past what may come back, «−» below none, «Пошкоджені»
  counted as intact, the reason open from the start, the panel before a
  unit, the panel's sum the sale's, a way not read unsaid, the sale's way
  not offered, the panel's button or ways not held with the app, a counted
  tag or a refusal left under the panel, the count heard without its row,
  from paper the large line without «З паперу» or with the parts' note, a
  sale in parts needing a way, the warehouse not asked for, the parts'
  note unsaid, the result not replacing the form, «Ще повернення» losing
  the search, the result's sum worked out on the phone, a paper return
  saying to hand money back, nothing back shown as a sum, the sentence
  unheard, «Брак» pointed to for everyone, «Новий продаж» for whoever may
  not sell or without the cursor, and the till's panel keeping no room.

## Review

An independent review of the change, on a snapshot, before the first
commit, found the body sent always the one shown, nothing preset, no
intact unit sent without its warehouse, the result's sum always the
server's, no «Поверніть» on paper and no debt foretold, and the kept
return, paper mode, another store's sale and the till unchanged. It found
the following, all addressed before the first commit:
- **From paper, the panel's large «Повернути 2 500,00 грн»** read as money
  to hand over, when it went back already: it carries «З паперу · » now,
  and the parts' note is not said.
- **Unproven:** a sale in parts going without a way (G35); the panel held
  while a return's answer is unknown; a line part of which came back —
  each proven now.
- **The chosen way and its focus drawn with `:has()`,** which older web
  views lack: drawn on the label's text now.
- **Only the first count brought its tag above the panel:** each does now,
  with the warehouse it asks for.
- **«Новий продаж»'s cursor** would have come back into the till's search
  whenever the till was mounted afresh on that visit: it is taken once.
- **Smaller:** the count heard without its row's name; a comment naming
  the wrong file.

## Evidence

- [`output/verification/2026-10-17-returns-sale-screen/`](../../output/verification/2026-10-17-returns-sale-screen/):
  `mutants.py` and `mutants.txt`, twenty-nine ways of breaking it, all
  caught; the form and the result at 360 px, light and dark, from the
  stubbed journeys (`returns-form-*.png`, `returns-result-*.png`).
- **CI, run locally at `bc067d1`** ([summary](../../output/verification/2026-10-17-returns-sale-screen-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 445 on PostgreSQL 17 (unchanged by this work);
  - e2e: 377 journeys;
  - hot path: worst p95 91.0 ms (the search by six sellers) and 68.3 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** the keyboard over the reason field and the panel
  (the task list's screenshot С2) — on iOS a sticky panel may sit behind
  the keyboard; the tags and the panel in Telegram's own web view, on
  Android and on iOS.
- **Not measured:** the taps from the till to the result, and a return's
  time on three sellers (the task list's §13).
- **The rest of the task list:** the kept return's notice in the result's
  words (P1-2), the paper's one line under the button (P1-4), the pills'
  colours (P2-4), the buzz on the server's answer (P2-5), and the other P1
  and P2 tasks.
