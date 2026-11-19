# «Усе на бірці», audit 2026-11-18, batch 6: a typed sum ending in its comma read as the sum it is, one rule wherever a sum is typed; «Операції дня»'s card at its top, the day brought back where it was left; the order card's failed read under its title and line — 2026-11-19

Baseline: `ba9fa366` (main after #229).

Points, all P2: sale P2-1, orders-cash P2-3 and P2-4. Picked in chat:
«Sale + orders-cash».

What is sent is the sum shown. The server checks prices, `paid_now`,
payments, set-offs and costs as before. No request, check, journal, right
or word changes.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1210 (1201 before).
- Branch: `feat/audit-1118-typed-sums`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-19 (audit
  2026-11-18, batch 6: …)".

## What exists now

- **«1500,» is a sum still being typed, wherever a sum is typed** (sale
  P2-1). One function, `typedKopecks`, beside `kopecks`: whole hryvnias
  ending in «,» or «.» read without it. «0,» reads as «0»; «15,5,» and
  «15,5,5» are no sum (by the review); nothing is written into the field.
  - The till's basket: «1850,» is a price. No red line, the hint as before
    the comma and of the same height, the tray «Разом 1 850,00 грн», the ways
    ready; `unit_price` «1850.00» is sent.
  - «Сплачує зараз», at the till and in «Клієнт забрав»: «1000,» keeps
    «Лишиться винен …» and the tray's or dock's «Зараз … · винен …»;
    `paid_now` «1000.00» is sent.
  - S21: «1500,» makes the ways ready and sends «1500.00». Over the debt,
    «Це більше, ніж винні…» stands on the comma and on the figure after it.
    «0,» keeps the ways waiting.
  - Decided here, the same rule for the other typed sums:
    - a new order's line price (the basket's twin, the same hint);
    - the set-off: its button says and sends «4500,» as 4500, as its
      over-line already read it;
    - «Прийшов товар»'s purchase price: «1850,» taken by «Готово», the row
      «Закупівля · 1 850,00 грн за шт.».

    The five places that had their own copy of the rule, and the two that
    stripped only a comma, call the function now.
- **«Операції дня»'s card at its top; the day back where it was left**
  (orders-cash P2-3):
  - The day's list and an operation's card are each their own screen
    under «Змінити спосіб оплати», as «Ваші операції»'s. A row tapped low
    on a long day opens its card at its top, what it is and its sum in
    view.
  - «Інша операція» brings the day back where it was read to, the row
    tapped in focus, nothing read again. Decided here: a day may be long,
    as «Закриття»'s list.
  - Decided here: a refused change brings the list back at its top, its
    refusal in view.
  - The menu now steps aside and comes back in layout effects. The place
    is put again in the first frame, once the menu's room is back, before
    the paint.
- **The order card's failed read under its title and line** (orders-cash
  P2-4):
  - «не вдалося …» and «Спробувати ще раз» stand under the card's title
    and line (and the kept stub, when it stands there), over «У посилці».
  - Under «Товар повернувся на склад»'s title while it stands, never hidden
    with the card; the reason typed stays.

## How it was built and proven

Sources:
- `orders/types.ts`: `typedKopecks`.
- Read with it:
  - `sales/Sale.tsx`: `asPrice`, `paidNow`;
  - `credits/Terms.tsx`: `checkTerms`, `TermsFields`;
  - `credits/Debt.tsx`: the payment's sum;
  - `orders/Collect.tsx`: `paidNow`;
  - `orders/NewOrder.tsx`: `asPrice`;
  - `suppliers/InvoiceActions.tsx`: the set-off's sum, one reading where
    there were two;
  - `inventory/Receive.tsx`: the cost, in three places.
- The rule's copies replaced by the function: `suppliers/InvoicePay.tsx`,
  `suppliers/Invoices.tsx` (two), `cash/Move.tsx`, `cash/Count.tsx`,
  `prices/SuggestedPrice.tsx`.
- `cash/Cash.tsx` (`CorrectStep`):
  - `screen` «day-operations» / «day-operation»;
  - the place and the row kept, put back in a layout effect and again in
    the first frame;
  - the menu's step aside in layout effects;
  - a refusal clears the place.
- `orders/Order.tsx`: `unread` on `CardProps`, drawn first in the card's
  section; `OrderDetail` gives it to «Товар повернувся на склад» while it
  stands. `orders/Returned.tsx` draws it first in its section. `App.tsx`
  passes the plate in.

Journeys (+9):
- `till-search`: «1850,» in the basket, in both themes at 360.
- `till-basket`: «Сплачує зараз» «1000,», in both themes at 360.
- `credits-debt`: S21 «0,», «4000,» and «1500,», in both themes at 360.
- `orders-card`:
  - «Клієнт забрав» in parts typed «500,»;
  - a new journey: the failed read under the card's title, then under
    «Товар повернувся на склад»'s, in both themes at 360.
- `cash-correct`: at 360 × 400, a long day, the last row, «Інша
  операція», and a refusal.
- Changed: `supplier-invoices` (the set-off «4001,» and «1200,» to the
  sent body), `receive` («1850,» taken), `orders-new` («1750,» sent as
  «1750.00»).

Runs on a fresh seed:
- Touched specs (`till-search`, `till-basket`, `credits-debt`, `credits`,
  `orders-card`, `orders-new`, `supplier-invoices`, `receive`,
  `cash-correct`, `cash-move-fix`, `cash-close`, `price`, `till-receipt`):
  309 passed, 3 failed, all my own new journeys.
  - S21, both themes: the keypad groups thousands («4 000,»), so the
    journey reads the display, not the digits typed.
  - «Операції дня»: back, the place was 90 px short. The menu came back
    after the restore, its room with it. Fixed in the source: the menu in
    layout effects, the place put again in the first frame. A probe showed
    the frame reaching 885 of 885. The journey reads the place inside a
    frame.
- Reruns: the S21 journeys 2/2; `cash-correct` 9/9.
- After the review's fixes, the same 13 specs on a fresh seed: 312 passed.

## The review

An independent review read the diff against the three points, the rule of
2026-11-15 and its twins, with the financial-integrity view: what is sent
is what is shown. It found nothing High. `tsc` and ESLint are clean on the
changed files.

Checked and found right:
- shown = sent, field by field:
  - the basket's price to the tray and the line sent;
  - `paidNow` (the till, «Клієнт забрав») and `checkTerms`, which sends
    `decimal(paid)`, never the text;
  - S21's one `cents` for the ways, the line and the amount;
  - the set-off's button, line, check and amount;
  - «Прийшов товар»'s `take()`, its row, «Готово» and `unit_cost`;
  - a new order's lines and total;
- no plain `kopecks()` left on typed text;
- `CorrectStep`:
  - the header's reset runs before the restore;
  - the `screen` keys are unique;
  - StrictMode is harmless;
  - the rAF is cancelled on cleanup;
  - the command's body is untouched;
- P2-4: one plate (the card gets none while the return's screen stands),
  in order on the result's screen too, kept across the card's re-keying;
- every new check fails on the old code, but three that hold behaviour
  unchanged.

Medium, fixed:
- **M1, a second separator.** The first function dropped any last «,» or
  «.», so «15,5,» read as 15,50 in the phone-keyboard fields — a sum no
  figure more makes one, as «15,5,5». Now only whole hryvnias and their
  separator are read so. The basket's journey checks «15,5,».

Low:
- **L1, fixed:** the refusal's check of nothing recorded could not fail.
  The journey now checks the one body asked, of the row tapped.
- **L2, fixed:** the row tapped gone after a re-read left the focus on the
  body. Now the title takes it; the journey re-reads the day without the
  row while the card stands.
- **L3, written:** the extensions and their side effects are in the rules
  entry — the set-off's «4500,» sent, «0,» as «0» in a price, a second
  separator no sum in the old copies' fields, the refusal at the list's
  top, P2-4 revisiting the review of 2026-10-25 in place only.
- **L4:** the long line in `Sale.tsx` wrapped as Prettier would. Noted, not
  changed: «Ваші операції» keeps its passive menu step aside.

## Mutants

`~/.cache/birka-runtime/helpers/mutate75.py`, run with `mutants75.sh`. Each
mutant is applied, its journey is run once with no retries, and the source
is restored.

19 of 19 caught, each at its own check:
- sale P2-1:
  - `asprice` (the basket);
  - `paidnow`, `checkterms`, `termsfields` («Сплачує зараз»: the tray, the
    check pressed, the line);
  - `debt`, `debtzero` (S21: «4000,» and «0,»);
  - `collect` («Клієнт забрав»);
- the rule's other fields: `neworder`, `setoff`, `receive`;
- the review: `typedloose` («15,5,» read as 15,50), `dayheading` (no
  title in hand when the row is gone);
- orders-cash P2-3: `dayscreen`, `dayplace`, `dayrow`, `dayrefused`;
- orders-cash P2-4: `plateover`, `returnedplate`, `cardkeeps` (the plate
  left on the hidden card).

The four day mutants ran again on the extended journey: 4/4.

## Not covered

- The look on a real phone, in Telegram.
- The full suite is left to CI.
- What is left of the audit 2026-11-18:
  - sale P2-4 (waits for «Прибрати» to be read);
  - money P2-3 (waits for Д1, a real phone);
  - goods P2-3 + P2-4, and P2-5.

  В18-К1, the set-off's limit of 50 returns and the card title's focus
  wait for the user's pick too.
