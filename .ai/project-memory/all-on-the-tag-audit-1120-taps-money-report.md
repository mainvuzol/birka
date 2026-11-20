# «Усе на бірці», audit 2026-11-20, batch 1: taps and money — a result lets its press's second tap go; «Мало бути» below nothing with its minus; a kept «Клієнт забрав» in parts says its own sum; the till's three ways held by their own unread journal — 2026-11-20

Baseline: `7c174481` (main after #234). The audit's ten documents
(`redesign/2026-11-20-redesign-tz-audit-*.md`) come with this batch.

Points: frame P1-1 (the audit's one P1), orders-cash Н1 and Н2, and the
sale's find 1 — the audit's finds about money. Picked in chat: «Taps and
money first».

No request, check, journal, right or word changes. What is recorded, and
the server's checks of it, are as before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1219 (1212 before).
- Branch: `feat/audit-1120-taps-money`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-20 (audit
  2026-11-20, batch 1: …)".

## What exists now

- **A result lets its press's second tap go** (frame P1-1):
  - As a result's screen first shows, before it is painted, for 0.7 s:
    - a finger's tap on its dock lands on the dock, not on its button;
    - a tap on the menu's tabs lands on the menu;
    - Telegram's MainButton pressed does nothing.

    Nothing is done or felt. A key presses them as ever.
  - Every result shares it (`ResultScreen`). It arms again as a dock comes
    on a shown result: «Касу закрито»'s «Готово» where «Записати причину»
    was.
  - A double tap on «Готівка» against a quick server leaves the receipt
    and «Проведіть на терміналі» on the screen; one sale is sent. A second
    tap on S21's ways leaves «Внесок записано».
  - «Інвентаризація»'s own guard is this one now, with the same 0.7 s.
- **«Мало бути» below nothing** (orders-cash Н1): said with its minus — «−1
  850,00 грн» on «Касу закрито», in today's line on «Каса», and in «Гроші» ›
  «Закриття»'s row. Before, «—».
- **A kept «Клієнт забрав» in parts says its own sum** (orders-cash Н2,
  (а)):
  - «Сплачено зараз» and the terminal's «проведіть на терміналі …» are the
    attempt's own `paid_now`.
  - A «Внесок» taken on another phone before the check is no longer in it,
    so the card is no longer asked for that sum.
  - What is owed stays the server's.
- **«Повернути», «Внесок» and «Покупці» held by their own unread journal**
  (sale's find 1): their own lists hold them, as the till's holds the till.
  - Found while proving, on the running app: nothing reaches these screens
    while the journal is unread.
  - The menu's «Продаж», the till's switch, «Сьогодні», «Замовлення» and
    the «Покупці» rows of «Гроші» and «Ще» are held by the same journal
    already, and nobody opens there first.
  - The hold is kept so each screen's own list says what holds it. No
    journey reaches it.

## How it was built and proven

Sources:
- `shared/panel.ts`: `resultStood()` sets `data-carried` on the page's
  root for `CARRIED_TAP`; `carried()` says whether a press now falls in it.
- `shared/ResultScreen.tsx`: `resultStood()` in a layout effect, as it first
  shows and as a dock comes on it shown.
- `styles.css`: `html[data-carried] .result-dock *, html[data-carried]
  .tab-bar .tab { pointer-events: none; }`.
- `shared/telegram.ts`: `pressMain` returns while `carried()`.
- `inventory/Stocktake.tsx`: its `doneAt` / `late` are gone.
- `cash/Closed.tsx` (two places), `cash/History.tsx`: `signed()`.
- `App.tsx`:
  - the collect's `paidNow` comes from the command's `body.credit.paid_now`,
    read only in the server's form of a sum, and is passed to the card;
  - the hold lists of «Повернути», «Внесок» and «Покупці».
- `orders/Order.tsx`, `orders/Collected.tsx`: `taken` is
  `paidNow ?? order.credit.paid`.

Decided here, how the guard works: a root attribute and `pointer-events`,
so a tap lands on the dock or the menu itself. With this, Playwright's
clicks wait it out by themselves: a click retries until its target takes
the tap. The window belongs to the page, not to one result.

Journeys (+7):
- New:
  - `till-taps` — a double tap on «Картка» while the receipt stands: the
    second lands on the dock, and a tap on «Новий продаж» itself within the
    window; the receipt and «Проведіть на терміналі» stay, one sale;
    «Новий продаж» a moment on; Enter at once.
  - `credits-debt` — S21's way tapped twice, and a tab tapped within the
    window: «Внесок записано» stays, one payment; the tab a moment on.
  - `telegram-rules` — S22's MainButton pressed as it stands: nothing; a
    moment on, the debt.
  - `cash-close`:
    - «Мало бути −1 850,00 грн» large and in the day's line;
    - «Записати причину» tapped twice: «Причину записано…» stays where
      «Готово» comes.
  - `cash-history` — the row's «мало бути −1 850,00».
  - `orders-card` — a kept collect in parts by card, confirmed after a
    «Внесок» elsewhere: «Сплачено зараз 1 000,00», the terminal's 1 000,00,
    «Покупець винен 1 500,00».
- Each new journey catches the window as it begins, frame by frame
  (`resultJustStood`), so what follows falls inside it on a slow machine
  too.
- Waiting the window out (`resultTakesPresses`), as the task asks them
  listed: five journeys that pressed Telegram's MainButton within 0.7 s
  of a result:
  - `credits-debt` — Telegram buzzes, S22's press;
  - `telegram-rules` — S21 and S22, «Відкрити борг»;
  - `cash-close` — inside Telegram, «Записати причину» after the close;
  - `supplier-invoices` — inside Telegram, the payment's «Готово»;
  - `suppliers` — the return's result, «Готово».

  No click needed a wait.

Runs on a fresh seed:
- The specs a result's guard can break: every one that presses Telegram's
  MainButton or taps with the mouse, the new journeys' specs, and
  `design-system`, `stocktake`, `borrowed`, `suppliers` and
  `supplier-invoices` first (26 specs):
  - first: 531 passed, 5 failed — exactly the five above;
  - after the fixes: 537/537.
- The other 46 specs click results' docks and tabs only through Playwright,
  which waits. CI runs all 1219.
- mutate78, 15 mutants, each against its journey: 15 caught.
  - The guard: never armed, armed by its count only, not again as a dock
    comes, not on the tabs, not on the MainButton, no window, never let go,
    let go at once.
  - Its CSS without the dock's buttons first survived: the till's second
    tap at «Картка»'s place landed on the dock's padding, not on «Новий
    продаж». The journey now taps «Новий продаж» itself within the window,
    and it is caught.
  - Н1: the large sum, the day's line, the history's row. Н2: the server's
    `paid`, no `paidNow`, not passed to the card.
  - Find 1 has none: no journey reaches it (above).

## The review

An independent review read the diff against the four points. `tsc` and
ESLint are clean.

Checked and found right:
- Н2's `paidNow` is keyed to its order and reset with it. A collect not in
  parts says the order's total. The sentence heard and the terminal's line
  use the same sum.
- Н1: «−» is drawn by `Sum`. «−0,00» cannot come: the server writes zero as
  `0.00`. `expected` is null only for a first count.
- Find 1: both flags come only from a journal's load.
- The CSS: no other `pointer-events` in the docks or the tabs. The dock and
  the tab row hold no handlers, and the rule's specificity wins.
- StrictMode's double effect is harmless.

Found and fixed:
- **High:** existing Telegram journeys pressed a result's MainButton inside
  the window. A message is never retried as a click is. These are the five
  listed above, and they wait now.
- **Medium:** «Касу закрито» owed a reason — its «Готово» came later,
  unguarded, where «Записати причину» was. The guard arms again as a dock
  comes; a new journey and a mutant cover it.
- **Medium:** the new journeys hung on Playwright's polling, which can be
  500 ms late. They now catch the window by animation frame.
- **Low:** the kept `paid_now` is read only in the server's form of a sum;
  otherwise the server's `paid`.

Known, kept:
- **Low:** a collected order's card is its result again when it is opened
  once more, so after coming back to «Замовлення» the menu takes no tap for
  0.7 s. The screen changed under the thumb all the same (business rules).

## Left

- Audit 2026-11-20's batch 2, «lists past fifty»: money Н1 and Н2, goods Н1
  and Н2, orders-cash Н3.
- The P2s.
- The owner pack's answers.
- Dependabot pull request #223 is redundant after #233. It is closed only on
  the user's word.
