# «Усе на бірці», audit 2026-11-13, batch 7: one operation's card a task's screen; what explains a close's difference a thread; an invoice's results' heading, a supplier return's result's way back; more than is owed said as a set-off is typed (orders-cash P2-4, P2-5, money P2-2, P2-5 (а)) — 2026-11-14

Baseline: `62bf796f` (the audit's sixth batch, PR #207, merged). This batch
is the audit's next in its own order («merged, go next»): the orders-cash
list's last two points that wait on no one — P2-4 and P2-5 — and the money
list's quick wins left after batch 4 — P2-2 and P2-5 (а). No word, sum,
right or request body changes.

Status: built and proven in the journeys (the full run before the review's
fixes 1123 of 1125 — the stand's own `backups:93` and `cash-kept:630`'s
door timing, which passes alone; the 4 specs touched again after them, 61
of 61); 25 of 25 mutants caught; the review's findings fixed; not
committed. Not yet seen on a real phone.
- Branch: `feat/audit-1113-cash-invoices`.
- Task: the audit's seventh batch, after #207's merge (2026-11-14).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-14 (audit
  2026-11-13, batch 7: …)".

Where it stood:
- One operation's card of «Змінити спосіб оплати» stood with the menu
  under its dock; only the count was a task's screen in «Каса».
- What explains a close's difference was plain lines «{when} · {kind} ·
  {sum} · {who} · {text}» in a bare list, while «Каса»'s cash taken out
  and an order's shipping history are threads.
- «Накладну записано» and «Оплату записано» were a browser `h3`, about
  18.7 px in the system face, while «Продано 1 шт.» in the same section is
  24/800 in the display face.
- A supplier return's result had no «←» and no Telegram «Назад», the one
  result in the section left only by «Готово».
- «Зарахувати повернення» said a sum over the debt only after a press, its
  button free; the payment of the same invoice says it as it is typed.

## What exists now

- **One operation's card a task's screen** (orders-cash P2-4;
  `frontend/src/cash/Fix.tsx`, `frontend/src/cash/Cash.tsx`,
  `frontend/src/App.tsx`): `useTaskWhile` tells the app while a card stands
  — the seller's own (from the list or the receipt) and the owner's any
  day; the menu steps aside. The lists keep the menu; «← Каса», Telegram's
  «Назад», «Інша операція» as before. The dock stands where its flow puts
  it: at 360 × 640 and 390 × 844 its bottom at 507 px with or without the
  menu (measured on main and here); on a short screen (360 × 400) it sticks
  at the foot, where the menu stood. «Змінити магазин» held on the card, as
  on every task screen.
- **What explains a close's difference** (orders-cash P2-5;
  `frontend/src/cash/Closed.tsx`, `frontend/src/styles.css`): `ul.timeline`
  of `timeline-row`s — today its time at the left, another day its date
  and its time first in the meta; a filled eyelet; what it was 16/600 with
  a capital drawn; its words a line in ink; who in the meta; the sum with
  its sign on the right, one line. Order, sums and what it holds — the
  server's.
- **An invoice's results' heading** (money P2-2 (а);
  `frontend/src/suppliers/InvoiceRecorded.tsx`): `t-sheet` 24/26, 800, the
  display face, the check 28, one line at 360.
- **A supplier return's result** (money P2-2 (б);
  `frontend/src/suppliers/NewReturn.tsx`): «← Постачальникам» over its
  title and Telegram's «Назад», each to «Постачальникам», as «Готово».
- **More than is owed in «Зарахувати повернення»** (money P2-5 (а);
  `frontend/src/suppliers/InvoiceActions.tsx`): said under the field as it
  is typed (`pay-over`, `role="alert"`), the words it had on a press; the
  field `aria-invalid` and described by it; «Зарахувати {сума}» held; the
  whole debt not more; a refusal after a press says it all until the sum
  changes.

## The independent review

An independent reviewer read the diff cold (no Playwright, nothing
edited), during the full run. No High.
- **Medium/Low, fixed in the docs and the journeys:** the reading of
  P2-4's «в той же точке» held for a sale's card only. An order's card,
  its five ways a row each, and the owner's card are taller than 360 × 640,
  so their dock is now at the screen's foot, 64 lower than over the menu.
  business-rules and the task list now say so, as a reading for the owner,
  and a journey measures an order's card at 360 × 640.
- **Low, fixed:**
  - the return's result's heading, under its new «←», was a pushed
    screen's `t-title-l` saved only by the order of the rules — `pushed`
    off, as receiving's result; its look is checked now, in both themes at
    360;
  - the set-off's press lost its own over-debt check — back, as the
    payment's second check;
  - a sum typed with its comma last («4001,») dropped the line and freed
    the button for one key — said on as it stands, and checked;
  - `useTaskWhile`'s comment said the dock takes the screen's bottom —
    now: in its flow under a card that fits, at the foot under a taller
    one;
  - `expectResultHeading` sat between `expectCaption`'s doc and its
    function — moved;
  - business-rules read the 2026-10-29 note «a return's» as the supplier
    return's — it was the till's; reworded;
  - «Накладну записано» one line was checked at 412 — now at 360.
- **Low, kept:** the line is hidden after any refusal until the sum
  changes, as the payment's; a 409 whose re-read lowers the debt leaves
  the button held with the refusal's «дані змінилися — перегляньте їх»
  as the reason (a reading for later, with the payment's comma).
- **Checked, no defect:** one `task` setter shared by the count and both
  cards — cleanups before mounts in a commit, strict mode, the receipt's
  path, a tab left, a kept or unknown write; `taskScreen` only on
  «Каса»; `moved()` and every part of the old line kept in the thread; the
  capital scoped to `.explain-thread`; the stub's times give the same
  dates in UTC and Kyiv; the set-off's `>` as the server's, no other way
  to send; «Готово» and the result's focus as before; each heading check
  able to fail; «Накладну записано» fits 360 with CI's DejaVu.

## How it was built and proven

- Journeys, new:
  - `cash-move-fix`: one operation's card a task's screen — the menu on
    the list, gone on the card, back on «Каса»; the dock in its flow under
    the card at 360 × 640, at the foot at 360 × 400; the owner's day list
    with the menu, its card without, «Інша операція» the menu again;
  - `cash-history` (both themes): the explanations' thread — three rows in
    the server's order, the date at the left and the time in the meta,
    the words in ink, the capital drawn, signed sums on one line, an
    eyelet each, 4.5:1, nothing wider than 360; screenshots;
  - `suppliers`: a return's result in Telegram — «← Постачальникам» and
    «Назад» shown; «Назад», «←» and «Готово» each to «Постачальникам»;
  - `cash-move-fix` (review): an order's card at 360 × 640 — its dock at
    the foot, where the menu stood.
- Journeys, changed:
  - `cash` (real API): the receipt's card without the menu, «Каса» with it
    after the change; three taps as before;
  - `supplier-invoices`: «Накладну записано» and «Оплату записано» 24/26,
    800, display face, check 28, one line (`expectResultHeading`, a new
    fixture); in both themes at 360, 4.5:1, screenshots; the set-off's
    line while typing — over the debt, the field invalid and described,
    the button held, nothing sent; the whole debt free; the line gone as
    the sum changes;
  - `suppliers`: the return's result its «← Постачальникам»; in both
    themes at 360 its heading 24/26 in the display face with its check,
    «←» and the stub at 4.5:1, screenshots (review);
  - `supplier-invoices` (review): «Накладну записано» one line at 360; a
    sum with its comma last said on, the button held.

## Mutants

`mutate55.py`, 25 mutants, each applied alone, its journey run, the source
restored (`mutants55.sh`): 25 caught, each at the check meant for it.
- The card a task's screen (5): the seller's card and the owner's card
  not telling the app; each telling it on its list too; the menu never
  coming back.
- The thread (10): the list not a `timeline`; a row not a `timeline-row`;
  the time at the left on another day; no eyelet; no capital; the words in
  pencil; the words in the meta; who gone; the sum without its «+»; the
  order reversed.
- The results' heading (2): «Накладну записано» without `t-sheet`;
  «Оплату записано» without its check.
- The return's way back (2): no «←»; a «←» that goes nowhere.
- The set-off's line (6): never said; the button free; the field valid;
  the field not described; the comma dropping the line; the whole debt
  called more.

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1123 of
  1125 in 31.1 min. The two: `backups:93` — the stand's own, as in every
  full run since batch 8 — and `cash-kept:630` (the night the clocks go
  back), lost on its door timing as in earlier full runs; alone, 3 of 3.
- Before it, the 8 specs this batch touches (`cash-move-fix`,
  `cash-history`, `cash-correct`, `cash-close`, `cash-kept`, `suppliers`,
  `supplier-invoices`, `telegram-back`): 120 of 120.
- After the review's fixes, the specs they touch (`cash-move-fix`,
  `suppliers`, `supplier-invoices`, `cash-history`): 61 of 61 in 1.9 min.
- Measured, the card's dock with and without the menu (a probe, removed):
  a sale's card at 360 × 640 and 390 × 844 — the dock's bottom at 507 px
  on main and here.
- Journeys: 1125 by `--list` (1121 before).
- Types: `tsc --noEmit` clean (the e2e config's errors are main's);
  ESLint clean on every file touched; Prettier clean on what this batch
  changed — `cash.spec.ts`, `App.tsx` and `styles.css` are unformatted on
  main and left so outside this batch's lines.

## Not covered

- A real phone; Telegram's own keyboard over «Пояснення» on the card.
- orders-cash P2-6 (В13-З1), P2-7 (the batch-15 question); money P2-5 (б)
  (В13-Г2), P2-7 (В13-Г1), P2-1, P2-4, P2-6.
