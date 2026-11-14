# «Усе на бірці», audit 2026-11-13, batch 6: the set's chevron for the last typed «›»; captions in the section's caption style, Fix's one context line, «зараз» at 14; Telegram's rules in «Каса» and the orders' sheets; «Продаж записано» the result's heading (orders-cash P2-1, P2-2, P2-3, P2-8) — 2026-11-14

Baseline: `7fa72106` (the audit's fifth batch, PR #206, merged). This batch
is the audit's next in its own order («merged, go next»): the orders-cash
list's quick wins (its §8) — P2-1, P2-2, P2-3 and P2-8, look and
Telegram's rules, no word changed. P2-4 and P2-5 follow; P2-6 waits on
В13-З1, P2-7 on the batch-15 question.

Status: built and proven in the journeys (the full run before the review's
fixes 1119 of 1120 — the stand's own `backups:93`; the 3 specs touched
again after them, 103 of 103); 41 of 41 mutants caught; the review's findings fixed;
not committed. Not yet seen on a real phone.
- Branch: `feat/audit-1113-orders-cash-quick`.
- Task: the audit's sixth batch, after #206's merge (2026-11-14).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-14 (audit
  2026-11-13, batch 6: …)".

Where it stood:
- The app's last five typed «›» were here: «Скасовані й повернені на
  склад ›», «Історія доставки ›», «Змінити доставку ›» / «ТТН ще немає —
  вписати ›», «Товар повернувся на склад ›», «Спершу запишіть видане з
  каси ›»; elsewhere such links draw the set's chevron 16 in pencil, and a
  debt's «Історія · N» turns it while open.
- «Видано й внесено після закриття» was its own 13/700 in lower case; the
  ways' captions in «Клієнт забрав» their own `pay-caption`; «Змінити
  спосіб оплати» had a second grey context line under the store's;
  «зараз» under a way was 12 px.
- Choices in «Каса» were not felt; five fields had no keyboard key; while
  «Так, закрити» was on its way Telegram's «Назад» showed and did nothing,
  and while «Відправлено» or «Зберегти доставку» was, it closed the sheet.
- «Продаж записано» after «Клієнт забрав» was a browser `h3`, about 18.7 px
  in the system face, while the till's is 24/800 in the display face.

## What exists now

- **The set's chevron** (P2-1; `frontend/src/orders/Orders.tsx`,
  `frontend/src/orders/Order.tsx`, `frontend/src/cash/Count.tsx`,
  `frontend/src/styles.css`): the five links say their way on by
  `chevron-right` 16 in pencil after their words, on their line
  (`.link-chevron`), hidden from a reader; their names, places and sizes as
  before. «Історія доставки» turns it 90° while open.
- **Captions** (P2-2; `frontend/src/cash/Cash.tsx`,
  `frontend/src/orders/Collect.tsx`, `frontend/src/cash/Fix.tsx`,
  `styles.css`):
  - «Видано й внесено після закриття» and «Зараз, у магазині» / «Наперед
    чи перевізнику» `t-label` in pencil; «Каса»'s 20 above and 4 under as
    «У посилці», the sheet's 8 and 4 (the five ways in reach at 360 × 640);
  - «Змінити спосіб оплати»: one context line, the store's; «Ваші операції
    після останнього закриття» an `h2` caption in the text face over the
    rows, over their places while read and over a refused read, never over
    the blank tag; two lines at 360;
  - «зараз» 14/500 on a line of 14, the way still 54.
- **Telegram's rules** (P2-3; `frontend/src/cash/Move.tsx`,
  `frontend/src/cash/Closed.tsx`, `Fix.tsx`, `Count.tsx`,
  `frontend/src/orders/Send.tsx`, `frontend/src/orders/Shipping.tsx`,
  `frontend/src/orders/Returned.tsx`):
  - `selection` once as a chip of «Кому чи на що», a reason's chip or a new
    way changes, never on the one chosen;
  - «done» on «На що» / «Примітка» and «Пояснення» — Enter puts the
    keyboard away, nothing sent; «enter» on the close's reason, «Куди і як
    відправили» and «Причина повернення»;
  - «Так, закрити», «Відправлено» and «Зберегти доставку» hold their
    sheets while asked: «Назад» hidden, Escape, the scrim and the handle
    close nothing; answered, refused or lost — as before.
- **«Продаж записано»** (P2-8; `frontend/src/orders/Collected.tsx`):
  `t-sheet` 24/800 in the display face, one line at 360; «Продаж записано
  один раз» the same.

## The independent review

An independent reviewer read the diff cold (no Playwright, nothing
edited), during the full run. No High, no Medium.
- **Low, fixed:**
  - the Fix caption stood over the places while read and over a refused
    read with no word or check saying it was meant — the comment says so
    now, and a journey holds the read, refuses it, and reads the blank tag:
    the caption over the first two, never over the third;
  - the sheet's captions keep 8 above, not «У посилці»'s 20, with no reason
    written — the CSS and business-rules say why;
  - the hold released on an answer had no check for a refusal or the same
    waybill's warning — the send refusal, the same waybill and the waybill
    save refused now each see «Назад» shown again (the last also closes the
    sheet by Escape);
  - Enter in the note checked nothing could be sent while nothing could —
    the sum is typed first now, the sheet's button able to send;
  - Send's and Shipping's comments said «Назад» closes the sheet always —
    now «hidden, and nothing closes it, while … is on its way»;
  - business-rules had no entry yet — written;
  - «Продаж записано один раз» had no check — its 24 px now.
- **Low, kept:** Enter in the «done» fields blurs, as the Move sheet's
  sum field over it does (Telegram 9.1's own hide is the till's way; one
  pattern within the sheet chosen here). «Історія доставки» turns its
  chevron with the ease it had, a debt's «Історія · N» without one — the
  debt's screen is outside this batch.
- **Checked, no defect:** `held` hides Telegram's «Назад» and the close
  guard stops Escape, the scrim and the handle; a lost answer still closes
  the sheet by `run`; Send and Shipping cannot open while blocked, so
  `busy` is their own write; the buzz only on a change in all three
  groups; `.t-label`, `.t-sheet` and `.fix-caption` win over the `h2` and
  `h3` rules; the turn's selector matches the icon; no word, name or body
  sent changed; no visible «›» left in `src/orders` and `src/cash` but the
  «Продажі» › «Внесок» paths.

## How it was built and proven

- Journeys, new (`frontend/e2e/fixtures.ts`: `expectLinkChevron`,
  `chevronTurn`, `expectCaption`):
  - `orders-card`: the card's links — «Історія доставки», «Змінити
    доставку», «ТТН ще немає — вписати», «Товар повернувся на склад» — the
    set's chevron 16 in pencil after the words, hidden, names unchanged,
    44 high; turned 0 → 90 → 0; no «›» on the card; screenshot;
  - `orders-card`: «Відправлено» and «Зберегти доставку» held — «Назад»
    hidden, pressed, Escape and the scrim: the sheet stays, nothing resent;
    answered, «Назад» shown again;
  - `cash-close`: «Так, закрити» held the same; refused, the sheet gone and
    «Назад» the count's;
  - `cash-move-fix`: a choice felt once as it changes and never again on
    the same — the chips, the ways; «done» on the two notes, Enter keeps
    the text, puts the keyboard away, sends nothing though it could;
  - `cash-move-fix` (review): the caption over the places while read, over
    a refused read, never over the blank tag.
- Journeys, changed:
  - `orders-list`: «Скасовані й повернені на склад» its chevron;
  - `cash-close`: «Спершу запишіть видане з каси» without «›», its
    chevron; the reason's chip felt once and its field «enter»; the
    caption's look and one line at 360 in both themes;
  - `cash-move-fix`: one context line, the caption over the rows, two
    lines at most at 360, screenshot; «зараз» 14, the ways 54; the buzzes
    of a chip and of a way in four journeys;
  - `cash`: the caption's look against the real API; no caption over the
    blank tag;
  - `orders-card`: the ways' captions; «Продаж записано» 24/800 display
    face, one line, 4.5:1 in both themes, screenshots; «Причина
    повернення» «enter»; «Назад» shown after a refusal, the same waybill's
    warning and a waybill save refused (review); «Продаж записано один
    раз» 24 px (review);
  - `order-shipping`: «Куди і як відправили» «enter».

## Mutants

`mutate54.py`, 41 mutants, each applied alone, its journey run, the source
restored (`mutants54.sh`): 41 caught, each at the check meant for it.
- The set's chevron (8): each of the five links a typed «›» again;
  «Історія доставки»'s at 20; the chevron in the link's ink; the turn on
  a `span` that is no longer there.
- Captions (10): «Каса»'s caption without `t-label`, in ink; the ways'
  without `t-label`, in ink; Fix's a context line again; its caption in
  the `h2`'s display face; over the blank tag; hidden while read and over
  a refused read (review); «зараз» at 12; its line the button's 18.
- Telegram's rules (13): each of the three groups silent, and buzzing on
  the one already chosen; «done» gone from each note, and Enter keeping
  the keyboard; «enter» gone from each of the three texts.
- «Назад» held (8): Count, Send and Shipping not held; Send and Shipping
  closed by Escape and the scrim while asked; held after a refusal (Send,
  Shipping) and over the same waybill's warning (review).
- «Продаж записано» (2): the result's heading without `t-sheet`; «Продаж
  записано один раз» without it (review).

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1119 of
  1120 in 30.7 min. The one: `backups:93` — the stand's own, as in every
  full run since batch 8.
- After the review's fixes, the specs they touch (`cash-close`,
  `cash-move-fix`, `orders-card`): 103 of 103 in 3.1 min.
- Earlier, on a stand left by other runs, `cash.spec` failed twice on the
  day already closed («Сьогодні закрито о 11:18»); on a fresh seed 14 of
  14.
- Journeys: 1121 by `--list` (1116 before).
- Types: `tsc --noEmit` clean (the e2e config's errors are main's, the
  same 15); ESLint clean on every file touched; Prettier clean on what
  this batch changed — `cash.spec.ts` and `styles.css` are unformatted on
  main and left so outside this batch's lines; `Cash.tsx`'s one long line
  on main was this batch's caption, now wrapped.

## Not covered

- A real phone; Telegram 9.1's keyboard on the two «done» fields.
- Nine other `h2` captions with `t-label` take the display face from the
  `h2` rule (business-rules, «A reading for later»).
- P2-4, P2-5; P2-6 (В13-З1); P2-7 (the batch-15 question).
