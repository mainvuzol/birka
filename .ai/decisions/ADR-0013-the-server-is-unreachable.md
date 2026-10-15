# ADR-0013: The server is unreachable

Status: Accepted (2026-10-07)
Owner decisions: business-rules.md, "the server is unreachable" (2026-10-04),
and "what the 2026-10-04 answers left open" (2026-10-07), with the answers
of 2026-10-08 in it.
Builds on: ADR-0003 (a command's permanent identity), ADR-0008 §9
(`recorded: false` settles an unknown attempt), ADR-0010 §4 (the page is
never cached), ADR-0011 (the watcher, and every answer has a number),
ADR-0012 (the drawer by commit order, §8 refusals after the lookup, the
prints).
Amended by: ADR-0014 (2026-10-08), §4.2: a slow call's own timeout is not
an outage.

## Context

When the server did not answer, the phone said «Сервер зараз недоступний»,
recorded nothing, and said nothing about the customer at the counter. A
read-only mapping of the code (four readers and a critic) found:
- **A phone stopped selling after one unanswered sale.** The attempt is
  written before the request and kept as unknown on no answer, a 5xx or a
  timeout. Every tab is disabled while it waits, and a different basket is
  refused on that phone.
- **Nothing said what to do.** The phone said «Немає відповіді сервера…» or
  «Сервер зараз недоступний…». A database or schema failure even read as a
  server error with a number: the API answered it `500 INTERNAL_ERROR`, since
  it handled only domain and validation errors.
- **A kept sale refused on resend never settled.** Refusals decided after a
  sale's lookup carried no `recorded: false`, so the journal kept the
  attempt. Pressed again days later, after a delivery, it **sold**, dated
  that day. Debt payments and orders had the same gap.
- **The phone never noticed the server was back.** No listener, no retry,
  no probe. TanStack Query's default `networkMode: "online"` paused a query
  silently once the WebView said it was offline, so «Повторити» did nothing
  visible.
- **The bot said «Продавці зараз не можуть продавати.»,** a reading nobody
  decided.
- **When the whole server is dead, or the shop has no internet,** the app
  does not open at all, and no drawer can be closed.

The owner decided on 2026-10-04 that the shop **sells on paper** and types
the sales in when the server answers. An offline mode may be judged later,
on real outages. So this is a modest change: texts, refusals that settle, a
mark on a late sale, and the phone checking its kept operations by itself.

The design raised 26 derived readings (G1–G26) and was reviewed through two
lenses, commands and the phone: 25 findings, each checked against the code.
Twelve readings were put to the owner on 2026-10-07, and **every answer was
the recommended one**:
- **G18:** a kept operation's paper line is marked «у телефоні — <ім’я>» and
  never typed until that phone says «не записано»; a lost phone's line goes
  to a manager, after checking «Звіт» for sales and returns and «Борги» for
  debt payments (2026-10-08: «Звіт» shows debt payments only as one sum);
- **G19:** cards are taken during an outage, charged at once, and the app
  then says not to charge them again (§5.6, §7);
- **G6:** the paper switch stays on for a series; the mode, the seller and
  the warehouse are on the pay buttons;
- **G21:** the paper records the warehouse, and the button names it;
- **G26:** the server back before 6:00: type the paper, then close;
  otherwise close the next evening;
- **G1:** the paper time is an hour, with «вчора»: today or yesterday only;
- **G2:** the mark is on sales only; *superseded on 2026-10-10: returns and
  debt payments carry it too ([ADR-0021](ADR-0021-outage-mark-on-returns-and-payments.md))*;
- **G22:** a kept sale recorded later carries no mark;
- **G24:** a refused late «Клієнт забрав» is typed as a paper sale at the
  order's prices, with the mark;
- **G23:** goods reserved for an order meanwhile: a manager cancels or
  changes the order;
- **G9:** a refused debt payment: take what is still owed and give the rest
  back, cash from the drawer, a card through the terminal, a transfer by
  transfer;
- **G25:** a debt payment taken in another store and refused: a manager
  decides each case.

The other fourteen (G3, G4, G5, G7, G8, G10–G17, G20) were not asked then.
They were built as recommended and listed in the business rules ("how it is
carried out"), and the owner confirmed all fourteen as built on 2026-10-08.
G14 and G20 are stated on the sellers' printed page, which is therefore no
longer a draft.

The review of the built change raised four more, answered on 2026-10-08,
each the recommended option:
- a lost phone's lines: sales and returns checked in «Звіт», debt payments
  in «Борги» (G18 above);
- a kept return the phone confirms by itself says, as for a card, not to
  give the money back a second time (§5.6, §8);
- a store blocked, or a warehouse closed, while a phone keeps an operation
  there holds that phone in that store until the store trades again or the
  warehouse reopens: a known risk, with no button to discard it (§1);
- the app that does not open at all: the seller checks the shop's internet,
  and with none tells a manager and sells on paper (§3).

## Decision

### 1. A refusal that proves nothing was written says so

- **The rule** (ADR-0008 §9, ADR-0012 §8, now for every command a seller
  sends): every refusal raised **after** a command's `command_id` was looked
  up under its lock, and found nothing, carries `details.recorded = false`.
  The lock and the lookup prove this command wrote nothing, and its
  transaction rolls back.
- **One context manager,** `nothing_recorded()`, moves from
  `catalog/corrections.py` to `app/core/errors.py`. `catalog/corrections.py`
  re-exports it, so catalogue intake and corrections are unchanged. Each
  command wraps **only the code after its lookup found nothing**, never the
  lookup itself, which refuses `IDEMPOTENCY_CONFLICT` for a command that may
  have recorded something.
- **Never on an identity refusal.** `nothing_recorded()` lets
  `IDEMPOTENCY_CONFLICT` and `IDEMPOTENCY_IN_PROGRESS` through untouched. A
  wrapped region can hold another command's lookup: «Клієнт забрав» runs the
  collected sale's own inside the order's, and what that lookup refuses
  proves nothing about what was recorded. It is reached only when one
  `command_id` is reused across journals, but the rule holds by
  construction.
- **Not on `InsufficientStockError` as a class.** The ledger raises it for
  transfers, adjustments, supplier returns and «Брак» too, not all of them
  after a lookup.

| Command | Now carries `recorded: false` | Unchanged, before the lookup |
|---|---|---|
| a sale (`sales.create_sale`) | a size to clarify; inside the stock lock, an inactive or unknown warehouse or size, a store no longer trading (`STORE_NOT_TRADING`), a merged or retired model; `RESERVED`; the shortage answers (`CORRECTION_EXCEEDS_SHORTFALL`, `SIZE_CLARIFIED`, `SIZE_NOT_KNOWN_SHORT`, `_AMBIGUOUS`, `_REPORTED`, `UNKNOWN_SIZE_STOCK`); `INSUFFICIENT_STOCK`; a sum out of range | no lines, permissions, currency, quantities, prices, the answers' shape, `NOTHING_TO_SELL`, stock access |
| the till's `POST /sales` | `PAID_IN_FULL` from opening the debt: reached only for a sale new in this transaction, so marked where it is raised | — |
| an empty shelf (`report_empty_shelf`) | the stock lock (`STORE_NOT_TRADING`, a merged model), `NOT_FOUND`, the ledger | the body's checks |
| a debt payment (`credit.pay`) | `STORE_NOT_TRADING`, `PAID_WHERE_SOLD`, `NOT_OWED`, `MORE_THAN_OWED` (the way's refusals already did) | `NOTHING_PAID`, an unknown debt, `sale:credit` |
| a write-off (`credit.write_off`) | `NOT_OWED` | the reason, the permission |
| an order (`create_order`, `transition_order`, `change_shipping`) | everything after the lookup: the reservation's `INSUFFICIENT_STOCK`, "Invalid order transition", `NO_DESTINATION`, the stock of a dispatch, a cancellation or a return, the collected sale and its debt | the action, the reason, the shapes of a credit, a way and a waybill; loading; authorization |
| a return (`refunds.create_refund`) | `NOT_FOUND`, a total out of range, and everything after (`REFUND_EXCEEDS_SOLD` already did) | `STORE_NOT_TRADING`, which stays before the lookup: a store blocked meanwhile refuses even the replay, through the scope |
| a delivery (`POST /receipts`) and a stock correction (`POST /adjustments`) | everything after `_permanent_answer` found nothing: inside the stock lock, an inactive warehouse and `STORE_NOT_TRADING`; `OPENING_LIST_PENDING`, `INSUFFICIENT_STOCK` | the body, access (a store that does not trade, a closed warehouse), the 7-day claim |

- **Deliveries and stock corrections are in the automatic check** (§4), and
  their journals hold the till. The wrap is in the API handler, after
  `_permanent_answer` answered nothing: a kept delivery refused there, for
  an opening list now waiting, say, settles the phone.
- **A store blocked, or a warehouse closed, before the resend is not
  settled** (owner, 2026-10-08: a known risk). Only a block or a closing
  that lands while the command runs reaches the wrap. A resend after it is
  refused before the lookup, for every command here: the scope, rebuilt on
  every request (invariant I13), answers `STORE_NOT_TRADING`, and a
  command's access to a closed warehouse answers `NOT_FOUND` («Unknown
  stock location»), with no `recorded`. Neither can carry it: that attempt
  may have been recorded.
  The phone keeps it, and that store's screens on that phone wait, until
  the store trades again or the warehouse reopens; the phone then checks it
  by itself when the app is next opened in that store, or at its button.
  Nothing is recorded twice or lost, and the phone works in other stores.
  There is no button to discard it (risk register).
- **`NOTHING_TO_SELL` stays before the lookup.** It is decided from the body
  alone, and the till never sends such a body: a basket with nothing on the
  shelf is sent as an empty shelf.
- **A debt payment's lock is the debt's row,** not the command. Two sends of
  one payment lock the same row, and the second sees the first's entry. A
  phone's attempt names one debt, so the proof holds.
- **The phone needs no change to settle:** the sale, shared and orders
  journals already clear an unknown attempt on `recorded: false`. Only the
  texts change (§3, §6, §8). A kept operation refused that way says so
  before why, so it never vanishes without a word: «Коригування не
  записано.» with the correction screen's own reason, the balances read
  again; «Приймання не записано.»; «Операцію «<назва>» не записано.» for an
  order's step; «Операцію каталогу не записано.» and «Зміну каталогу не
  записано.» (G17).

### 2. The server's own failures answer 503, not 500

A request that fails because the database does not answer, or because its
schema is behind this code, answers:

```
HTTP 503
X-Request-ID: <id>
{"code": "SERVER_UNAVAILABLE",
 "message": "Сервер тимчасово недоступний.",
 "details": {"reason": "DATABASE" | "SCHEMA"}}
```

The phone reads a 503 as unreachable, so the seller sees the paper text
(§3), and a journal keeps its attempt: a 503 is not definite.
- **`app/core/unavailable.py`** (core: the standard library and `sqlalchemy`
  only):
  - `database_unreachable(error)` walks the error, its `orig`, `__cause__`
    and `__context__`, five deep, and says yes for:
    - the pool giving up (`sqlalchemy.exc.TimeoutError`);
    - a refused or reset connection, a name that does not resolve, and the
      builtin `TimeoutError`. The asyncpg adapter does not translate errors
      at connect, so a dead database surfaces as these raw errors. A plain
      `OSError` (a file) is not one of them;
    - a `DBAPIError` with `connection_invalidated`;
    - an error whose `sqlstate` is of class `08` (connection) or `53`
      (insufficient resources: a full disk, too many connections), or is
      `57P01`–`57P03` (shutting down, starting up).
  - `schema_suspect(error)`: `sqlstate` `42P01`, `42703` or `42883`, an
    undefined table, column or function.
- **`app/api/unavailable.py`** (the API layer), `classify(error)`:
  `DATABASE` when the database is unreachable. When the schema is suspect,
  it asks the readiness check (`app.api.internal.database_state`) on a fresh
  session, and says `SCHEMA` only when that answers `behind`, `DATABASE`
  when `unreachable`, and nothing otherwise. **An undefined column with the
  schema at head is a code bug:** it stays `500 INTERNAL_ERROR`, with its
  number.
- **The middleware** (`CorrelationIdMiddleware`) takes `classify` from
  `create_app`. Before answering 500 it asks; with a reason, it answers the
  503 above with the request's id, writes one warning line,
  `request.unavailable`, with the reason and the error's type only (a
  connection error's text may name the host), and **does not re-raise**. An
  outage is the watcher's to tell (ADR-0011 §1), not Sentry's. Everything
  else keeps ADR-0011 §6.
- `/ready`, `/internal/status` and Caddy's bare 502 for a stopped API are
  unchanged.

### 3. What the seller is told

**The owner's text, exactly** (2026-10-04), as `UNREACHABLE` in
`shared/api.ts`:

> Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як
> оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.

- **When.** `api()` itself says which failures are the connection, so
  nothing downstream guesses from an error's class. It throws `Unreachable`
  for `fetch`'s own rejection (no network, a reset connection, the edge
  dead), for its 20-second abort (not a slow call's own timeout: §4.2), and
  for a 2xx whose body is not JSON (a captive portal, or an operator's page
  answering for the server).
  `unreachable(error)` is an `Unreachable`, or an answer 502, 503 or 504.
- **A bug is not an outage.** A `TypeError` from the app's own code (an old
  WebView without `crypto.randomUUID`, say) reads «Не вдалося виконати
  операцію. Спробуйте ще раз.», as does any other failure that is not an
  answer. A 500 keeps its number.
- **Where,** all through `errorText`, so no screen is missed:
  - sign-in: «Вхід через Telegram», the text, «Спробувати ще раз»;
  - the till's failed reads: the text and «Повторити завантаження»;
  - each kept operation's banner, when its last attempt went unanswered;
  - «Каса»: the drawer's read and its journal. When the drawer cannot be
    read, it adds the close (G26):
    > Касу зараз не закрити: сервер не відповідає. Перерахуйте гроші й
    > запишіть суму для себе. Якщо сервер відповість сьогодні — спершу
    > внесіть усе з паперу, потім закрийте касу; якщо ні — закриєте
    > наступного вечора.
  - the crash screen, while the phone knows the server is down: the text
    above «Перезапустити», and «Якщо сервер не відповідає, після
    перезапуску застосунок може не відкритися — продавайте на папері.»
    (G26);
  - «Брак», a seller's screen: the text, then its own «Повторне натискання
    безпечне.» (G13);
  - the page whose code never arrives: the text, as a second sentence under
    «Застосунок не завантажився. Перевірте зв’язок і відкрийте його ще
    раз.». A server dead whole shows nothing of birka's (owner, 2026-10-04):
    unchanged.
- **The owner's and managers' own "no answer, press again, it is safe"
  texts** stay (suppliers, invoices, the suggested price, «Початкові
  залишки»): they say what to do there (G13).
- **Who is told.** The bot knows only of the server's own failures (§10),
  not of one shop's internet. So the sellers' page says nobody need phone
  the owner only when the app shows «Сервер не відповідає». When the app
  does not open at all, the seller checks the shop's internet, and with
  none tells a manager and sells on paper meanwhile (owner, 2026-10-08).

### 4. The phone checks its kept operations by itself

No new tap anywhere.
1. **Queries never sit paused.** The query client sets `networkMode:
   "always"` and `refetchOnReconnect: true`, the second written out because
   `"always"` turns it off by default. A reload while the WebView says
   offline runs, fails and says the text of §3, instead of waiting
   silently. On the `online` event every stale query reloads by itself, the
   till's list and a failed sign-in included.
2. **The phone knows whether the server answers.** `shared/reach.ts` keeps
   `useReach { down, since }`. Every outcome of `api()` notes it: unreachable
   sets `down`, keeping `since` from the first; any other answer clears it.
   *Amended 2026-10-08 by ADR-0014 §16:* a call declared slow (creating a
   list from a file; adding a part, a file or typed lines; approving a
   list) waits 60 s, and its own timeout is not taken as the
   server being down. A fetch that fails outright still is.
3. **It checks when the server is back.** `useAutoCheck(checks)`. Each
   check's `run` is exactly the handler the banner's button calls: an
   identical resend.
   - **The probe.** While `down` and something waits: `GET /api/v1/ready`,
     without a token and with a 5-second timeout, 10 seconds after going
     down and then every 20; at once on the window's `online` event, and when
     the page becomes visible. Only a 200 whose body says `{"status":
     "ready"}` clears `down`; a captive portal's 200 does not. One request
     every 20 seconds per phone while something waits; only sign-in is
     rate-limited.
   - **When the server comes back:** on each change of `down` from true to
     false, by the probe or by any request that got an answer, every check
     that waits and is not busy runs **once**. A resend that gets no answer
     sets `down` again, and the next return runs it again: once per return,
     never in a loop. An answer while `down` is already false (a 500, say)
     runs nothing.
   - **When the app is opened again:** when a journal loads an attempt from
     disk, its check runs once, as soon as that journal is mounted. This is
     the common path, not an edge case: journals load only after sign-in and
     a store's tap, so a reopen (the app closed, the WebView killed by
     Telegram, «Перезапустити», a new launch after the 12-hour session)
     never sees `down` change (G12). It is an identical resend (ADR-0003),
     safe whether the server is back or not.
   - **Never a new command.** `run` resends the attempt on disk byte for
     byte, under its own key. A different basket is still refused.
   - **Which journals** (G11): the six whose banners the app draws (sale,
     delivery, return, debt payment, stock correction, orders), «Каса»'s,
     and the catalogue's: a seller creates and confirms models, and a kept
     catalogue operation holds every tab and the till. The owner's and
     managers' screens (models, stores, supplier returns, invoices) keep
     only their button.
4. **«Чекає з hh:mm» on the banner.** Each attempt gains an optional
   `since`, the phone's time when it was first put on disk, kept on every
   resend. It sits **beside** the body, never in it, so what is sent stays
   byte for byte the same; an attempt kept before this change has none. Each
   banner adds, `<ім’я>` being the phone's person:
   > Чекає відповіді сервера з 14:20. Запишіть цю операцію на папері з
   > позначкою «у телефоні — Олена» і не вносьте її з паперу: телефон
   > перевірить її сам. Вносьте з паперу, лише якщо застосунок скаже «не
   > записано».

   and the same without the first sentence when `since` is not known
   (owner, 2026-10-04: every sale of an outage stays on paper until the app
   shows it recorded).

**Why "do not type it"** (G18, owner 2026-10-07). A kept attempt and a paper
line typed later for the same sale are two commands, with two
`command_id`s. The server tells commands apart only by `command_id`, and
refuses only below zero. If a colleague types the paper line on another
phone and the kept attempt is then resent, by the button or by itself,
while a second unit is on the shelf, **two sales are recorded**: stock −2,
and the drawer expects twice what was counted. The same holds for a kept
debt payment while something is still owed, and a kept return while units
remain to return. Nothing on the server can tell the two apart; only the
paper's rule can.

### 5. The mark «продано під час збою»

1. **What it is** (owner, 2026-10-04). A sale typed from paper is an
   ordinary sale, dated when it is typed, with a mark. The mark may name
   **who sold**, a person of the store from a list, and **the time on the
   paper**; both are optional. It never changes the sale's `sold_at`, its
   day in «Звіт» or its drawer period. Who typed is the sale's seller, as
   for every sale.
2. **The request.** `POST /sales` takes an optional `outage:
   {sold_by_user_id, sold_at}`, each of which may be null, and nothing else
   in it.
   - Absent: an ordinary sale, exactly as before. `{}` or both null:
     marked, with nobody and no time named.
   - `sold_at` is the store's wall clock as written on paper,
     `YYYY-MM-DDTHH:MM`, with no offset. The phone fills the date: today, or
     yesterday (G1).
   - The request model checks **only** the shape, and that it is a real date
     and time. **The today-or-yesterday window and the future bound are
     never in the request model:** they depend on the server's clock, and a
     refusal before the lookup carries no `recorded` (below).
   - The 7-day print drops an absent `outage`, as it drops an absent way: a
     body without it keeps its print.
3. **The checks come after the lookup,** in `sales/outage.py`
   (`checked_mark`), after the way and before the stock lock, and only when
   `outage` is present. Each is `422 VALIDATION_ERROR` with `recorded:
   false`:

   | Reason | When | The phone says |
   |---|---|---|
   | `OUTAGE_SHELF_REPORT` | the body also answers the shelf: found, missing, or a size clarified (§6) | «Продаж з паперу не виправляє залишок. Попросіть менеджера спершу виправити залишок, потім внесіть продаж ще раз.» |
   | `OUTAGE_SELLER_UNKNOWN` | the person named is not among those who may be named (below) | «Цієї людини немає серед продавців магазину. Оберіть іншу або залиште «не вказано».» |
   | `OUTAGE_TIME_FUTURE` | the paper time, in the store's zone, is more than 5 minutes after the server's now (a tolerance for clocks) | «Цей час ще не настав. Перевірте час і день з паперу.» |
   | `OUTAGE_TIME_TOO_OLD` | its date, in the store's zone, is before yesterday (G1) | «Час з паперу можна вказати лише за сьогодні або вчора. Для давнішого продажу залиште час порожнім.» |

   The paper time is composed in the store's zone (`zoneinfo`, `fold=0`)
   and stored as a moment.
   - **Who may be named: one function for the check and the list** (G4).
     `authz.service.holders_in_store` lists the people with an active
     membership of **this** organization, for this store or for the whole
     network, whose role holds the permission. The organization filter is
     written out: a network-wide membership names no store in any
     organization, so without it another network's owner could be named, and
     printed on this network's receipt and «Звіт». `nameable_sellers` in
     `sales/outage.py` keeps those whose person is active, with their names:
     `authz` may not read people, and `sales` may, as `credit` does. The
     check and `GET /stores/{id}/sellers` both call it, so the list never
     offers a name the check refuses.
   - **After the lookup, and pinned there.** A marked sale recorded, its
     answer lost, and resent two days later or after the named seller left,
     must replay as recorded. Checked before the lookup, or in the request
     model, that resend would get a 422 without `recorded`, which is not
     definite for an unknown attempt, and every tab of that phone would stay
     held. Within 7 days the cache answers first, so the tests that pin this
     use a new key or a purged cache.
4. **Prints.** The permanent print gains `outage: {sold_by_user_id,
   sold_at}` only when a mark was sent, beside the way. Its `sold_at` is
   **the literal the body carried**, never the composed moment, so a print
   never depends on the store's zone. No mark, no key: every older print is
   unchanged. The same `command_id` resent with another mark, or without
   one, is another command: `IDEMPOTENCY_CONFLICT`. Before any print was
   touched, the prints of today's bodies **with** a way (a sale paid in
   cash, a sale in parts by card, a debt payment and a refund with a way)
   were computed on the unchanged code and pinned in
   `test_old_prints_are_pinned.py`, beside the older pins, which cover only
   bodies without a way.
5. **The schema: migration `0036_outage_mark`.**
   - `sale.during_outage` (not null, default false), `sale.outage_sold_by`
     (a person, `ON DELETE RESTRICT`) and `sale.outage_sold_at` (a moment),
     with a CHECK that the two details need the mark.
   - **The mark is never changed.** A new trigger, `sale_outage_guard`, with
     its function `birka_guard_outage_mark`, refuses any change to the three
     columns. It fires `BEFORE UPDATE OF` the three columns only: the API
     updates every new sale after its insert (its stored answer), and a
     plain `BEFORE UPDATE` would run a second trigger on every sale.
     `birka_guard_money_row` stays as `0035` shipped it.
   - The CHECK is added plainly: the migration runs in one transaction,
     where adding a column already holds the table's lock, and the server is
     updated while the shops are closed. A `NOT NULL DEFAULT false` column
     is metadata only on PostgreSQL 11 and later.
   - **The downgrade refuses** once any sale carries the mark: «0035 cannot
     hold the mark «продано під час збою»: N sales carry it. Keep this
     revision.»
   - **`0035` is frozen** in the same change.
6. **Where it shows.** One answer shape, `OutageMark {sold_by_user_id,
   sold_by, sold_at}`, `sold_by` being the person's name.
   - **The receipt** (`SaleResponse.outage`, built by the API and frozen in
     the stored answer): «Продано під час збою · продавець: Марина · за
     папером 06.10, 19:40».
   - **A marked receipt's money line** (G19). A card receipt usually says to
     charge the terminal, and a transfer's to check that it arrived before
     handing the goods over (ADR-0012 §13). A sale typed from paper was paid
     during the outage, and the customer is gone, so it says instead:
     - card: «Картка · Разом X — оплату провели під час збою, на терміналі
       не проводьте ще раз»;
     - transfer: «Переказ · Разом X — отримано під час збою, звірте з
       папером»;
     - cash: unchanged. Paid in parts: the same words on the part paid now.
   - **A kept card operation confirmed later** (a sale, the part paid now, a
     debt payment) may be confirmed by itself (§4) minutes or hours after
     the press, while the seller, following the paper text, may already have
     charged the terminal. It says: «Якщо картку ще не провели — проведіть на
     терміналі X. Якщо вже провели, поки сервер не відповідав, — не
     проводьте вдруге.» A confirmed marked sale also shows its mark and the
     marked money line.
   - **A kept return confirmed later** is the same case for money going out
     (owner, 2026-10-08): the seller, following the sellers' page, has
     usually given the money back during the outage. Under «Повернення
     оформлено» it says «Якщо гроші ще не повернули — <як повернути>. Якщо
     вже повернули, поки сервер не відповідав, — не повертайте вдруге.»,
     <як повернути> being the return's usual words by the way, such as
     «надішліть покупцю X переказом». A return answered at once keeps its
     usual words.
   - **The sales list** (`SaleSummary.outage`): the returns screen shows
     «Продано під час збою» beside «Оплата частинами». It carries no sum or
     way, so the blind count (ADR-0012 §5) is untouched.
   - **«Звіт»:** each entry gains `outage {sold_by, sold_at}`. **`by` stays
     the typist.** The entry reads «Продано під час збою · продавець: Марина
     · за папером 06.10, 19:40 · внесено: Оля». The figures are unchanged:
     the sale counts on the day it was typed.
   - **Not** in «Каса» or the bot's messages (G16).
7. **Who may.** Whoever may sell there (`sale:create`) types a marked sale;
   there is no new permission (owner: whoever can). `GET
   /api/v1/stores/{store_id}/sellers` answers `{"sellers": [{"user_id",
   "display_name"}]}`, sorted by name: exactly `nameable_sellers`. It needs
   `sale:create` in that store, so a blocked store gives nothing.

### 6. A late sale whose goods are gone

**Refused; a manager fixes the balance first, then the sale is typed**
(owner, 2026-10-04). A marked sale's `INSUFFICIENT_STOCK`, now `recorded:
false`, is final.
- **Enforced on the server for a marked sale,** the only one the server can
  tell. A paper sale typed without the mark is an ordinary sale, and its
  shortfall gets the ordinary offers (§7, G20).
  - A marked sale that answers the shelf is refused `OUTAGE_SHELF_REPORT`
    (§5). Each of those answers states the shelf, or the coat in hand,
    **now**; at typing time nobody stands at it, and «Товар на місці» would
    record a found unit that never was.
  - A marked sale's `INSUFFICIENT_STOCK` says `correctable: false`: the
    answer itself says no correction is offered.
- **Reserved units stay visible.** `correctable` used to be the only sign
  that a shortfall is a reservation. So every `INSUFFICIENT_STOCK` gains
  `reserved` (true when the key holds units reserved for an order), set by
  the ledger before any override. In paper mode, `reserved: true` reads
  (G23, owner 2026-10-07):
  > Частина цих одиниць у резерві замовлення — продаж з паперу не записано.
  > Менеджер має вирішити із замовленням, потім внесіть цей продаж ще раз.
  > Кошик збережено — нічого не продано.

  and not the text below, whose "fix the balance" would let a manager add a
  unit that the order then takes as well.
- **Otherwise the till says:**
  > Цього товару вже немає в обліку — продаж з паперу не записано.
  > Попросіть менеджера спершу виправити залишок, потім внесіть цей продаж
  > ще раз. Кошик збережено — нічого не продано.
- **The empty shelf is only hidden on the phone.** `POST /shelf-shortages`
  carries no mark, and the till never offers it in paper mode: an empty
  shelf is reported only while standing at it (owner, 2026-10-04).
- **A sale paid in parts may be marked** like any other: the paper carries
  the customer's name and phone and the part paid (G14).

### 7. The till's paper mode

No tap is added to a normal sale.
- **A switch,** «Вношу продаж з паперу», quiet, at the top of the till.
  **Off by default:** a normal sale is still 5 taps, and its body has no
  `outage`.
- **On,** it shows:
  - a coloured band, «Режим: продаж з паперу», and «Продаж позначать
    «продано під час збою». Він увійде в сьогоднішні продажі й у касу до
    наступного закриття.» (the owner's wording of 2026-10-15, В5: a seller
    does not see «Звіт»; it read «…в сьогоднішній «Звіт» і в касу…»);
  - «Хто продав»: «Не вказано» and the store's sellers (§5.7), read only
    while the switch is on;
  - «Час з паперу», optional, and with a time «Це було вчора» (G1);
  - no «Розмір з етикетки»; instead, «Товар з невідомим розміром вносьте як
    «розмір невідомий».» (G3; the owner's wording of 2026-10-15, В5: «без
    розміру» read as a coat that has no size);
  - **the mode on the pay buttons** (G6, owner 2026-10-07): «З паперу ·
    Готівка», «З паперу · Картка», «З паперу · Переказ», and under them
    «Продавець: Марина · склад: Спільний», or «Продавець: не вказано». The
    warehouse matters in a store that sells from two (G21). The hint above
    them becomes «Оплату взяли під час збою: натисніть, як оплатили. На
    терміналі нічого не проводьте.» (G19);
  - on a refusal for stock, the text of §6 or its reserved variant, and
    none of «Товар на місці — продати», «На полиці немає жодної…», «На місці
    фактично є», «Це товар без розміру — продати як…».
- **The mode is tied to the basket** (G20). The server refuses the shelf
  answers only for a marked body (§6), and a refused basket stays on the
  till. Resent without the mark, it would get `INSUFFICIENT_STOCK` with
  `correctable: true`, and so «Товар на місці — продати», recording a found
  unit that never was: what the owner rejected. So:
  - **unticking** the switch while the basket has lines clears the basket,
    its answers and its `command_id`;
  - **ticking** it keeps the lines, and clears any shelf answer already
    given;
  - a basket built without the switch from the start cannot be told from a
    live sale. The sellers' page says to switch it on always, and the risk
    register names it.
- **A series.** The switch and «Хто продав» live in memory, per store
  (`sales/paper.ts`), so they survive a tab change and the till's remount
  after a kept sale settles. They clear when the seller unticks the switch,
  when the store changes, and on reload: nothing is on disk, and a reload
  partway through a series shows the band gone before the next press. **A
  wrong mark is permanent** (§5), which is why the mode and the name are on
  the very button that sells (G6).
- **The paper time clears after each sale, explicitly.** The till is not
  remounted after an ordinary sale, so «Час з паперу» and «Це було вчора»
  are cleared when a sale is recorded, beside the new `command_id`. Left
  alone, they would carry into the next paper sale, for good.
- **The body.** The sale's attempt gains `outage?: {sold_by_user_id,
  sold_at}`, checked on load like its other fields, and absent on every
  ordinary sale. The phone builds `sold_at` from its own date and the typed
  time.

### 8. Debts, returns and orders typed later

- *Since 2026-10-10 a return and a debt payment typed from paper carry the
  mark, and their screens say the money was already handed over
  ([ADR-0021](ADR-0021-outage-mark-on-returns-and-payments.md)); what
  follows was written before.*
- **Typed as ordinary operations,** dated when typed, in the drawer period
  open then, **with no mark** (G2, owner 2026-10-07). Their screens cannot
  tell a paper operation from a live one, so a return «На картку» still says
  to pay back through the terminal; the sellers' page says not to do the
  money step twice (G19). A kept return the phone confirms later says so
  itself (§5.6, owner 2026-10-08).
- **A late debt payment refused,** `NOT_OWED` or `MORE_THAN_OWED`, now
  `recorded: false`, stays refused (owner, 2026-10-04). «Борги» says, by the
  way pressed (G9, G19):
  - `NOT_OWED`, cash: «За цим продажем уже нічого не винні — внесок не
    записано. Якщо гроші вже взяли, поверніть їх покупцю. Поки не повернули,
    вони зайві в касі: при закритті вкажіть причину.»
  - `NOT_OWED`, card or transfer: «За цим продажем уже нічого не винні —
    внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю <як>.
    На касу це не впливає.», <як> being «на картку через термінал» for a
    card and «переказом» for a transfer.
  - `MORE_THAN_OWED`: «Це більше, ніж винні: залишок боргу 300,00 грн.
    Прийміть 300,00 грн, а решту поверніть покупцю.», and the same way by
    way: «…поверніть покупцю на картку через термінал» for a card,
    «…поверніть покупцю переказом» for a transfer.
  - **Each goes back the way it came** (G9): a card is never offered a
    transfer, nor a transfer the terminal.
- **The same texts reach a kept payment.** A kept payment refused on resend
  read the shared text, which for a 422 `NOT_OWED` was an order's
  («Перевірте дані та поточний статус замовлення.»). «Борги» and
  «Повернення» now export their `refusalText`: a kept payment's refusal
  reads «Внесок не записано.» and «Борги»'s reason (for `NOT_OWED`, whose
  text already says «внесок не записано», «Борги»'s text alone), and a kept
  return's reads «Повернення»'s own, so `REFUND_EXCEEDS_SOLD` no longer
  reads as a 409 about orders.
- **The drawer** (G9, owner 2026-10-07): cash given back before the close
  shows nothing. Not given back by the close: a surplus with a reason; given
  back later, the next close shows the mirror shortage with its reason. A
  card or transfer payment is not the drawer's: a card goes back through the
  terminal, a transfer by transfer. No "overpayment" state, and no new kind of cash
  movement.
- **A kept sale refused on resend** (G15). Its customer has usually left
  with the goods. **Every** refusal that proves nothing was recorded reads,
  with the reason from the till's own `refusalText`:
  > Продаж не записано (<причина>). Якщо товар віддали покупцю — внесіть
  > його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати
  > знову.

  For `INSUFFICIENT_STOCK` the reason is «цього товару вже немає в обліку —
  спершу попросіть менеджера виправити залишок».
- **A kept sale recorded when the server answers** is an ordinary sale,
  dated on arrival, sold by the phone's person, with **no mark** (G22, owner
  2026-10-07): its body is frozen once its answer is unknown, and the mark
  is part of its print.
- **A late «Клієнт забрав»** after another phone cancelled or returned the
  order is refused "Invalid order transition", now `recorded: false`, and
  settles the orders' journal. The goods are with the customer, the ledger
  has them back on the shelf or no longer reserved, and the money is in the
  drawer. The orders' text says (G24, owner 2026-10-07): «Замовлення вже
  скасовано або повернено — «Клієнт забрав» не записано. Якщо товар віддали
  — внесіть його як продаж з паперу, за цінами замовлення.»
- **A late debt payment refused `PAID_WHERE_SOLD`:** taken on paper in
  another store while the selling store was blocked, and typed after it
  reopened. The money is in the other store's drawer, and the customer still
  owes. «Борги» says (G25, owner 2026-10-07): «Магазин, де продали, знову
  працює — внесок приймає він. Передайте папір менеджеру.»

### 9. «Каса»

- **Nothing changes in how a drawer is closed** (owner, 2026-10-04): there
  is no close while the server does not answer. «Каса» shows the text of §3
  and the close's instruction (G26). A count kept and resent more than 10
  minutes late is refused `COUNT_IS_STALE`; the day rolls into the next
  close, and shows as not closed.
- **The close form reminds** (owner, 2026-10-04), always (G7), beside «Поки
  рахуєте, не продавайте.»:
  > Якщо сервер не відповідав — спершу внесіть усе, що записали на папері,
  > потім рахуйте касу.
- **Two quick reasons** under «Чому не збігається?» (G8): «Продаж під час
  збою», the owner's words, and «Повернення чи внесок під час збою». Each
  fills the field, which can still be edited. The reason stays free text
  (ADR-0012 §5).
- **The pair stands** (owner, 2026-10-04). A cash sale of the outage typed
  after that day's close is in the next period by commit order (ADR-0012
  §3): +X on one close and −X on the next, each with its reason. A cash debt
  payment gives the same pair; a cash return the mirrored one. Nothing names
  a sale for an earlier close.
- «Каса»'s kept operation has the banner line of §4 and the automatic check.

### 10. The bot

Not asked at first (G10); built as recommended, and confirmed by the owner
on 2026-10-08, in `backups/incidents.py`:
- the app not answering: «Продавці продають на папері.» replaces «Продавці
  зараз не можуть продавати.»;
- nobody signs in: «Хто ще не увійшов, продає на папері.»;
- the app answering again: «Сервер знову відповідає: продажі з паперу можна
  вносити.»

So the start reads «⚠️ Сервер застосунку не відповідає. Продавці продають на
папері.», and the end «✅ Сервер знову відповідає: продажі з паперу можна
вносити. Тривало 12 хв.». No phone sends a note of its own. The outside
check-in is set up before launch (server runbook, step 8a; release
checklist, row 16).

### 11. Modules, contracts, the hot path

- **No new module** (ADR-0001 unchanged). New files:
  - `app/core/unavailable.py`, core: the standard library and `sqlalchemy`
    only;
  - `app/api/unavailable.py`, the API layer;
  - `app/modules/sales/outage.py`: the mark, its print, `checked_mark` and
    `nameable_sellers`. It imports core, `authz.service`, `identity.models`
    (as `credit` does) and `tenancy.models`.
  - `authz/service.py` gains `holders_in_store`, which reads memberships
    and roles only, so the layers `identity → authz → tenancy` hold.
- **Contracts tightened, none added** (31 stay 31): `app.modules.sales.outage`
  joins the forbidden lists of "a report only reads" and "the drawer counts
  money and moves no goods". The report and the drawer read the columns,
  never the command's check.
- **The hot path.** An ordinary `POST /sales` gains one optional field read
  as nothing, one `if` and a `try` that costs nothing unless something is
  raised, and **no extra statement**: 37 per sale before and after. Its
  INSERT writes NULL for the mark's two details, and the database defaults
  `during_outage`. **No new plpgsql trigger runs:** the guard fires only on
  an update of its own columns, and the update after the insert names only
  the stored answer. The new foreign key on `outage_sold_by` adds one
  internal check per insert, a no-op for NULL.
- **Taken again on 2026-10-08.** The release reading (release checklist,
  row 22), three runs on fresh databases on the laptop: every case passes,
  worst p95 93.9 ms against 500, one seller about 11 ms. A sale is still 5
  taps, the switch being off by default (§7; row 10).

### 12. Compatibility and going back

- **Attempts kept before this change** have no `since` and no `outage`.
  They load, show the banner without the time, are checked once on load
  (§4), and are resent byte for byte. Their prints are unchanged (§5).
- **A page of the previous version left open** sends no mark and shows the
  old texts. Its kept sale refused on resend now settles too (§1). Nothing
  breaks; reopen the app after the deploy, as always.
- **Going back by the code alone across `0036` is safe.** The old code
  inserts sales without the columns, which take their defaults, and reads
  around them. A new page's marked sale sent to the old code is refused by
  its forbidden extra field (422, definite on a first send): the basket
  stays, and nothing is sold. One narrow case holds a phone: a marked sale
  recorded by the new code whose answer was lost, and resent to the old, is
  refused before its lookup, and stays kept until the server is upgraded
  again.
- **The downgrade of `0036` refuses** once a marked sale exists.

## Rejected

- **An offline mode,** the phone recording several sales and sending them
  later: the owner chose paper. It would reopen the page that is never
  cached (ADR-0010 §4) and the drawer's commit order (ADR-0012 §3), with
  stale stock and conflict screens, before a shop has run one day. It may be
  judged later, on real outages (backlog).
- **A "sold on" date that moves the day or the drawer:** a past day's report
  would change, and «Каса» and «Звіт» would disagree.
- **Naming a late sale for an earlier close:** the owner rejected it.
- **Selling a late sale through «Товар на місці», «фізично відсутній» or a
  new movement reason:** the owner chose a refusal and a manager's fix.
- **A cached page or a service worker:** the owner chose no app without the
  server, which keeps updates safe.
- **`recorded: false` on `InsufficientStockError` as a class:** it is raised
  by commands that do not all look themselves up first (§1).
- **Every `42xxx` SQL error as a 503:** a code bug would hide behind "sell on
  paper". Only a schema the readiness check calls behind (§2).
- **Re-raising the 503 to Sentry:** an outage is told by the watcher; a
  report for each failed request would flood it.
- **Retries inside `api()`, or on a timer whatever the server's state:** a
  broken endpoint would be hammered, and the journals already own resending.
  Only an identical resend, on a return the phone saw or when a journal
  loads (§4).
- **Checking only on a return the open page saw** (the design's first
  revision): journals load only after sign-in and a store's tap, so after
  any reopen, the common path in a Telegram Mini App, nothing would be
  checked by itself, against the owner's rule. The check on load is an
  identical resend.
- **Refusing on the server an unmarked paper sale's shelf answers:** the
  server cannot tell an unmarked paper sale from a live one (§6, G20).
- **A stock list of unknown age shown while the server is down:** with paper
  chosen, it invites selling against it.
- **A note from each phone after it reconnects:** recommended against, and
  not asked (G10, confirmed as built on 2026-10-08); the error notes are
  themselves lost while the server is down.
- **A table for the mark:** one row per sale. Columns keep the receipt, the
  list and the report free of joins.
- **Refusing the empty shelf on the server for a marked sale:** that command
  carries no mark (§6).
- **A permission for typing paper sales:** the owner: whoever can.
- **A switch that clears after each sale:** a series of paper sales would
  cost a tap each. The mode and the name on the pay buttons guard a
  forgotten switch instead (G6).
- **`NOT VALID`, then `VALIDATE`, for the mark's CHECK:** the migration's one
  transaction already holds the table's lock from adding the column (§5).
- **An "overpayment" state, or a cash movement «Повернуто покупцю»:** the
  owner chose the refusal and the surplus with a reason (G9).

## Consequences

- **The sellers' page,** [`paper-when-the-server-is-down.md`](../project-memory/paper-when-the-server-is-down.md),
  was confirmed by the owner on 2026-10-08 (G14, G20). The owner hands it to
  the shops (release checklist, row 25).
- **A kept operation and its paper line can both be recorded** if someone
  types the line anyway: only the paper's rule prevents it (risk register).
- **A paper sale typed without the switch** gets the ordinary offers, and
  «Товар на місці» would record a unit that never was (risk register).
- **The mark is the typist's word, and permanent** (G5, G6).
- **A card may be charged twice** by a seller who follows a terminal prompt;
  the texts say not to, and nothing can check it (risk register). The money
  of a kept return confirmed later may likewise be given back twice (§5.6).
- **A store blocked, or a warehouse closed, while a phone keeps an operation
  there** holds that phone in that store until the store trades or the
  warehouse reopens (§1, risk register).
- **The outage is untried on a real phone in Telegram.** What its WebView
  shows, and whether it says it is offline, is unmeasured: the drill is in
  the release checklist.
- **A server dead whole leaves no app** (owner, 2026-10-04). The shops sell
  on paper, and nothing tells the owner until the outside check-in is set
  up (ADR-0011 §3). Nothing tells anyone of one shop's own internet: the
  seller tells a manager (§3).
- **The release reading was taken again** (release checklist, row 22): the
  mark costs nothing one can see. A sale is still 5 taps (row 10).
- **The readings left unasked at first** were built as recommended, and the
  owner confirmed them as built on 2026-10-08 (business rules, "how it is
  carried out").
