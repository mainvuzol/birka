# ADR-0012: Cash and card, the day's close

Status: Accepted (2026-10-04)
Owner decisions: business-rules.md, "cash and card, the day's close"
(2026-10-04), with the answers to the design's readings the same day.
Builds on: ADR-0003 (a command's permanent identity), ADR-0008 §9
(`recorded: false` settles an unknown attempt), ADR-0011 (the watcher and
its silent messages), the store states (`tenancy.hold_stores`).

## Context

The app did not know how a customer paid, so nobody could count a drawer
against it. A read-only mapping of the code found:
- **No way of paying was recorded.** Nothing on `sale`, `credit_entry` or
  `refund` said cash, card or transfer.
- **«Разом у касі» in «Звіт» took everything as cash:** sales paid in full
  and debt payments, less the money returns handed back. Every card payment
  was in it.
- **An order's whole price counted at «Клієнт забрав»** as till money of that
  day, though every order goes by a carrier and may be paid in advance or on
  delivery.
- **Nothing counted a drawer.** No till, count, float, take-out or close
  existed anywhere.

The owner decided the rules on 2026-10-04, and answered the design's
derived readings the same day. Two answers changed the plan:
- before the close a seller fixes the way on any of their own operations:
  sales, debt payments and returns, not sales alone;
- a difference under 1,00 грн needs no reason and no message.

The rest is technical. The readings the owner has not confirmed yet are
built as recommended, and listed in the business rules ("carried out").

Nothing is live, so sales recorded before this change are test data. Their
way reads «не вказано», and is never guessed.

## Decision

### 1. The way of paying

- **Five values,** in `app/modules/sales/payment.py`:
  - the till's three: `CASH` «Готівка», `CARD` «Картка» (the terminal),
    `TRANSFER` «Переказ» (to the shop's card or account);
  - an order's two more: `PREPAID_TRANSFER` «Переказ наперед» and
    `CARRIER_COD` «Накладений платіж». They never go through the till.
- **Only `CASH` is the drawer's.**
- **Stored on the money rows themselves,** nullable, `VARCHAR` with a CHECK:
  - `sale.payment_method`: a sale paid in full, a collected order included;
  - `credit_entry.payment_method`: a payment toward a debt, payments only.
    The first payment of a sale in parts holds the way pressed at the till,
    and the sale holds the same value for display;
  - `refund.payment_method`: how the money went back, the till's three only.
- **NULL is «не вказано»,** and exists only on rows written before `0035`.
  Nothing is backfilled.
- **One way per payment.** A sale is never split between cash and card.
- It lives in `sales`, which every money module already imports, so it
  needs no module of its own.

### 2. Every money command asks for it

- `POST /sales`, `POST /credits/{id}/payments` and
  `POST /sales/{id}/refunds` take `payment_method`, one of the till's three.
  `POST /orders/{id}/collect` takes any of the five.
- **Optional in the request, required by the service.** A new command
  without it is refused after its replay lookup: `422 VALIDATION_ERROR`,
  reason `PAYMENT_METHOD_REQUIRED`, `recorded: false`. A field required in
  the request would refuse an attempt saved before this change before its
  replay was looked up, and that attempt could never settle.
- **A return:**
  - of a sale paid in full checks its way right after the lookup, before
    its lines;
  - of a sale paid in parts asks for a way only when money goes back. One
    that only lowers the debt moves no money, and is stored without a way;
  - `REFUND_EXCEEDS_SOLD` now carries `recorded: false`. The lookup holds
    the command's lock, so the refusal proves this command wrote nothing.
- **Prints.**
  - The permanent print and the 7-day print carry the way only when it was
    sent.
  - `SaleRequest` now forbids unknown fields, and its 7-day print drops an
    absent way, as `RefundRequest`'s does.
  - Golden prints taken at `32ea05a` pin that every older command still
    replays (`test_old_prints_are_pinned.py`).

### 3. The drawer's periods

- **One drawer per store.** Its period *k* is everything recorded at its
  drawer after close *k−1* and up to close *k*. A close never reopens, so a
  closed period never changes.
- **Membership follows commit order, not a timestamp.**
  - `drawer_period` sits on `sale`, `credit_entry` (payments only),
    `refund`, `cash_movement` and `payment_correction`.
  - A BEFORE INSERT trigger sets it through `birka_drawer_period(store)`.
    That function takes the store's row `FOR KEY SHARE`, then reads the
    newest close's number and adds one. The application never writes it.
  - The close takes the same row `FOR UPDATE`. So it waits for every money
    row already stamped, and a row that reaches its trigger later waits for
    the close and goes into the next one: never in both, never in neither.
  - A timestamp could not do this: `now()` is the transaction's start, so a
    sale begun before a close and committed after it would belong to
    neither side.
- **Every insert path is stamped alike:** the till, «Клієнт забрав» (which
  takes no store lock of its own), a payment or a return at another store,
  a script, a test.
- **Money commands run at READ COMMITTED.** `birka_drawer_period` refuses
  to run at any other isolation: at REPEATABLE READ it would read a snapshot
  taken before the close it waited for.
- Rows written before `0035` belong to no period.
- A BEFORE UPDATE guard on `sale` and `refund` refuses any change to the way
  or the period. `credit_entry` was append-only already.

### 4. The day's close

`POST /cash/closes?age=<seconds>` with `store_id`, `command_id`, `counted`,
`counted_at` and `after_close_id`. One append-only `cash_close` row. In
order:
1. **A pre-check** of `cash:close` keeps outsiders from the store's lock.
2. **The store's row, `FOR UPDATE`.**
3. **Who may, by the locked row's state,** never by the request's scope,
   whose state was read without a lock:
   - a store that trades: `cash:close` there;
   - a blocked store: the network's owner only, `store:manage` and
     `cash:close` held organization-wide;
   - an archived store: nobody.

   In a store that trades, whoever may not is refused here, 403.
4. **The command is looked up** under its own lock. The same print answers
   the stored close; another is `409 IDEMPOTENCY_CONFLICT`.
5. **In a store that does not trade,** whoever may not close it is refused
   here, after the lookup: `STORE_NOT_TRADING` with `recorded: false`. A
   close recorded before the block or the archive was answered in step 4.
6. **A count that no longer describes the drawer** is refused:
   - `age` above 600 seconds: `COUNT_IS_STALE`. `age` is the time since
     «Так, закрити» by the phone's own clock, sent outside the print, so a
     resend stays byte for byte the same. Below nothing (a phone clock set
     back) it is taken as nothing, so a resend is never refused before its
     lookup;
   - the newest close is not `after_close_id`, the one the count screen
     showed: `CLOSED_BY_ANOTHER`.
7. **The business day** is the date of the close's moment less 6 hours, in
   the store's zone: a close before 06:00 is the evening before's. One close
   per business day (`ALREADY_CLOSED_TODAY`), backed by
   `UNIQUE (store_id, business_day)`.
8. **An opening count:** the store's first close, or the first after it
   came back from the archive. It records `counted`, with no expected sum
   and no difference.
9. **Any other close:**
   - `expected = opening_float + cash_in − cash_out − taken_out + put_in +
     cash_corrected`, where the opening float is the previous count;
   - `difference = counted − expected`;
   - every figure is frozen on the row, and the formula is a CHECK.
10. **Card, transfer, the two order ways and «не вказано»** since the
    previous close are kept beside, for display (`others`). Card and
    transfer are not counted: they are shown after the count, to compare by
    eye with the terminal's slip.

A day nobody closed rolls into the next close. `unclosed_days` lists the
business days in between on which money moved; never the counted day.

### 5. The blind count and the reason

- **Before their count, no screen and no list gives the seller what the
  drawer should hold:**
  - `GET /cash/drawer` carries no sum of any kind;
  - `GET /sales`, the list a seller pages through, never carries a way;
  - `GET /sales/{id}` blanks the way unless the caller sold it or reads the
    money (`report:view_financial`);
  - their own operations of the open period are listed by time and goods
    only (`GET /cash/events?mine=true`);
  - the way of one sale is given only where it is needed: the sale being
    returned or fixed.
- **After their close** the seller sees what it should have held, what they
  counted, the difference, card and transfer, and the days not closed. They
  do not see the order ways, «не вказано» or the cash's breakdown. A
  holder of `report:view_financial` sees all of it.
- **The reason is a second command,** `POST /cash/closes/{id}/reason`: once
  per close, append-only, by whoever counted and nobody else. Refusing a
  count until a reason came would reveal the difference and let the count
  be typed again.
- **The closer's phone waits for it.** The drawer's `reason_owed` names their
  newest close with a difference and no reason, and every tab but «Каса» is
  disabled. It is read from the server, so a reload does not lose it.
- **A difference under 1,00 грн** (`SMALL_DIFFERENCE`) is recorded and
  shown, but needs no reason and no message: `NO_DIFFERENCE`, as for none.

### 6. Cash taken out and put in

`POST /cash/movements` with `kind`, `amount`, an optional `note` (at most
200 characters), `after_close_id` and an optional `for_close_id`. One
append-only `cash_movement` row.
- **Kinds.** Out: `OWNER` «Власнику», `EXPENSES` «Витрати»,
  `SUPPLIER_COURIER` «Кур’єру постачальника». In: `CHANGE` «Внесено в касу
  (розмін)». No «Інше». The amount is above nothing; the kind gives the
  direction.
- **Who.** A seller (`cash:expense`) records expenses and a supplier's
  courier; the owner and managers (`cash:take_out`) any kind.
- **Only in a store that trades.**
- **Which period: when the phone recorded it.** `after_close_id` is the
  newest close its screen showed.
  - When another close reached the server first, the movement goes on that
    close (`moved_to_close`): the cash left before that count.
  - **Only while that close is the store's newest, is the one that followed
    the screen's, and was made at most ten minutes ago by the server's
    clock.**
  - Otherwise it is refused, `CLOSE_IN_BETWEEN` with `recorded: false`, and
    nothing is written. The person records it again in the open period, or
    the owner or a manager names the close.
  - The server cannot tell a genuine late resend from a request that names
    an old close only to reach a closed day. Within ten minutes of a close,
    a seller could as well have recorded the cash before it.
- **`for_close_id`,** named by the owner or a manager (`cash:correct`),
  records cash taken out and forgotten against the close it belongs to.
- **A supplier's courier paid from the drawer pays no invoice.** «Накладні»
  stay separate, and a manager records the invoice there.

### 7. Corrections of a way

- **Nothing is rewritten.** A wrong way is fixed by a new append-only row,
  `payment_correction`:
  - it names one money row: a sale, a payment or a refund. `SALE` means the
    money taken with the sale: the sale, or its first payment when it was
    paid in parts;
  - `seq` 1, 2, … per money row, `from_method` (NULL is «не вказано») and
    `to_method`, the amount and the direction frozen.
- **The database checks it.** Its trigger stamps the period and refuses a
  wrong store, amount or direction, a wrong closed close, a broken `seq` or
  a `from_method` that is not the current way. The current way is the
  `to_method` of the highest `seq`.
- **Who:**
  - the owner or a manager (`cash:correct`): any money row with a period,
    any time, while the store trades;
  - a seller (`sale:create`): their own sale, debt payment or return, while
    its period is open. After the close: `DAY_CLOSED`;
  - a row written before `0035` is in no period: `BEFORE_DRAWER`.
- **In this order:** the store is held, the command locked and looked up,
  the money row locked, the current way and the last close read, then the
  decision and the insert. A close cannot commit in between. A stale screen
  gets `409 PAYMENT_METHOD_CHANGED` with the current way.
- **The arithmetic.**
  - A correction of the open period changes its expected cash by its cash
    effect.
  - A correction of a closed period, and a movement named for a closed
    close, change no period's expected cash. They **explain** that close's
    difference: `explained` and `unexplained` are read live beside the
    frozen row.
  - The next period started from the count, which already held that money.
    Counting it again today would double it.
  - In «Звіт» a correction counts on the day it is made. A past day never
    changes.
- **A card the terminal refuses:** the seller fixes the way before the
  close; a customer who leaves without the goods is a return «На картку».

### 8. A refusal that proves nothing was written

- **Every cash command is looked up by its `command_id`** under its own
  lock before anything is decided. A resend is answered with what the first
  send did, and two sends at once end in one row, never a 500.
- **Every refusal decided after the lookup carries `recorded: false`:**
  `COUNT_IS_STALE`, `CLOSED_BY_ANOTHER`, `CLOSE_IN_BETWEEN`,
  `ALREADY_CLOSED_TODAY`, `NO_REASON`, `NO_DIFFERENCE`, `REASON_GIVEN`,
  `DAY_CLOSED`, `SAME_METHOD`, `METHOD_NOT_FOR_THIS`, `BEFORE_DRAWER`,
  `PAYMENT_METHOD_CHANGED`, and `PAYMENT_METHOD_REQUIRED` on the money
  commands. A phone that never heard the first answer settles its attempt.
  Without the marker the «Каса» journal would hold every tab for good.
- **Whether the store trades is decided after the lookup,** in every cash
  command, on the store's row it holds. A close, a reason, a movement or a
  correction recorded before a block or the archive is answered as a
  replay. Only a new one is refused, `STORE_NOT_TRADING` with
  `recorded: false`.
- **Refusals before the lookup** (403, 404) keep their usual meaning. A
  seller whose only grant is the store's own is refused by their scope in a
  blocked store, as before; their phone shows no «Каса» there.

### 9. The bot tells the owner

- **When:** a close with a difference of 1,00 грн or more. Never for none,
  for less, or for an opening count. Once its reason is written, or 15
  minutes after the close without it. One message per close per person; a
  reason given later stays in the app.
- **To whom:** the network's owner, everyone holding `store:manage` through
  an organization-wide membership of that network, with a chat. Never
  whoever closed.
- **How:** silently, at any hour, as backup messages.
- **Recorded before it is sent.** `cash_message` is an outbox. The watcher
  (`backup-watch`) queues what is due and sends it every minute, with the
  backups' silent sender; a message is retried for a day, and a refused bot
  token keeps every message waiting. A close older than a day is not told.
  The algorithm is copied from backups, because the contracts keep the shop
  apart from the backups section.
- **No message for a day nobody closed:** the next close's message names it.
- **The text:**

```
Каса «Ринок», 07.10: нестача 150,00 грн.
Підрахунок: Марина, 20:14 — 6100,00 грн; мало бути 6250,00 грн.
Причина: «помилилась зі здачею».
Не закрито: 06.10 — цей день увійшов у це закриття.
```

### 10. Who may do what

| Code | What | Given in `0035` to |
|---|---|---|
| `cash:close` | count and close the store's drawer; write the reason of one's own close | every role that holds `sale:create` |
| `cash:expense` | take out cash for expenses or a supplier's courier | every role that holds `sale:create` |
| `cash:take_out` | take out cash of any kind, and put it in | every role that holds `report:view_financial` |
| `cash:correct` | correct any way; record cash taken out and forgotten against its close | every role that holds `report:view_financial` |

- **The split by way and the closes** are read with `report:view_financial`,
  as «Звіт» is. A seller reads only their own close.
- **A blocked store's close** is checked in `cash/service.py` on the locked
  row, not added to the request's scope, which gives nothing in a store that
  does not trade.

### 11. The API

| Endpoint | Who |
|---|---|
| `GET /cash/drawer?store_id=` | `cash:close`, `cash:expense` or `report:view_financial` there |
| `POST /cash/closes?age=` | §4 |
| `POST /cash/closes/{id}/reason` | the close's own counter |
| `GET /cash/closes/{id}` | its counter (the seller's view) or `report:view_financial` |
| `GET /cash/closes` (`store_id`, `date_from`, `date_to`, `limit` up to 100, `offset`) | `report:view_financial` |
| `POST /cash/movements`; `GET /cash/movements` | §6; `report:view_financial` |
| `POST /cash/corrections` | §7 |
| `GET /cash/events?store_id=&day=` | `report:view_financial`: a day's money, with sums and ways |
| `GET /cash/events?store_id=&mine=true` | `sale:create`: their own sales, payments and returns of the open period, by time and goods only |
| `GET /cash/sales/{id}/method` | the drawer's `report:view_financial`, the sale's own seller, or `sale:refund` where it may be returned |
| `GET /cash/payments/{id}/method`, `GET /cash/refunds/{id}/method` | the operation's own actor, or the drawer's `report:view_financial` |

- The commands carry a permanent `command_id`, and the server keeps no
  Idempotency-Key cache for them.
- **Answers that changed,** each with a default, so stored snapshots still
  read: `SaleResponse`, `RefundResponse` and `OrderResponse` carry
  `payment_method`; `CreditResponse.entries[]` carries each payment's and
  return's current way and `corrected`. `SaleSummary` is unchanged.

### 12. The sales report

- **Summed by way,** live as before. For each store and period, and each of
  cash, card, transfer and «не вказано»: what came in, what went out, what
  corrections moved, and the net.
- **`cash` is renamed `money`.** It was always the money through the till,
  never banknotes:
  `money = paid_in_full + debt_payments − paid_back + corrected_into_till`.
  The four ways' nets add up to it.
- **An order paid in advance or on delivery** has its own lines
  (`off_till`), outside «Разом». It leaves `paid_in_full`, where it was
  wrongly counted.
- **A correction counts on the day it is made,** at its drawer, as its own
  figure. A past day never changes.
- **Each entry** says the way it was paid (`payment_method`), and the way
  now when it was corrected (`method_now`).
- On the screen: the heading «Гроші», the total «Разом», rows «Готівка»,
  «Картка», «Переказ», and «Не вказано» or «Замовлення, оплачені поза
  касою» only when they hold something. Movements are not in «Звіт»; they
  are in «Каса».

### 13. The screens

- **«Продаж»:** «Продати» becomes three buttons, «Готівка», «Картка» and
  «Переказ», disabled while the basket is empty. A sale is still **5
  taps**. The seller presses first, then charges the terminal for the sum
  the receipt shows. The receipt names the way; a card's says to charge the
  terminal, a transfer's to check it arrived before handing the goods. A
  quiet «Змінити спосіб оплати» opens the fix for that sale.
- **«Борги»:** the same three buttons under «Внесок» replace «Прийняти
  внесок». The history names each payment's way.
- **«Повернення»:** «Як повертаємо гроші» («Готівкою», «На картку»,
  «Переказом»), preselected from the sale's way. With nothing to suggest,
  the seller chooses. **+0 taps** when preselected, +1 otherwise.
- **«Клієнт забрав»:** «Як оплачено замовлення», five choices, none
  preselected: «Переказом наперед», «Накладеним платежем», «Готівкою —
  зараз, на касі», «Карткою — зараз, на терміналі», «Переказом — зараз».
  One more tap; not the hot path.
- **«Каса»,** for `cash:close`, `cash:expense` or `report:view_financial`,
  and in a blocked store for the network's owner only:
  - the seller: the last close, a reminder to record cash taken out first
    and not to sell while counting, «Скільки готівки в касі зараз, грн»,
    «Закрити касу», «Так, закрити». **3 taps** and the sum. Then the
    result, and «Чому не збігається?» when a reason is due;
  - «Видати з каси», and for the owner and managers «Внести в касу»;
  - «Змінити спосіб оплати»: their own operations of the open period, then
    one of them with its sum and way;
  - the owner and managers: the history «Закриття», 20 at a time with
    «Показати ще», what explains each difference, and «Виправити спосіб
    оплати» for any day.
- **Journals.** «Каса» keeps its unanswered commands like every other
  journal (`birka:cash-pending:…`), and they hold the other tabs until
  settled. The other journals send the way only when present, so an attempt
  saved before this change is resent byte for byte. A resend refused with
  `recorded: false` now says plainly that nothing was recorded, and what to
  do.

### 14. Compatibility and going back

- **An attempt saved before this change** is resent unchanged. A recorded
  one replays. An unrecorded one is refused `PAYMENT_METHOD_REQUIRED` and
  settles; a refused sale rebuilds an empty basket, and says so.
- **A page of the previous version left open** has no way buttons. Its
  sales, payments, returns and collects are refused until the app is closed
  and opened again, with the generic text. After this deploy, the app is
  reopened on every phone.
- **Going back by the code alone across `0035` is not safe** once phones
  run the new version:
  - a sale recorded with a way whose answer was lost, resent to the old
    server, gets `409` and holds the phone until the next upgrade;
  - payments, returns and collects from a new page are refused by the old
    code's forbidden extra field;
  - what the old code records reads «не вказано» and is in no expected sum,
    so the next close shows a false surplus until each is corrected.

  Prefer a fix forward. If going back cannot be avoided, reopen the app on
  every phone after it, and again after the next upgrade.
- **The downgrade of `0035` refuses** once any close, movement or
  correction exists, or any sale, payment or return has a way: `0034`
  cannot say how anything was paid.

### 15. The migration and the module

- **`0035_cash_and_card`:** the columns, the five tables (`cash_close`,
  `cash_close_reason`, `cash_movement`, `payment_correction`,
  `cash_message`), the functions and triggers, and the grants. Four tables
  are append-only; `cash_message`'s status moves, as a backup alert's does.
- **`0034` is frozen** in the same change.
- **Module `cash`** (ADR-0001 amendment, 2026-10-04): `models`, `current`
  (current ways, read-only), `service`, `read`, `messages`. No money module
  imports it: the stamp is a trigger, and the API merges current ways into
  answers. 31 import contracts.

### 16. The hot path

- Every sale now carries a way and runs the stamp trigger, so the release
  reading (checklist row 22) was taken again on 2026-10-04: three runs on
  fresh databases, all 8 cases passed every run, worst p95 167.6 ms against
  500.
- A sale is still 5 taps (row 10).

## Rejected

- **A table of payments, split allowed:** the owner chose one way per
  payment. Columns keep the prints, the snapshots and the report's joins.
- **A period cut by timestamp:** a sale in flight would belong to neither
  close.
- **Stamping in Python in each command:** one forgotten path would misplace
  money silently. A trigger cannot be forgotten.
- **A correction of a closed day changing today's cash:** it double counts.
- **Reopening a closed day:** the owner rejected it.
- **The reason in the close's own request:** the refusal would reveal the
  difference.
- **`payment_method` required in the request:** old attempts would be
  refused before their replay, for good.
- **Cash preselected, card a sixth tap:** the owner chose three buttons and
  five taps.
- **The API sending the bot's message after the commit:** lost with
  Telegram or the process. The watcher's outbox retries.
- **Reusing `backup_alert`:** a server table, with no organization.
- **Comparing the phone's `counted_at` with the server's clock:** a phone
  with a wrong clock would have every close refused. The phone measures the
  age with its own clock.
- **Recording a kept close whenever it arrives:** a count describes one
  moment; recorded later, it would put later sales against it.
- **Moving a resent take-out onto any close named by its screen:** a
  seller could reach a closed day without `cash:correct`.
- **Stamping a resent take-out into the period it arrives in:** the cash
  left before the close in between; it would show as −X on one close and +X
  on the next.
- **A list of the seller's sales with sums or ways before their count:** it
  hands them the expected sum.
- **A drawer per seller:** the owner chose one drawer per store.
- **Typing the terminal's total at the close:** the owner chose comparing by
  eye.

## Consequences

- **After this deploy, close and reopen the app on every phone.**
- **Going back by the code alone across `0035`** blocks phones holding new
  attempts and leaves those days' sales «не вказано». Prefer a fix forward
  (server runbook).
- **The blind count is a guarantee of the screens,** not of memory or of
  «Звіт»: a seller can remember their sales and read debts one by one, and a
  manager can work the expected sum out (risk register).
- **The outbox algorithm exists twice,** in `backups` and `cash`.
- **The carrier's cash on delivery is not checked** against what the carrier
  paid out. It is later work.
- **Fiscal receipts (ПРРО) are not part of this.**
- **The readings the owner has not confirmed yet** are built as recommended
  and cheap to change before go-live (business rules, "carried out").
