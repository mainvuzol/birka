# «Усе на бірці», audit 2026-11-18, batch 2: one money scale — «Разом» a quiet word over a 32 sum, «Касу закрито» a result's 24 over a place in the stub's shape, «Покупці»'s block 32; a customer's row named by where it goes — 2026-11-18

Baseline: `e677e46d` (main after #225).

Points, all P2:
- frame P2-5 and P2-6;
- orders-cash P2-1 and P2-2;
- sale P2-2 and P2-3.

The task lists paired them: frame P2-5 is built with orders-cash P2-1, and
frame P2-6 with sale P2-3. Picked by «merged, go next».

Nothing recorded, sent or counted changes. No request, check, journal,
right or seen word changes. Every figure is the server's, through `Sum` /
`money()`, as before. Only sizes, one header's class, places while read and
two screen-reader names change.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1196 (1194 before).
- Branch: `feat/audit-1118-money-scale`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-18 (audit
  2026-11-18, batch 2: …)".

## What exists now

- **«Разом» one rule** (frame P2-5): the word («Разом», «Зараз», «винен»)
  is meta 14/500/19 in pencil, and the sum is `money-l` 32/34, 800, in ink.
  - It applies to all four `.pay-total`s: the till's tray, «У замовленні»,
    the return's panel and «Клієнт забрав».
  - It applies to the order card's `.order-total` too.
  - The till's and the return's own 32 rules are gone; the base says it.
- **One scale for the sums of places** (orders-cash P2-1): `money-l` 32/34
  for:
  - the order card's «Разом»;
  - «Клієнт забрав»;
  - one operation's card (`.fix-sum`);
  - «Мало бути» and «Порахували», off the stub as on it.

  «Каса»'s line «Каса відкрита · останнє закриття …» is 14/500/19, as the
  meta above it.
- **Places while read stand the height of what comes.**
  - A real 32 sum's line is 40, not 34: `Sum`'s «,00» and «грн» keep the
    34 line at their smaller sizes. The till's tray has been 40 since P0-5.
  - So an operation's place, the close's figures and «Покупці»'s block
    carry the same «,00» and «грн» unseen (`SumLine`).
  - Real sums are not changed.
- **«Касу закрито» a result's title** (orders-cash P2-2):
  - «Касу закрито» and «Перший підрахунок записано» are `result-title
    t-sheet` 24/26, with `pushed` off, as every result's.
  - «← Каса» still stands over it while a reason is owed.
  - At 360 «Касу закрито» is one line, and the eyelet sits by the first
    line.
- **The close's place in the stub's shape** (orders-cash P2-2), for a close
  that opened by itself and owes a reason, while it is read. The place is:
  - the white card cut as the stub is, with no tear;
  - two figures of 32;
  - a sticker's place that breathes, and keeps still under reduced motion;
  - the perforation;
  - the slip's rows, Картка and Переказ.

  The reason field's top moves no more than 8 px when the stub comes. The
  words read out, «Завантажуємо закриття…», are as before.
- **«Покупці»'s block sum 32** (sale P2-2) at any width.
  - «1 250 000,00 грн» at 360 sits within the block, with no sideways
    scroll.
  - The count goes under the sum when the line is full.
  - The block's place while read is the same height as the sum it waits for
    (±1).
- **A customer's row named by where it goes** (sale P2-3, frame P2-6).
  - `CustomerRow` has `opens` ("card" | "debt", "debt" unless said).
  - «Покупці»'s rows with a phone, in one store or several, and «Сьогодні»'s
    search's rows are named «{ім’я}, {винні …}».
  - An erased customer's row and the till's «Внесок» rows keep «Відкрити
    борг: …».
  - Nothing is seen differently.

## How it was built and proven

Sources:
- `styles.css`:
  - `.pay-total` and `.order-total`: word and sum;
  - `.fix-sum`, `.cash-sum`, `.cash-context` and `.block-owed .owed-sum`;
  - `.close-stub-place` with the stub's clip, the breathing sticker and the
    reduced-motion rule after it;
- `cash/Closed.tsx`: the header's class and `pushed={false}`;
- `cash/Placeholders.tsx`: `SumLine`, and `ClosePlaceholder` rewritten as
  the stub's shape;
- `credits/CustomerRow.tsx`: `opens`;
- `credits/Credits.tsx`: `Rows` gets `card` (single mode and blocks); the
  block's place gets «,00» and «грн»;
- `today/Search.tsx`: `opens="card"`.

Journeys:
- `fixtures.ts`: a shared `expectTotal(page, total, sums)`. It checks the
  word at 14/500/19 in pencil, and each sum at 32/34/800 in ink. It is used
  in:
  - `till-tray` (the first coat; in parts at 360, with the ways in view
    and no sideways scroll; a screenshot);
  - `orders-new`, `returns-sale-screen`;
  - `orders-card` (collect at 360; in parts; the themed card and collect).
- `cash-close`:
  - a `titleLook` helper: size, line, weight, lines, and the eyelet by the
    first line;
  - the themed journey: `.cash-context`, figures 32/34, title 24/26 on one
    line;
  - the first count at 360;
  - a new journey for the close's place, holding `/cash/closes/{id}`. It
    checks:
    - the shape, and no tear;
    - the parts;
    - the sticker breathes, and keeps still under reduced motion;
    - the title is 24 and not `t-title-l`;
    - the reason field moves ≤ 8 px, and the page has not scrolled;
    - screenshots of both states at 360.
- `cash-history` and `cash-move-fix`: close and operation figures 32/34.
- `credits-list`: a new journey for a store's owed of 1 250 000,00 at 360.
  It checks:
  - the place's height against the read sum's;
  - the size, face, colour and arrow;
  - the sum within the block's sides;
  - the count under it;
  - no sideways scroll;
  - a screenshot.

  The themed journey checks 32.
- Row names: «Покупці»'s and the search's locators lose «Відкрити борг: »:
  - `credits-list`, `credits`, `credits-debt`;
  - `stores`, `today-search`;
  - `outage`, `outage-mark-debts-returns`, `outside-text`.

  The till's rows (`tillRow` in `credits.spec.ts`) and the erased rows keep
  it.

Runs on a fresh seed:
- Touched specs, plus those reading the changed classes: 424 passed, 3
  failed.
  - Two failures were real: the close's place and the block's place stood
    34 against a sum of 40 (a 14 px shift; 6 px). Fixed by `SumLine`.
  - One was my own new check that the card's title takes the focus when a
    row opens it. It does not (see Found). It is back to «shown».
- Rerun after the fixes:
  - 136/136 (`credits-list`, `design-system`, `cash-close`, `cash-move-fix`,
    `stores`, `cash-polish`);
  - `outage` 31/31;
  - after the review's fixes, `cash-close` and `outage-mark-debts-returns`
    28/28.

## The review

An independent review read the diff against the three task lists. It
found nothing High or Medium. `tsc` and ESLint are clean on all 22 files.

Checked and found right:
- every `.pay-total` host and `.order-total`: no other selector reaches
  their sums;
- the three rules removed set exactly what the base now sets;
- contrast of pencil 14/500 on card is about 7.5:1 light and 7.3:1 dark;
- the stub's clip split keeps the recorded and settled stubs as they were;
- the place mirrors the stub's figures, perforation and slip, and is never
  read out;
- the place shows only when a reason is owed, so always two figures;
- `pushed` only toggled `t-title-l`, whose margins were already cancelled;
- every `CustomerRow` caller:
  - the till's rows are named for a debt;
  - «Покупці»'s rows and the search's are named for the card;
  - an erased customer's row keeps «Відкрити борг»;
  - the card's own debt rows and the «На який борг вносить?» sheet are
    untouched;
- every remaining «Відкрити борг:» locator is a till's, an erased one's or
  a card's debt row.

Low, fixed:
- **L1, reduced motion ignored for the place's sticker.** The `@media`
  rule stood before the breathing rule of the same specificity. It now
  stands after it; the journey checks the sticker is still, and the mutant
  `placestill` proves it.
- **L3, the eyelet check too loose.** A centred eyelet between two lines
  passed. Now its middle must lie on the first line.
- **L4, `outage-mark-debts-returns`'s locator** is now `^{name},`.

Left with a reason:
- **L2: the 8 px holds for a seller's close of one day.** Three things come
  with the answer and are not kept a place, so with them the field moves
  19 px or more:
  - a line of days not closed;
  - an owner's or manager's period details;
  - a card line that wraps.

  Before, the old card kept even less. This is written into the rules.
- **L4, `outside-text`'s locator** stays a substring: it is navigation, and
  other journeys pin the names.

## Found, not changed

- **The card's title takes no focus when a row opens it.** It takes the
  focus only back from a written-off debt's result
  (`frontend/src/credits/Customer.tsx:165-172`). The task list's sale P2-3
  said it was there, as now.

## Mutants

`~/.cache/birka-runtime/helpers/mutate71.py`, run with `mutants71.sh`. Each
mutant is applied, its journey is run once with no retries, and the source
is restored.

24 of 24 caught, each at its own check:
- frame P2-5: `paywordsize`, `paywordcolor`, `paysum`, `paysumink`,
  `orderword`, `ordersum`;
- orders-cash P2-1: `fixsum`, `cashsum`, `cashsumstub`, `context`;
- orders-cash P2-2:
  - the title: `title`, `titlefirst`, `titlepushed`;
  - the place: `placeslip`, `placeperf`, `placetorn`, `placetear`, and
    `placestill` after the review;
- sale P2-2: `blockowed`;
- sale P2-3 and frame P2-6: `rowverb`, `rowtill`, `rowerased`, `elsewhere`,
  `search`.

## CI fix

CI's full run at `b4e0cb58`: 1195 passed, 1 failed, in a journey this batch
does not touch, `openings.spec.ts:1171`:
- it counted the warehouse's reads after pressing «Зберегти список» a
  second time;
- the conflict's refusal reads the warehouse again inside its own `catch`,
  before its words are drawn, and on CI the quick answer was in before the
  press returned;
- so the count already held the re-read, and the poll waited for another.

Fixed in the test, by counting before the press. A form's refusal before
it reads nothing again (`src/openings/Openings.tsx:812`). Checked:
- the journey passed 3 of 3 on a fresh seed;
- with the conflict's re-read removed from the app, it fails at the poll.

## Not covered

- The look on a real phone, in Telegram.
- The full suite is left to CI.
- What is left of the audit 2026-11-18:
  - frame P2-1, P2-2, P2-4;
  - sale P2-1, and P2-4 (waits for «Прибрати» to be read);
  - orders-cash P2-3, P2-4;
  - money P2-1..P2-4;
  - goods P2-1..P2-6.

  В18-К1 and the set-off limit wait for the user's pick too.
