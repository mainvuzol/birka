# «Усе на бірці», after stage 2's audit, batch 7: «Замовлення»'s pack — the shared search field, the rows' places as tags, those to be sent under their warehouses at once, the blank tag; the goods come back a task's screen with Telegram's MainButton; a next page that failed one retry — 2026-11-10

Baseline: `e9ec428b` (the audit's sixth batch, PR #188, merged), and the
last three tasks of the orders and «Каса» task list after stage 2 — its
pack «Замовлення» (§8, 2):
- [P1-1](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  «Замовлення» and its card: the search field §6.6, places that hold the
  tags' shape, the warehouses' grouping that does not jump, the blank tag;
- [P1-2](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  «Товар повернувся на склад» a task's screen of stage 2: the menu aside,
  «Прийняти повернення» Telegram's MainButton, the goods in the line of
  context;
- [P2-6](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) — a
  next page that failed in «Замовлення» and «Закриття»: one «Спробувати ще
  раз» where «Показати ще» stood.

With them the orders and «Каса» task list after stage 2 is built whole.

Status: built; proof below — 1039 of 1041 journeys on a fresh seed, the two
failing for this Mac and the stand's load, each passing or known alike
before. 43 of 44 mutants caught, one equivalent. CI is GitHub's, on the
pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-orders`. Task: the audit's seventh batch, chosen
in chat after #188 was merged (2026-11-10, «merged go next»). Chosen:
business-rules.md, "Chosen in chat — 2026-11-10 (audit after stage 2,
batch 7: …)". The owner's В-ЗП6 is built by (а), as the task list says; Q-4
keeps the empty «До відправлення»'s words.

Where it stood:
- the waybill's field the old one: «Номер ТТН» a line over it, corner 8 by
  the frame's sweep, no magnifier, no «×»;
- the rows' places while read a list's rows of 56–64 under tags of 76 and
  more; the card read held a pill's place where its string of knots comes,
  so «У посилці» moved when it came;
- «До відправлення», for whoever reads the stock, came as one list, then
  the labels «Склад «…» · N» came over the rows and moved them (a tap was
  let go meanwhile, the rows still jumped);
- «Тут посилок немає.», «Зараз нічого не треба відправляти.» and nothing
  found plain text, while «Замовлень ще немає.» on the same screen was the
  blank tag;
- «Товар повернувся на склад» the screen of 2026-10-25: the menu under it,
  the goods repeated in a window over «Прийняти повернення», a button of
  the app's in Telegram too;
- a next page that failed: «Закриття» said it on a plate and kept
  «Показати ще» under it; «Замовлення» kept «Показати ще» and said it over
  the rows, far from the finger.

## What exists now

- **The shared search field** (spec §6.6): «Замовлення»'s waybill field is
  `SearchField` — 52, corner 8, the magnifier, «Номер ТТН» its hint and its
  name heard, no line over it; «×» does what «Очистити» does. From two
  characters, Enter at once, kept while an order is opened — as before.
- **The rows' places are row tags** (spec §6.27): while the open, the
  collected, the cancelled or the found orders are read, three grey row
  tags 76 in the order tags' own list. The shared `Placeholder`'s line tags
  are the order tag's own shape now; «Брак», which drew it by hand, takes
  it. To be sent, for whoever reads the stock, the places stand in a
  warehouse's section under a label's place: the first row comes under its
  label where its place stood.
- **To be sent under their warehouses at once:** while the warehouses are
  read, the places; then the rows, under their labels — none moves once
  shown. The warehouses refused, or a line from one not read: one list, as
  before — and read again after that, the rows stay. A long warehouse's
  name breaks in its label.
- **The blank tag** (spec §6.28): «Тут посилок немає.», «Зараз нічого не
  треба відправляти.» and «За «…» замовлень не знайдено. Перевірте номер
  ТТН.» with «Очистити» — the shared `Empty`, words as before.
- **The card read holds the card's shape:** the string of knots in its
  place — four hollow knots on the thread, each word and the day under «До
  відправлення» grey in its own size — «У посилці»'s place, two lines; and
  in the line under the title «замовлено … · № …» grey, so the line wraps
  as the card's. Opened from its row, a cancelled or come back order holds
  its sticker's place, and one with no day no day's place. Nothing under
  the title moves when the order comes.
- **The goods come back, a task's screen** (В-ЗП6 (а)): the menu steps
  aside, «Змінити магазин» held; under the title «{магазин} · {товар}»;
  «Прийняти повернення» Telegram's MainButton, held until the reason and
  the tick, turning while answered, the card's put away meanwhile;
  Telegram's «Назад» «← Замовлення», hidden while answered. Outside
  Telegram, the dock's one
  button, the MainButton's place 50/10, its eyelet turning while answered.
  The window repeating the goods is gone. What is sent is as before.
- **A next page that failed:** «Замовлення» (every place, the cancelled and
  the found) and «Закриття» say it on one plate where «Показати ще» stood;
  «Спробувати ще раз» reads that page; the rows read stay. The list read
  again whole meanwhile keeps the plate at the foot, held until answered;
  a whole list read again and refused is said over its rows, as before.

## Decided here, not by the owner

Each is in business-rules.md with its reason.
- **The places for whoever reads the stock carry a label's place** over
  them: the rows come under «Склад «…»», which the task's criterion of the
  first row where its place stood asks for.
- **The card read's line holds «замовлено … · № …» grey:** the task asks
  «У посилці» not to move; the line under the title wraps differently with
  and without it at 360.
- **The dock's button outside Telegram is the MainButton's place**, 50/10
  (spec §6.4), as the card's; batch 6 made it the screen's 52/8 until this
  task.
- **The card read from its row takes the row's order** (review): a
  cancelled or come back one's sticker place, no day where it has none.
- **The return's line at 360** takes a third line beside «Змінити
  магазин» with a long product, as batch 6 decided for the order's line.
- **A next page's failure is kept until the list reads with no error**
  (review): a whole read again meanwhile says it at the foot, held.

## The independent review

An independent reviewer read the diff against `main` with the three tasks
and the spec's §6.4, §6.6, §6.27 and §6.28 and TanStack Query's own
states; it ran the type check and ESLint, not the journeys. Three medium
findings, four low, nits. Settled:
- **The warehouses refused, then read again** — the app come back, a step
  recorded — went back to «pending» with no answer kept, and the places
  hid the rows already shown. The places stand only until the warehouses
  are first answered now (`waitingForPlaces`); a journey refuses them, then
  holds their read again and finds the rows kept, no places.
- **A whole read again after a next page failed** cleared the failure's
  direction while its error stayed: the plate jumped over the rows and
  «Показати ще» came back under them. One hook, `shared/nextPage`, keeps
  the failure the next page's until the list is read with no error; the
  plate stays at the foot, its retry held until answered. Journeys hold a
  read again on «Замовлення» (the found) and «Закриття»; a whole read
  refused on «Закриття» is said over the closes, as before.
- **«← Замовлення» was free while the return was answered**: Telegram's
  «Назад» hidden and the app's held now; a journey presses it anyway and
  finds the screen and the reason kept.
- **A tap as the places give way to the rows** was not let go: the places'
  state is among what the list shows, so it is.
- **A long product's line** under the return's title: a journey reads it
  at 360 — three lines at most beside «Змінити магазин», two without it,
  as batch 6 decided for the order's line.
- **The card's place, opened from its row**, drew a day an order without
  one never has, and no sticker's place for a cancelled or come back one:
  it takes the row's order now; a journey reads the sticker and «У
  посилці» where their places stood, and an order with no day.
- Nits: `placesRead` named `waitingForPlaces`; `knots-place`, unused, gone;
  the top plates of «Замовлення» held while read again.
- Seen and left: the label's place when the list ends ungrouped (below,
  "Not covered"); the line's place «№ 00000000» in digits where the number
  is hex.

## How it was built and proven

- **Code:**
  - `frontend/src/orders/Orders.tsx`: the shared field; the rows' places as
    tags, a label's place over them for whoever reads the stock; the
    warehouses at once; the blank tags; a next page's plate at the foot;
  - `frontend/src/orders/Order.tsx`: the card's place — the string, «У
    посилці», two lines — and the line's grey «замовлено … · № …»; the
    task screen said to the app;
  - `frontend/src/orders/Knots.tsx`: `KnotStringPlace`;
  - `frontend/src/orders/Returned.tsx`: the task's screen, Telegram's
    MainButton, the line under the title, the dock's one button, Back held;
  - `frontend/src/App.tsx`: the menu aside while the goods come back; the
    card's place fed the row's order;
  - `frontend/src/shared/Placeholder.tsx`: its line tags the order tag's
    shape; `frontend/src/damaged/Damaged.tsx` takes them;
  - `frontend/src/shared/nextPage.ts`: whether a list's error is its next
    page's; `frontend/src/cash/History.tsx` takes it;
  - `frontend/src/styles.css`: the label's place, a label that breaks;
    `.skeleton-tag-in`, `.order-placeholder`'s flex and `.orders-none` gone.
  - No backend change; no word changed.
- **Journeys:** 1041 in all, 1035 before.
  - New: `orders-list` — a next page that failed, on to be sent, collected
    and found, with a read again held; `orders-card` — the goods come back
    on a task's screen; a long product's line; a cancelled order's and a
    dayless order's places; `cash-history` — a page of closes that failed,
    a read again held, the whole list refused; `damaged` — «Брак»'s places
    the shared row tags.
  - Changed:
    - `orders-list`: those to be sent under their warehouses at once (the
      places while held, the rows where they stood, a tap let go, refused
      and read again, a long name); the shared field; the places as tags
      under a label's place; the blank tags in both themes;
    - `orders-card`: the return's journeys by Telegram's MainButton, and
      outside Telegram by the dock's one button 50/10; the card's place
      with its string and «У посилці»; `.store-line p:visible`, the card
      kept hidden under the return;
    - `design-system`: the line tag measured in the order tag's shape.

## Mutants

`~/.cache/birka-runtime/helpers/mutate37.py`: 44 mutants, each undoing
one thing this batch made. `mutants37.sh` ran each against the journeys
that should catch it, on a fresh seed each, one failure ending the run.
- **The shared field:** its hint gone.
- **The places as tags:** a list's rows again; the label's place gone;
  the order tag's shape or its list dropped from the shared places;
  «Брак»'s places a list's rows again.
- **Under their warehouses at once:** no places while the warehouses are
  read; the places back while they are read again after a refusal; the
  places' state dropped from what the list shows; the places with no
  label's place; a long label unbroken.
- **The blank tag:** each of the three a paragraph again.
- **The card's place:** a pill's place where the string comes; «У
  посилці»'s place gone; the old flex's gap back; the knots' words or the
  day dropped; a day kept, and «замовлено» in the line, where the order
  has none; no sticker's place; the row's order not passed.
- **The task's screen:** the menu kept; the screen not said to the app;
  the MainButton put away; active before the reason and the tick; no
  progress; not waiting; the line under the title gone; the dock's button
  the screen's own again; «← Замовлення» free while answered.
- **A next page that failed:** «Показати ще» kept; its retry the whole
  list's; the failure not kept through a read again (in «Замовлення», in
  the hook, in «Закриття»); the plate over the rows too (to be sent, the
  closed, the found, «Закриття»); «Закриття»'s plate gone, its retry the
  whole list's.
- **43 caught, one equivalent.** The first pass: 41 of 44. The three left:
  - the places' state dropped from what the list shows: the journey's tap
    came within 0.7 s of the orders' own read, let go for that — it waits
    now, the warehouses refused, and the tap as the rows come is let go
    only by the places' state; caught;
  - a long label unbroken: the warehouse's name had hyphens, where it
    breaks anyway — one word now, and the label's own width read; caught;
  - «Прийняти повернення» pressed before the reason and the tick taken:
    equivalent — Telegram's MainButton is answered only while active, the
    dock's button is disabled until then, and the card takes one command
    at a time; the guard is kept as the screen's own.
- Logs: `go-mutants37-first.log`, `go-mutants37-second.log`,
  `go-mutants37-third.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean; the journeys' type check at the baseline's 44.
  Prettier is clean on every file this batch touches but two, where it
  would change exactly what it would on `main` (`App.tsx`, `styles.css`).
- **Every journey,** on a fresh seed, one worker: 1039 of 1041 in 28.0
  minutes — `go-b7-full.log`. The two:
  - `backups.spec.ts:93`, «the owner is shown last night's failed copy…» —
    this Mac's backups' history, failing alike on the last baselines;
  - `cash-kept.spec.ts:630`, a kept count refused the night the clocks go
    back — the store's choice at the door not drawn within 5 s, before
    anything this batch touches; alone it passes, `go-b7-kept.log`.
  GitHub's run is the proof.
- **While building:**
  - the specs this batch touches, first — 106 of 116, `go-b7-first.log`:
    what the tasks changed (the window over the button gone, the places
    tags, one list no longer drawn while the warehouses are read);
  - again — 128 of 137, `go-b7-second.log`: the card kept hidden under the
    return (`.store-line p:visible`), the places 4 px off by a section's
    margin (the labelled places in `section.order-place` now), the card's
    string 14 px off without «замовлено …» in the line (`CardLinePlace`),
    «Очистити» and «Очистити пошук», the lost answer's journey back in
    Telegram;
  - the warehouses' journey, its row read after the dialog opened — 14 of
    15, `go-b7-third.log`; read before it, it passed;
  - after the review's fixes, the seven specs on a fresh seed — 138 of
    140, `go-b7-fourth.log`: the closes' stub refused offset 0 to «Каса»'s
    own read of the closes too (it asks no offset), and «Змінити магазин»
    found the hidden card's too; settled — `go-b7-fifth.log`,
    `go-b7-sixth.log`;
  - the warehouses' journey after the mutants — `go-b7-seventh.log`.

## Not covered

- A real phone.
- The label's place over the places is drawn for «До відправлення» to
  whoever reads the stock: when the list then ends in one list (the
  warehouses refused, a line from one not read) its first row comes a
  label's height over where its place stood.
- A card opened other than from its row — the same waybill's other order
  from its plate — holds an order to be sent's places: a cancelled one's
  sticker comes under the string.
- The line's place holds «№ 00000000» in digits; the number is hex, a
  pixel or two wider or narrower on a proportional font.
- The return's line at 360 beside «Змінити магазин» takes three lines with
  a long product (decided above); without the button, two.
- Q-4: «Посилок до відправлення немає. Вставте повідомлення з чату…»
  (spec §6.28) waits for the owner; the empty «До відправлення» keeps its
  words.

## For the owner

- Nothing to answer for these tasks; Q-4 stays open. What changes for the
  eye: the waybill's field is the app's one search field, with a
  magnifier and «×»; while orders are read, grey tags stand where they
  come, and those to be sent come under their warehouses at once — no row
  jumps; empty places are the blank tag; an order's card read holds its
  string's place, so nothing moves when it comes; «Товар повернувся на
  склад» is a screen of its own, the menu hidden, the goods named under
  the title, «Прийняти повернення» Telegram's own button; a next page that
  could not be read says so where «Показати ще» stood, with «Спробувати ще
  раз».
- With this batch the orders and «Каса» task list after stage 2 is built
  whole.
