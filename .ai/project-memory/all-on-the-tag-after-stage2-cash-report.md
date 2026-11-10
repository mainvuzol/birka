# «Усе на бірці», after stage 2's audit, batch 6: «Каса»'s pack — what was recorded a line with its eyelet; to the kopeck the till's match, a line's difference with its sign; one context line; the history's thread; the blank tag; the docks' 52 and every corner on the scale — 2026-11-10

Baseline: `25624ac1` (the audit's fifth batch, PR #187, merged), and six
tasks of the orders and «Каса» task list after stage 2 — its third pack
(§8) and the fourth, which waited for the frame's base button:
- [P1-3](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  what «Каса» recorded names its fate, a line with its filled eyelet;
- [P1-4](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  to the kopeck in the till's match colour; a difference in a line with
  its sign;
- [P2-1](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  one context line on the order's card, the close's result and a close
  from «Закриття»;
- [P2-2](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  «Видано й внесено після закриття» and «Історія доставки» as the history's
  thread;
- [P2-3](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  «Каса»'s, «Закриття»'s and «Нове замовлення»'s empty places, the blank
  tag;
- [P2-4](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md) —
  what was left of the 2026-10-11 direction: buttons, rows, plates, «›».

Status: built; proof below — 1034 of 1035 journeys on a fresh seed, the one
the known Mac-only failure. 39 of 39 mutants caught. CI is GitHub's, on the
pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-cash`. Task: the audit's sixth batch, chosen in
chat after #187 was merged (2026-11-10, «Yes, start batch 6»). Chosen:
business-rules.md, "Chosen in chat — 2026-11-10 (audit after stage 2,
batch 6: …)". No owner's question is open for these tasks.

Where it stood:
- what «Каса» recorded was a plain line, «Записано: Витрати, 150,00 грн.»,
  read as a hint is;
- «Збіглося до копійки» and «Збіглося» in the paid's green, as «Сплачено»
  and «Клієнт забрав»; a difference read later a line in colour alone, and
  «Каса»'s own line of today in ink at 400 (batch 5 had narrowed its rule);
- a second line under the screen's: «замовлено 13.10 · № …», «Закриття
  03.11 · магазин «…»», «20:14 · Оля»;
- both histories rows of a list; the delivery's how on the right at 45 %;
- four empty places a plain paragraph;
- «Закрити касу», «Змінити на «…»» and the result's «Записати причину» 54
  with corner 15; «Записати причину» on «Каса» and «Прийняти повернення»
  54; a way's place 54/15; «Скасувати замовлення?» and the same waybill's
  plate at 16 — the four corners the design system's sweep still let
  through; the rows of «Закриття», «Змінити спосіб оплати», the same
  waybill and the new order's tray with a text «›» of 24.

## What exists now

- **What «Каса» recorded** (spec §2 P3): «Записано: …», «Записано до
  закриття …», «Спосіб оплати змінено: …», «Причину записано…» and «…
  записано один раз» under «Каса», on the count and on the close's result
  are an order's step line — its eyelet filled in ink, its words 600,
  still `role="status"`, gone with the next action as before. One
  component, `cash/DoneLine.tsx`.
- **To the kopeck the till's own match** (spec §6.18; owner's В4 (а), the
  design decision of 2026-10-28): «Збіглося до копійки» on the close's stub
  and «Збіглося» in «Закриття» are the sticker's `match` tone — the thread
  on ink in the light theme, ink on the thread in the dark — its glyph the
  knot, brought by the tone.
- **A difference said in a line has its sign**: an old close's card and
  «Каса»'s own line of today draw the triangle before «Нестача» /
  «Надлишок», the knot before «Збіглося до копійки», 16, in the line's
  colour; the line is 700 again where batch 5 had lost it.
- **One context line** (spec §2 P2): the order's card «{Магазин} · {Ім’я} ·
  замовлено 13.10 · № {8}», the number 12 as before; the close's result
  «{магазин закриття} · {хто рахував} · закриття 03.11»; a close opened
  from «Закриття» «{магазин} · 20:14 · Оля». No second line on any of the
  three.
- **The history's thread** (spec §6.21): «Видано й внесено після закриття»
  and «Історія доставки» — the day at the left (a movement of today its
  time), an eyelet filled on the thread, what it was 16/600, who and when
  in meta, a movement's sum on the right with «−» / «+», a delivery's how a
  line in ink under what it was. Order as before.
- **The blank tag** (spec §6.28): «Касу цього магазину ще не закривали.»,
  «Після останнього закриття ви ще нічого не провели.», «Цього дня
  грошових операцій не було.» and «Доступних складів немає.» with its
  meta «Зверніться до менеджера.» — the shared `Empty`, its tag 64.
- **The docks' 52 and every corner on the scale** (direction §4): «Закрити
  касу», «Записати причину» (on the result and on «Каса»), «Змінити на
  «…»» and «Прийняти повернення» the screen's main button, 52 and corner 8;
  the MainButton's own place outside Telegram stays 50, corner 10 (spec
  §6.4); a way's place 54, corner 8; «Скасувати замовлення?» a card, corner
  4; the same waybill's plate, corner 4. The design system's journey now
  finds no corner off the scale. The rows of «Закриття», «Змінити спосіб
  оплати», the same waybill and the new order's tray end in the set's
  chevron 16 in pencil, no text «›».

## Decided here, not by the owner

Each is in business-rules.md with its reason.
- **A difference said in a line has its sign**, as the sticker has: the
  task named the colour; the spec never lets a colour speak alone.
- **The close's result names its store always**, not only another's, and
  who counted by the close's own name; while it is read, the store's line.
- **A movement of today its time at the left; an earlier one its day**,
  its time first in the meta, so no moment is lost. A delivery version its
  day at the left, its time in the meta, how it went a line in ink.
- **«Доступних складів немає.» and its meta «Зверніться до менеджера.»** —
  the same words, a sentence each, as the blank tag holds one line.
- **The order's line at 360**: two lines where it has the width; beside
  «Змінити магазин», kept at its right as on every screen (spec §6.2), a
  store named as long as «Основний» takes a third. The button is not moved
  under the line for one screen.
- **The MainButton's place stays 50, corner 10** (spec §6.4): only the
  screen's own main buttons are 52/8.
- **The thread's day column is the shared one**, 44 and its gap of 8 — 52
  to the thread, as on a customer's and an invoice's histories; a sum in
  `.timeline-sum` there, not a `money-s` the set never had. Order as
  before, not the spec's newest first (§10 of the task list waits for the
  sellers' answer).

## The independent review

An independent reviewer read the diff against `main` with the six tasks
and the spec's §2, §4, §6.4, §6.18, §6.21 and §6.28; it ran the type check
and ESLint, not the journeys. One high finding, two medium. Settled:
- **The order's dock at 52/8** — a journey asked it of «Відправити», which
  is the MainButton's own place, 50 and corner 10 (spec §6.4), and the
  rules' draft said the same. The journey reads 50/10 there now and 52/8 on
  «Прийняти повернення», the screen's own main button; the draft corrected.
  (The run had found it too.)
- **The card read still drew a grey line of context** — the line P2-1
  moved into the head. Gone; a journey holds it.
- **The sticker's helper skipped `match`** among the tones with a meaning:
  its glyph of 16 was no longer read. Added; a mutant that drops the
  knot is caught by it.
- **A way's place within a pixel** of a way that has «зараз» under it hung
  on the font (55 on this Mac, a row of ways stretched to it). A way's
  lines are set now, 18 and «зараз»'s 14: every way is 54 on any font, and
  the journey reads all three at the place's 54.
- `.difference-sign { flex: none }` repeated the icon's own rule: gone.
- Seen and left:
  - the close's result read: its line says the store and the person, then
    the close's own — at 360 with long names it may wrap a line later;
  - the thread's day column 44 and its gap (above);
  - `.cash-context` counted 0 on the result and «Закриття»: kept as a guard
    that the second line never comes back.

## How it was built and proven

- **Files:**
  - `frontend/src/cash/DoneLine.tsx` (new): what «Каса» recorded, a line
    with its filled eyelet; read by `Cash.tsx`, `Count.tsx`, `Closed.tsx`;
  - `frontend/src/shared/Sticker.tsx`: the `match` tone, its knot;
  - `frontend/src/shared/ScreenHeader.tsx`: the line's `after` takes
    markup; `context` may be none while it is read;
  - `frontend/src/cash/Closed.tsx`: the match tone, the line's sign, the
    one line; its second line and its place gone;
  - `frontend/src/cash/History.tsx`: «Збіглося» the match, the opened
    close's one line, the blank tag, the chevron;
  - `frontend/src/cash/Cash.tsx`: the movements on the thread, the correct
    day's blank tag; `cash/format.ts`: `dateOf`;
  - `frontend/src/cash/Fix.tsx`, `Count.tsx`: the blank tag, the chevron,
    the line;
  - `frontend/src/orders/Order.tsx`: the one line, the delivery's thread,
    the chevron, the card read without its grey line;
  - `frontend/src/orders/NewOrder.tsx`: the blank tag, the tray's chevron;
  - `frontend/src/styles.css`: the docks' 52, the corners, the match tone,
    the line's sign, the ink eyelet, the ways' lines; `.order-context`,
    `.shipping-change`, `.shipping-kind` and the text chevron's 24 gone.
  - No backend change; no word changed but the two sentences of «Нове
    замовлення»'s blank tag, split.
- **Journeys:** 1035 in all, 1029 before.
  - New, each in the light and the dark theme: `cash-close` — a close to
    the kopeck the till's match, its ground and word per theme at 4.5:1,
    its knot; «Каса»'s own line of today in the accent's 700 with its
    knot; `cash-move-fix` — what «Каса» recorded, its eyelet filled in
    ink, 12, its words 600 and clear of it, at 4.5:1; `orders-new` — no
    warehouse to sell from, the blank tag, its line and its meta, no
    search.
  - Changed:
    - `cash-close`: the count's and the reason's buttons 52/8, the result's
      one line, the summary's sign, the match on the stub, the owner's
      movement on the thread;
    - `cash-history`: «Збіглося» the match, rows ≥ 64 with the chevron 16,
      the opened close's one line, the warning's and the knot's signs;
    - `cash-polish`: the fix row's chevron, the way's place 54/8 and every
      way 54, the dock's button 52/8, the closes' blank tag;
    - `cash`, `cash-correct`: the recorded line's eyelet, the movements on
      the thread, the blank tags;
    - `orders-card`: the one line (two lines with the width, three beside
      «Змінити магазин» at most, the button at its right), the card read
      without a grey line, the delivery's thread, the same waybill's plate
      4 and its chevron 16, the MainButton's place 50/10, «Прийняти
      повернення» 52/8;
    - `order-shipping`: the versions read off the thread;
    - `orders-list`: «Скасувати замовлення?» a card, corner 4;
    - `orders`, `orders-list`: the number read in the line;
    - `orders-new`: the tray's chevron;
    - `design-system`: no corner off the scale;
    - `fixtures`: the sticker's helper reads `match` as a tone with a
      meaning.

## Mutants

`~/.cache/birka-runtime/helpers/mutate36.py`: 39 mutants, each undoing
one thing this batch made. `mutants36.sh` ran each against the journeys
that should catch it, on a fresh seed each, one failure ending the run.
- **What «Каса» recorded:** the line's class, its ink eyelet green, the
  eyelet gone.
- **The match and the sign:** the stub's sticker paid's again; the match
  tone's colours the paid's; its knot gone, or the paid's check; «Закриття»'s
  pill paid's; the old close's line and the summary without their sign;
  the summary's colour on `p` only, as batch 5 left it; the signs swapped.
- **One line:** the card's, the result's and «Закриття»'s second line
  back; the card read with its grey line.
- **The thread:** the movement's day by `whenOf`, its meta without its
  time; the row a list's row again; the delivery's row a list's again, its
  time with the day, its how in pencil.
- **The blank tag:** each of the four a paragraph again; the new order's
  two sentences one line.
- **The 52 and the corners:** «Закрити касу», «Записати причину» and
  «Прийняти повернення» at 54; the panel's corner 15; «зараз»'s line the
  font's; the way's place 15; «Скасувати замовлення?» without its card;
  the same waybill's plate 16; the four chevrons a text «›»; a corner off
  the scale.
- **39 caught.** The first pass: 37 of 39. The two left:
  - the movement's row a list's row: its words kept their classes, and the
    journey read them, not the thread — now it reads the thread's geometry
    (the day at the left, the eyelet after it, the line of 1.5, the sum at
    the right), and it is caught;
  - a way's line of 18 dropped: equivalent on this Mac's font, whose own
    line for 15 is under 18 — it is kept for a font whose line is more;
    rewritten as «зараз»'s 14 dropped (55, the row stretched) and caught.
- Logs: `go-mutants36-first.log`, `go-mutants36-second.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean; the journeys' type check at the baseline's 44.
  Prettier is clean on every file this batch touches but three, where it
  would change exactly what it would on `main` (`cash.spec`, `Cash.tsx`,
  `styles.css`).
- **Every journey,** on a fresh seed, one worker: 1034 of 1035 in 27.7
  minutes — `go-b6-full.log`. The one: `backups.spec.ts:93`, «the owner is
  shown last night's failed copy…» — this Mac's backups' history, failing
  alike on the last baselines; GitHub's run is the proof.
- **While building:**
  - the specs this batch touches, first — 239 passed, 5 failed of 247,
    `go-b6-affected.log`: the recorded line's words read without the
    no-break space before «грн» (two journeys), a way's place a pixel
    under the way with «зараз», the order's line at 360, «Відправити»
    asked 52;
  - those five's specs again — 116 of 118, `go-b6-rerun.log`: the order's
    line three lines beside «Змінити магазин», and «Відправити» asked 52
    where the MainButton's place is 50/10 (both settled above);
  - the three order-card journeys changed for them — 3 of 3,
    `go-b6-three.log`;
  - after the review's fixes, the 8 specs they touch on a fresh seed — 304
    of 305, `go-b6-review.log`: a way 55 on this font, a pixel over its
    place; the ways' lines set, the till's fix specs 33 of 33,
    `go-b6-ways.log`.

## Not covered

- A real phone.
- The order's line at 360 beside «Змінити магазин» takes three lines with
  a store named as long as «Основний» (decided above); with a short name,
  or without the button, two.
- The thread's day column is 44 and its gap, as on a customer's history;
  the spec's 52 counts to the thread.
- Both histories keep their order — the delivery's first version first,
  not the spec's newest first — until the sellers answer (§10 of the task
  list).
- «Прийняти повернення» is the screen's 52 now; orders and «Каса» P1-2
  makes it Telegram's MainButton — 50 and 10 then.
- What is left of the task list: P1-1 (the orders' search, places,
  warehouses, empty), P1-2 (goods coming back as a task screen), P2-6 (the
  next page's failure).

## For the owner

- Nothing to answer for these tasks. What changes for the eye: what «Каса»
  recorded is a line with a filled ring, as an order's step; a close to the
  kopeck is the dark thread colour with its knot, not the green of «paid»;
  a shortage or a surplus written in a line has its small triangle; under
  an order's, a close's and a counted close's title there is one line, not
  two; the cash given out and the delivery's history are a thread with
  days at the left; empty places are the blank tag; the main buttons of
  «Каса» and an order are the same 52 as everywhere, with the same
  corners.
