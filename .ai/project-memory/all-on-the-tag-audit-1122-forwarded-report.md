# «Усе на бірці», audit 2026-11-22, batch 5: «Передане далі» — what the audits passed on and nobody built: every search's answer heard; a debt's history newest first; all of it paid now said with its sum wherever it is refused; «Зарахувати повернення» asking Telegram while a sum is typed; the closed stores' debts never one sum — 2026-11-23

Baseline: `617792a6` (main after #244).

Points: sale Н1 (`financial-integrity`); the passes' observations outside
their sections — the frame's (the till's empty search, open since
2026-11-18), the sale's (the server's «сплачує все одразу» on «Клієнт
забрав»), the money's («Історія боргу»'s order) and the orders-cash's (the
sweep of forms with a typed sum).

Taken as the next after «continue development via project»: nothing of the
audit's task lists was left that waits for no owner's answer, and three TZs
had passed the till's empty search on without a task. Not in it: money
P2-5 (Д4 and В22-Г1), goods P2-3 (б) (В22-Т1 / Н2), goods P2-5 of
2026-11-20 (В20-Т1); «Зверніться до менеджера.» to a manager (the frame's
rule, if it decides); the result's heading level; «Повернули
постачальнику» in «Брак».

No right, check, journal or step changes; nothing recorded or sent
changes; no server change, no migration.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1263 (two new, ten extended).
- Branch: `feat/audit-1122-forwarded`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-23 (audit
  2026-11-22, batch 5: «Передане далі» …)".

## What exists now

- **A search's answer heard as it is drawn** (the frame pass; the rule of
  2026-11-18, goods P2-4): the till, «Повернення» (here and in the other
  stores), «Покупці», «Внесок», the closed stores and «Замовлення»'s
  waybill search — the line of their blank tag a status, as «Моделі»'s.
  An empty place nobody searched is not said aloud. A store's block among
  several in the network owner's «Покупці» keeps its quiet «Нікого не
  знайдено.».
- **«Історія боргу», the newest first** (the money pass; §6.21), as an
  invoice's «Історія».
- **All of it paid now, one sentence** (the sale pass): «Покупець сплачує
  все одразу (2 000,00 грн) — це звичайний продаж. Зніміть «Оплата
  частинами» або змініть суму.» from the form's own check, the till's
  refusal and the server's refusal on «Клієнт забрав» alike, the sum the
  server's.
- **«Зарахувати повернення» asks before Бірка closes** while a sum is typed
  (the orders-cash pass's sweep): the last payment's form without it.
- **The closed stores' debts by store, never one sum** (sale Н1): under a
  phone, a line a closed store with its own sum; in «Магазини, що не
  працюють», a row a store for a customer who owes in several, each row
  opening all their debts, as one row did.

## How it was built and proven

Sources:
- `frontend/src/sales/StockSearch.tsx`, `frontend/src/returns/Returns.tsx`,
  `frontend/src/credits/Credits.tsx` (three places),
  `frontend/src/orders/Orders.tsx`: `status` on `Empty`.
- `frontend/src/credits/Debt.tsx` (`History`): the entries turned, each
  keyed by its place in the server's answer.
- `frontend/src/shared/api.ts` (`paidInFullText`, `errorText`),
  `frontend/src/credits/Terms.tsx` (`checkTerms`),
  `frontend/src/sales/Sale.tsx` (`refusalText`): one sentence.
- `frontend/src/suppliers/InvoiceActions.tsx` (`SetOff`):
  `useAskBeforeClosing` while the sum is not blank.
- `frontend/src/credits/types.ts` (`apartByStore`): a customer a part a
  store, by `store_id`, its sum in kopecks from its debts' own, unread if
  any is; one store — the customer as answered.
  `frontend/src/credits/Terms.tsx` (`NumberDebt`): a line a part owed.
  `frontend/src/credits/Credits.tsx` (`Rows`, `apart`): a row a part,
  keyed by the customer and the store, opening the whole customer.

Decided here: see the business rules' entry — the network owner's blocks
unheard; a refusal without a readable sum said without brackets; a return
chosen with no sum asking nothing; the development's 2026-10-20 one line of
the closed stores' sum replaced.

Journeys:
- New:
  - `supplier-invoices`: «Зарахувати повернення» inside Telegram 7.0 — a
    return chosen asks nothing; a sum typed asks; cleared, no longer; «1200,»
    asks; the sheet closed, no longer; nothing sent;
  - `credits-debt`: at the till, a customer owing two closed stores — a row
    a store, its sum and its store in its name, never 4 500; «Ринок»'s row
    of two debts opens «На який борг вносить?» with all three; «Поділ»'s
    row of one opens its debt.
- Extended:
  - `till-first-days`, `returns-list`, `credits-list` (twice),
    `credits-debt`, `orders-list`: the search's answer a status with its
    line;
  - `credits-debt`: «Історія боргу» newest first — its rows, metas and sums;
  - `orders-card`: «Клієнт забрав» in parts, the server's «PAID_IN_FULL»
    with its total — the sentence with «2 000,00 грн» and «або змініть
    суму»; nothing recorded;
  - `credits`: under the phone, two closed stores, one of them twice — a
    line a store (1 200 and 500), never 1 700, one line each; a store's sum
    unread said «—»;
  - `credits-list`: «Магазини, що не працюють», a row a store with its
    sticker, sum and name, never 4 000; either row opens her card.

Runs on a fresh seed:
- Before the review: the 15 specs that read the touched screens
  (`supplier-invoices`, `credits-debt`, `credits`, `credits-list`,
  `orders-card`, `orders-list`, `outage-mark-debts-returns`,
  `returns-elsewhere`, `returns-list`, `returns`, `stores`,
  `telegram-rules`, `till-first-days`, `till-shortage`, `till-search`):
  346/347 — the one failure the review's first finding (below).
- After the review's fixes: the set-off journey 1/1; `credits-debt`,
  `credits`, `credits-list`, `till-first-days`, `stores` 129/130 — the one
  failure the new check's own (`toHaveAccessibleName` takes no list), 1/1
  once split.
- CI runs all 1263.

Mutants (mutate88, 19, each against its journey; run after the pull
request was opened, on the user's «Create PR»): 19/19 caught. One was
rewritten first: «a part's sum the customer's», written as
`customer.owed ?? each.every(…) ? … : …`, was read as `(… ?? …) ? sum : ""`
and changed nothing — it passed; written as `owed: customer.owed`, it is
caught (`credits-list`, the closed stores' rows).
- Heard: each of the six searches' `status` dropped.
- The history: not turned.
- All paid now: no sum; no «або змініть суму»; the old words in
  `errorText`.
- The set-off: never asking; always asking.
- The closed stores: the line of their sum; stores by name; the list
  whole; a part's sum the customer's; the till's one-debt row opening the
  sheet; a row unnamed by its store; a store's unread sum left out.

## The review

An independent review read the diff against the five points, the closed
stores' money and the shared sentence. One real bug, the rest low.
- **High, fixed:** the new set-off journey opened Бірка outside Telegram,
  so no version was known and nothing was posted — it could never pass.
  It opens inside Telegram 7.0 and reads what Telegram is told through the
  spec's own `told`.
- **Low, fixed:** at the till, a closed store's row naming one debt opened
  «На який борг вносить?» with every store's debts: it opens that debt
  now; a row of several still opens the sheet of all hers.
- **Low, fixed:** two rows of one customer were named apart only by their
  sums: a closed store's row names its store, as the sheet's rows do.
- **Low, fixed:** a store's sum that cannot be read was left out of the
  lines under the phone: it is said «—»; a customer with no debt draws no
  line.
- **Nit, fixed:** the till's comment had been split by the new one.
- **Known:** a status mounted with its words is not announced by every
  reader — the rule of 2026-11-18 as built; no two statuses speak at once.
- **Checked fine:** sums by store in kopecks, order kept; keys unique; no
  summed closed stores' sum shown anywhere (the sheet, the card, «Сьогодні»);
  the server's `total` a decimal; no import cycle; the history's keys
  stable.

## Left

- money P2-5: Д4 (the server's read, which needs the user's consent) and
  В22-Г1.
- goods P2-3 (б) waits for В22-Т1 or a count (Н2), and a server field.
- goods P2-5 (2026-11-20) waits for В20-Т1.
- «Зверніться до менеджера.» said to a manager — the frame's rule, if it
  decides.
