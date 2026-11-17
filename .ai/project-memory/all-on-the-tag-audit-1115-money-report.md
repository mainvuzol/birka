# «Усе на бірці», audit 2026-11-15, batch 5: money's lines and cards — a history's and the report's sums on the right in money-s; the invoice stickers in their tones; the report table's figures at 16; «Винні» 56 and a short phone's payment as S21; «1500,» read as 1500; «+» said in words; «Де гроші зараз» waiting in the shape it comes with — 2026-11-16

Baseline: `2d0d3e02` (main after #218). The money batch:
- money P2-1, P2-2, P2-4, P2-5
  (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-money.md`);
- the hot-path harness's keep-alive fix, carried here by the user's word
  («this fix add to next batch») — see «The hot-path harness».

Picked by «Go next».

Nothing recorded, sent or counted changes, and no sum is computed anew:
every sum on these screens is the server's answer, as before. No word on a
screen changes, except that two «+» now say the words a reader already
heard (P2-4).

Status: built and proven; not committed; not yet seen on a real phone.
- Touched specs on a fresh seed: 172 of 174 (9 files). Both failures were
  the new invoice journey's own: it expected 200 from a payment, which the
  API answers 201, and it matched a plain space where the sum keeps a
  no-break one before «грн». Both fixed.
- After the review's fixes and the spec tightenings: 74 of 74
  (`supplier-invoices`, `suppliers`, `sales-report`, `money`) on a fresh
  seed.
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 26 of 26 caught (see «Mutants»).
- One independent review; its findings are fixed or left with a reason.
- Journeys: 1175 (1171 before).
- Branch: `feat/audit-1115-money-cards`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-16 (audit 2026-11-15, batch 5: money's lines and cards …)".

## What exists now

- **A line's sum on the right** (money P2-1 (а); spec §6.21):
  - In an invoice's «Історія» and in «Продажі й повернення» the line's
    title is its word («Оплата», «Залік за повернення», «Списано»,
    «Продаж», «Повернення»). Its sum stands on the right in `money-s`
    (16/20, 600, even digits), as on «Каса»'s and a customer's timelines;
    «Повернення»'s with its «−».
  - A reader hears each line as before, the sum after its word; the sum on
    the right is for the eye alone.
  - In an invoice's history the sum stands before the chevron's place, so
    the sums' right edges are one vertical whether a line may be cancelled
    or not.
  - `.timeline-sum` is `money-s` wherever it is used.
- **The invoice stickers** (money P2-1 (б); spec §6.18): «Сплачено
  повністю» in the paid's colours with the paid's own mark; «Залишок
  списано» grey with its minus; «Скасовано» as it was.
- **The report table's figures** (money P2-1 (в)): 16/20 600, as
  «Надійшло» on «Гроші». Where the table is wider than the phone it
  scrolls alone, as before.
- **«Винні» on an invoice** (money P2-2 (а)): an open invoice's «Винні» is
  `money-xl` 56 on its card, its payment and its grey place; a closed one's
  sum stays 32.
- **The payment on a short phone** (money P2-2 (б); S21): under 700 px
  high, the keys 44, the sum's field 64, «Винні» and what is owed one line
  at 32, «Сплачено X з Y» under it — all over the dock, unscrolled. Above
  700 px, 56.
- **«1500,»** (money P2-2 (в)): a sum ending in its comma is still being
  typed and is read as 1500, as the set-off's: «Сплатити 1 500,00 грн» and
  «Це більше, ніж винні…» never blink under the finger. What is sent is the
  sum the button shows.
- **«+» in words** (money P2-4): «+ Записати накладну» on «Накладні», «+
  Повернути товар постачальнику» on «Постачальникам», drawn as «+ Нове
  замовлення» (one class for the three, `.head-add`), under the title where
  they do not fit beside it.
- **«Де гроші зараз» while read** (money P2-5): each store's place waits
  in the shape it comes with — a drawer's last count and what customers owe:
  grey words, a grey figure as tall as the figure, grey words; card and
  transfers: the figure alone; suppliers: the figure, then words. Nothing
  of the grey is heard. A line with no figure and «Видано сьогодні»'s lines
  are `meta` 14/19 500.

## The hot-path harness

`backend/scripts/measure_hot_path.py` let its client keep an idle
connection for 5 s, the same as the server's own keep-alive, so a request
could go out on a connection the server was closing at that moment
(`ReadError`, #218's first run). The client now lets an idle connection go
after 1 s. The figures are unchanged; see
`.ai/project-memory/hot-path-budget-report.md`, «Update — 2026-11-16».

## How it was built and proven

Sources:
- `suppliers/Invoices.tsx`, `InvoiceOwed.tsx`, `InvoicePay.tsx`,
  `InvoiceSticker.tsx`, `Suppliers.tsx`;
- `reports/ReportEntries.tsx`;
- `orders/Orders.tsx` (the class `.head-add`, nothing else);
- `money/Money.tsx`;
- `styles.css` (`.head-add`, `.timeline-sum`, `.invoice-history`,
  `.report-table td`, the short phone's payment, `.money-lines`);
- `backend/scripts/measure_hot_path.py`.

New and changed journeys:
- `supplier-invoices.spec.ts`:
  - a new journey in both themes at 360:
    - «Записати накладну» in words with its «+», whole, the title on one
      line;
    - the stickers in their tones and marks at 4.5:1;
    - «Винні» 56 on the card;
    - the history's sums at 16/20 600 on the right, one vertical with the
      chevron or without, the chevron after the sum, each line heard once
      in its old order;
    - a closed one's sum 32;
  - inside Telegram, the payment at 360 × 640 and 390 × 844:
    - «Винні» and its figure over the dock, 32 and 56;
    - at 640, the keys 44, the sum's field 64, «Сплачено …» under the
      figure;
    - keyed in one by one, «Сплатити …» says the sum so far, «1500,»
      still 1 500,00, the comma in the field.
- `suppliers.spec.ts`, the theme journey at 360 × 640:
  - «Повернути товар постачальнику» in words, whole, beside the title or
    under it, the title on one line;
  - for the owner, who has two stores, «Змінити магазин» on its line under
    the verb on «Постачальникам» and «Накладні».
- `sales-report.spec.ts`:
  - the thread's sums on the right, «−» for a return, aligned, heard in
    their place;
  - the table's cells and «Разом» at 16/20.
- `money.spec.ts`, a new journey in both themes at 360 and 390:
  - every place's reads held (one drawer by its drawer, the other by its
    last count);
  - each place grey in its own shape, nothing of it heard;
  - once read, each place as tall as it waited (±2);
  - a line with no figure and «Видано сьогодні» at 14/19, their colours as
    before.

## The review

An independent review (money and the payment, the reader, CSS, waiting
shapes, tests) found nothing High. `tsc`, `eslint` and `ruff` are clean.

Checked and found right:
- The payment's button, its «more than owed» line, its guard and what is
  sent use one sum; "", ",", "0,", "1500," and "1500,5" behave. More than
  is owed is never pressed. The phone computes no sum.
- Each line is heard once, in its old order; the waiting grey is never
  heard; the buttons' names equal their words.
- The history's grid: the reader's copy takes no cell; the sums' right
  edges are one vertical.
- The short phone's rule outweighs `.t-money-xl` and reaches only the
  payment.
- `.money-lines` at 14/19 reaches only the lines meant.
- The route holds in `money.spec.ts` fall back to the stubs in the right
  order.

Medium, fixed:
- **«Видано сьогодні» is not held.** If it came after the places were
  measured, «У касах» would grow and the journey fail. The journey now
  waits for it.

Medium, left with a reason:
- **The report table at 390 with two stores.** Measured in the iPhone's
  face with five-figure sums: 376 px in a 358 px wrap at 16; at 15 it was
  already 362, and with no cell padding it is 364. The table scrolls, a
  column stopping whole, as with three stores at 360 (decided here).

Low, fixed:
- The comma is now proven taken: the field reads «1 500,».
- The harness's pool sizes are stated as httpx's defaults, so only the
  expiry changes.
- P2-4's «Змінити магазин» in its place, untested: now checked for the
  owner on both screens.

Low, left with a reason:
- **A figure longer than one line** (a million or more, or a long sum in a
  column) grows its place by a line once read. The phone cannot know the
  length before it is read (decided here).
- **The invoice's grey place waits at 56**; a closed invoice's sum is 32
  (decided here).
- **The history's words at 360 are narrower** with the sum on the right, as
  on a customer's and «Каса»'s timelines; long notes wrap.
- **`tabular-nums` on `.timeline-sum`** is inherited from `body`; the check
  stays, as the role names it.
- **`Waiting` and `.day-wait`**, called dead by the review, are still used
  by `backups/Backups.tsx`, and stay.

## Mutants

`~/.cache/birka-runtime/helpers/mutate65.py`, run with `mutants65.sh` on a
fresh seed. Each mutant is applied, its journey is run once (`pw-slow`, no
retries), and the source is restored. 26 of 26 caught.

- P2-4: `makewords`, `makeclass`, `returnwords`, `returnclass`,
  `returnwraps`.
- P2-1 (а): `historysum`, `historyhidden`, `historyaria`, `historygrid`,
  `reportsum`, `reporthidden`, `sumrole`.
- P2-1 (б): `settledglyph`, `writtentone`.
- P2-1 (в): `reporttable`.
- P2-2: `owedxl`, `shortsum`, `shortkeys`, `shortline`, `comma`.
- P2-5: `waitbefore`, `waitafter`, `waitfigure`, `waitdrawer`,
  `waitaria`, `metalines`.

Two lived on the first run:
- `returnwraps`: without `wraps` the title broke inside its word to make
  room, and still passed "not cut". The journeys now check that the title
  is one line.
- `waitdrawer`: only the last count was held, never a drawer itself. One
  drawer is now held by its own read.

## Not covered

- The look on a real phone, and CI's font (DejaVu) against the Mac's at
  360 and 390.
- The hot-path harness is proven by the runs in its own report; its
  figures are not run again here.
