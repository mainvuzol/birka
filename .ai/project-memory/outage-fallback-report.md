# The server is unreachable — 2026-10-08

Baseline: `73c94b9` (cash and card, merged as PR #68).
Status: implemented and verified locally.
Migration `0036`.
Branch: `feat/outage-fallback`, after `3b081a0` (the owner's rules of
2026-10-04) and `92040af` (the answers of 2026-10-07).
Design: [ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md).

## Why this was next

With PR #68 merged, the owner chose what happens when the server does not
answer. Until then:
- a phone stopped selling after one unanswered sale, and nothing said what
  to do with the customer;
- a database that did not answer read as a server error with a number;
- a kept sale refused on resend never settled, and pressed days later it
  could sell, dated that day;
- the phone never noticed the server was back;
- the bot said «Продавці зараз не можуть продавати.».

The owner answered on 2026-10-04 (business rules, "the server is
unreachable"):
- **the shop sells on paper** (model, size, price, how it was paid, the
  time), and types it in when the server answers; an offline mode may be
  judged later, on real outages;
- **whoever can types it, whenever they can;**
- **a late sale is dated the day it is typed,** with the mark «продано під
  час збою», which may name who sold and the paper's hour;
- **goods already gone are refused** until a manager fixes the balance; an
  empty shelf is reported only while standing at it;
- **the drawer is not closed while the server is down,** and a sale typed
  after the close leaves a pair, both with their reason;
- **debts, returns and orders go on paper too;** a refused debt payment
  stays refused, and the money goes back;
- **the seller's text,** without phoning the owner;
- **a kept operation is checked by the phone itself;**
- **no app without the server.**

The design's derived readings, reviewed through two lenses, were put to the
owner on 2026-10-07: twelve answers, each the recommended one (business
rules, "what the 2026-10-04 answers left open"). Fourteen were not asked
then, and were built as recommended ("how it is carried out"); the owner
confirmed all fourteen as built on 2026-10-08. The review of the
built change raised four more, answered on 2026-10-08 in the same section:
a lost phone's lines are checked in «Звіт» and «Борги»; a kept return
confirmed by the phone says not to give the money back twice; a store
blocked or a warehouse closed while a phone keeps an operation there holds
that phone in that store, a known risk; and when the app does not open at
all, the seller checks the shop's internet and tells a manager.

## What exists now

**What the seller is told** (ADR-0013 §3).
- Sign-in, the till, the kept operations' banners, «Каса», «Брак», the crash
  screen and the page whose code never arrives say «Сервер не відповідає.
  Продавайте на папері…» on no answer, a timeout, a 502, 503 or 504.
- A fault in the app's own code reads «Не вдалося виконати операцію.
  Спробуйте ще раз.», never the paper text.

**The server** (§1, §2, §10).
- Every refusal decided after a seller's command was looked up says
  `recorded: false`: sales, empty shelves, debt payments and write-offs,
  orders, returns, deliveries and stock corrections. An identity refusal
  never does (`nothing_recorded()`, `app/core/errors.py`). A resend after
  its store was blocked, or its warehouse closed, is refused before the
  lookup and does not say it (owner, 2026-10-08: a known risk).
- A database that does not answer, or a schema behind the code, answers
  `503 SERVER_UNAVAILABLE` with `DATABASE` or `SCHEMA`, logged once and not
  re-raised.
- The bot says «Продавці продають на папері.», and when the server answers
  again «продажі з паперу можна вносити».
- Every `INSUFFICIENT_STOCK` says whether units are `reserved`, transfers'
  included.

**The phone checks its kept operations by itself** (§4).
- Queries never sit paused when the WebView says it is offline.
- While something waits, the phone asks `/api/v1/ready` every 20 seconds.
  It resends each kept operation once when the server answers again, and
  once when the app is opened with it: the same command, byte for byte.
- Each banner says «Чекає відповіді сервера з hh:mm» and to write the
  operation on paper «у телефоні — <ім’я>» without typing it in.

**A sale typed from paper** (§5–§7).
- «Вношу продаж з паперу» at the till, off by default: a band, «Хто
  продав», «Час з паперу» and «Це було вчора», and the pay buttons «З
  паперу · Готівка/Картка/Переказ» naming the seller and the warehouse.
- `POST /sales` takes `outage: {sold_by_user_id, sold_at}`; its checks come
  after the lookup (`OUTAGE_SHELF_REPORT`, `OUTAGE_SELLER_UNKNOWN`,
  `OUTAGE_TIME_FUTURE`, `OUTAGE_TIME_TOO_OLD`). `GET
  /stores/{id}/sellers` lists who may be named.
- The mark shows on the receipt, in the sales list and in «Звіт», where `by`
  stays the typist. A marked card receipt says not to charge the terminal
  again; a marked transfer's, to check it against the paper.
- A marked sale's `INSUFFICIENT_STOCK` offers no correction.
- Migration `0036`: three columns on `sale`, a foreign key to the person, a
  CHECK, and a guard that refuses any change to the mark. `0035` frozen.

**Debts, returns, orders and «Каса»** (§8, §9).
- «Борги» says what to do with the money of a refused payment, by the way it
  was paid, each way back alone (G9): a card «на картку через термінал», a
  transfer «переказом». A kept payment's and a kept return's refusals use
  the same texts.
- A kept return the phone confirms by itself says «Якщо гроші ще не
  повернули — …» and not to give the money back a second time (owner,
  2026-10-08).
- A kept sale refused on resend says it was not recorded, and to type it
  from paper if the goods left.
- A late «Клієнт забрав» refused because the order was cancelled or
  returned says to type the goods as a paper sale at the order's prices.
- The close form reminds to type the paper first; two quick reasons,
  «Продаж під час збою» and «Повернення чи внесок під час збою».

## Evidence

**Backend: 2589 passed, 1 skipped** (baseline 2462 passed, 1 skipped), on
a fresh test database.
- New test files:
  - integration: `test_refusals_record_nothing.py`,
    `test_sale_refusals_record_nothing.py`, `test_server_unavailable.py`,
    `test_outage_mark.py`;
  - unit: `test_nothing_recorded.py`, `test_unavailable.py`.
- Changed:
  - `test_old_prints_are_pinned.py`: today's prints with a way pinned
    first, computed at `3b081a0`, then the marked sale's;
  - `test_migration_history_is_frozen.py` (`0035` frozen);
  - the bot's texts: `test_server_incidents.py` (unit and integration),
    `test_server_watch.py`;
  - `recorded: false`, `reserved` or `outage` in exact answers:
    `test_adjustment_screen_contract.py`, `test_customer_credit.py`,
    `test_snapshot_import.py`, `test_sale_retry_contract.py`,
    `test_payment_method_commands.py`, `test_payment_method.py`;
  - `test_sales_report.py` (the mark in «Звіт»);
  - `test_transfer_command.py` (transfers' `reserved`).
- After the review: the four new tests of a correctly named or typed time
  in the store's day, a report entry naming nobody, a refusal said
  `CARRIER`, and every command resent after its store was blocked claiming
  nothing (independent mutation testing, below).

**E2E: 182 → 239, all passing on a fresh database.**
`e2e/outage.spec.ts` (56 journeys) covers:
1. the paper text at sign-in, in the till and in «Каса», and not for a code
   error;
2. a kept sale checked by itself once the server is back (2b once per
   return, 2c on reopen, 2d a kept card sale);
3. a kept sale refused on stock settles the phone;
4. an offline WebView never pauses «Повторити»;
5. a normal sale is untouched;
6. a sale typed from paper carries the mark;
7. a paper sale refused on stock offers no way around (7b unticking clears
   the basket);
8. the mark in «Звіт», against the real API;
9. «Каса»'s reminder and quick reason; «Борги»'s texts, a kept payment
   included.

Beyond the design's plan: a late «Клієнт забрав» after a cancellation, and,
against the real API, a kept sale refused for goods gone settling the
phone. `failures.spec.ts` adds the crash screen while the server is down
and the paper text on the page that did not load.

Changed specs (a kept attempt is now checked on load, and the new texts):
`cash`, `catalog`, `credits`, `failures`, `models`, `orders`, `session`,
`size`; after the review, also `returns` (a live return is never hedged)
and `order-shipping` (a reopened phone now checks a kept order step by
itself, which a tap on «Повторити» raced).
Section 10 of `outage.spec.ts` covers what a kept operation settled by the
phone says: a stock correction, an order step, a return confirmed or
refused, and «Борги» by way.

**Gates,** all run again after the review's fixes: ruff, format, mypy (138
files); `alembic check`; `0036` round trip with `0035` frozen; the
frontend's typecheck, lint, build (no chunk over 500 kB) and format.
31 import contracts, as before: `app.modules.sales.outage` joins two
forbidden lists, and no contract is added.

**The edge, on Docker** (Docker Desktop 29.8.1, Compose v5.5.1, the
isolated compose project with Caddy on other ports), at `826f3d5`, since
GitHub did not start PR #69's jobs (an account billing hold). CI's `edge`
job's steps ran as written, and every step passed: the Caddyfile validated;
only Caddy publishes a port; the images built and the stack started,
migrating to `0036` in the production image; the API ready behind Caddy,
healthy to Docker, its internals kept in; the headers; sign-ins counted per
real address; no query string in Caddy's log; a republish keeping the
previous bundle. Evidence:
[`output/verification/2026-10-08-edge/`](../../output/verification/2026-10-08-edge/).

**The hot path's release reading** (checklist row 22), taken again: three
runs on fresh databases, every case gated, all 8 pass every run; worst p95
93.9 ms against 500, one seller about 11 ms. Main's own code, read
alternately with the branch on the same laptop, is indistinguishable
([hot path report](hot-path-budget-report.md#update--2026-10-08-the-mark-of-a-sale-typed-from-paper)).
An ordinary sale sends the same 37 statements as before; its INSERT writes NULL for the mark's two details, and the new
foreign key adds one internal check per insert, a no-op for NULL (ADR-0013
§11).

**Taps** (checklist row 10), recounted on the built till:
- a sale: still 5. «Вношу продаж з паперу» is off by default and asks
  nothing until ticked, and the sellers' list is read only once it is;
- a sale typed from paper: 6 for the first of a series (the switch), then
  5, since the switch and «Хто продав» stay on; naming who sold adds 2 once,
  and a time from paper is typed.

**Built by three builders and a docs builder,** each on its own files and
its own test database, after two preparation steps (`nothing_recorded()`
moved to core; today's prints with a way pinned): the refusals, the 503 and
the bot; the mark; the phone; the docs. The join fixed three gaps:
- transfers' `INSUFFICIENT_STOCK` had no `reserved`, the only one of five
  raise sites without it; it now has it, with a test of a unit held for an
  order;
- the frontend's types did not name the answers' new `outage`, so the sales
  list and «Звіт» read it untyped;
- an E2E stub kept the bot's old reason.

**Mutation testing,** by the builders, every mutant caught:

| # | Mutant | Result |
|---|---|---|
| M1–M4 | the `nothing_recorded()` wraps removed or moved above the lookup; `PAID_IN_FULL` unmarked | caught: M1, M2 by the sale's tests; M3 for each wrapped command, and M4 |
| M5–M8 | the 503: any `OSError`, no pool timeout, `SCHEMA` without asking, re-raised | caught |
| M9–M11, M26 | the prints and the time: `outage` always printed, kept in the 7-day print, `sold_at` from paper, the composed moment printed | caught |
| M12, M13, M23, M24 | who may be named: store only, no check, no organization filter, inactive people | caught, each by its own test |
| M14, M15, M20, M21 | the time bounds, the shelf refusal, the checks before the lookup or in the request model | caught |
| M16, M17, M27 | `correctable`, «Звіт»'s `by`, `reserved` | caught |
| M18, M19, M22, M25 | the guard and the downgrade, the bot's text, every refusal stamped, the guard on every update | caught; M18 and M25 on a scratch database, the migration mutated for seconds |
| F1–F14 | the phone: 503 not unreachable, paused queries, no reconnect reload, a check on every answer, a new key, the switch on by default, the offers in paper mode, `since` rewritten, the time not cleared, unticking keeps the basket, no check on load, `instanceof TypeError`, any 200 from the probe, «Борги»'s texts missing, a bare terminal prompt | caught; F3 only after journey 2b was made stronger, F4 and F10 after the mutant itself was corrected |

Also caught: the preparation's own (M22b and M22c on the wrap; P1–P4 on
the prints with a way), and the join's transfer `reserved` removed (2 tests
red).

**Review:** four lenses (commands; the phone; rules and docs; compatibility
and the hot path), each finding checked again: 11 findings, 10 confirmed and
1 plausible, the kept return found by two lenses. The owner answered four on
2026-10-08. All fixed:
- **A kept stock correction refused on its resend vanished** without a
  word, so a stocktake could be lost silently (medium). It now says
  «Коригування не записано. <причина>». The same audit made a kept
  delivery, order step, catalogue operation and «Моделі» change say what
  was not recorded before why.
- **A kept return confirmed by the phone itself said to give the money
  back** (medium, two lenses), hours after it most likely was. It now says
  so only if nobody did (owner, 2026-10-08).
- **A lost phone's lines were checked in «Звіт» alone,** which shows debt
  payments only as a sum (medium): payments are checked in «Борги» (owner,
  2026-10-08).
- **«Борги» offered a way back the owner had not decided** (low): a card
  goes back to the card, a transfer by transfer.
- **The ADR, a comment and three test docstrings said a store blocked
  before the resend settles the phone** (low): it is refused before the
  lookup and the phone keeps it, which the owner accepted on 2026-10-08.
- **The sellers' page promised the bot had told** even when only the shop's
  internet is down (low): the seller checks it and tells a manager (owner,
  2026-10-08). The runbook's `curl -fsS` hid the 503's reason (low), and
  the hot path's wording and stale counts were corrected (low).

**Independent mutation testing** after the fixes, by two testers who had
not built the code:
- backend: 59 new mutants. 32 caught by the existing tests, 20 were gaps,
  each now caught by a new test, and 7 are equivalent. The largest gap:
  nothing pinned that a command resent after its store was blocked never
  says `recorded: false`; one test now resends ten commands after a block;
- frontend: 35 new mutants. 9 caught, 24 were gaps, each now caught by a new
  or stronger journey in `outage.spec.ts` (37 → 56), and 2 are equivalent.

**Fixed afterwards, each in its own commit on this branch,** found while
checking this work: what a screen says outlived the command it answered.
- **«Каса» named a refused command wrongly** after another tab was opened
  (since PR #68): «Підрахунок не записано.» for a refused take-out or fix of
  a way. The name now lives beside the journal. Another store whose kept
  cash command cannot be read no longer shows the previous store's refusal.
- **The catalogue's similar-name refusal outlived its form.** It showed over
  the queue after a tab switch, on an emptied form, and on another
  proposal's form, where «Це інша назва — створити як є» would have created
  that proposal's name unchecked. A refusal now answers only its own
  proposal and the exact words sent, and «Це інша назва» is offered only
  while the form still holds them. A kept refusal still survives a tab
  switch, as ADR-0013 §1 needs.
- **A kept return the phone confirms by itself named the warehouse it was
  sold from,** even when the seller had put the goods into one of this
  store's warehouses. It now names the warehouse from the server's answer,
  or «склад вашого магазину» when its name cannot be read. «Повернення»
  also opens afresh once a kept return settles, as the till does after a
  kept sale: its form kept the return's command, and pressed again it was
  answered once more with the plain «Поверніть покупцю …». The stock and
  «Брак» lists are read again, as after a live return.

Each was reviewed (an attacker and a skeptic), and each journey added
fails on the code before its fix (seen by putting it back). E2E: 239 → 249.
Still open from them: a return that sends one line back where it was sold
and another into a chosen warehouse names only the chosen one, as the live
text already did; a kept similar-name refusal still says «Візьміть її або
підтвердьте, що це інша» after the words were changed.

## Where the build departs from the design

- **The 503's log line** also names the method and the path (never the
  query), as the unhandled-error line does. `classify` decides nothing when
  no engine is set up or its check fails: the request stays a 500.
- **"Everything after the lookup"** also covers a few shape refusals: an
  order with no carrier, `NO_DESTINATION`, `ORDER_CLOSED`, and the stock
  correction's `STOCK_CHANGED`. Each proves nothing was recorded.
- **`NOTHING_PAID`** cannot be reached through the API (the request refuses
  0 first), so it is tested at the service. The bot's "sign-in works again"
  text, which the design does not name, is unchanged.
- **`0036`** names its constraints by the codebase's convention
  (`ck_sale_outage_details_need_the_mark`,
  `fk_sale_outage_sold_by_app_user`).
- **An ordinary sale's INSERT** names the mark's two details as NULL, as it
  does `drawer_period`; the design said it sends nothing new. No statement
  or plpgsql trigger is added (§11).
- **The sellers list of a store that does not trade** answers 403 to
  everyone, the network's owner and managers too: it needs `sale:create`
  there, as a sale does. Not put to the owner.
- **`OUTAGE_TIME_TOO_OLD` is checked before `_FUTURE`;** both can never
  apply.
- **Unchanged after all:** `sales/read.py` (the list's rows already carry
  the columns) and `test_readiness.py` (it reads the newest migration from
  the files). Every `SaleResponse`, an old snapshot's replay included, now
  carries `"outage": null`, additively.
- **A debt payment has no 7-day print** (it takes no Idempotency-Key), so
  only its permanent print is pinned; payments and returns are pinned at
  another store as well.
- **The phone's automatic check** keeps a fourth field, `loaded`, beside
  `pending`, `busy` and `run`: it tells an attempt read from the phone's
  storage from one just sent. «Каталог» and «Каса» take "waiting when the
  screen opened" as loaded.
- **The till catches a failing `crypto.randomUUID`** and shows the generic
  error; before, it was an unhandled rejection.
- **«Каса»'s close instruction** shows when reading the drawer gets no
  answer.
- **New texts the design did not settle** (business rules, G17): «Борги»'s
  local check of a sum over the debt, a kept sale refused for reserved
  units, the reason inside «Продаж не записано (…)», a mark with nothing
  named, «склади: A, B», and the late «Клієнт забрав» only for an order
  cancelled or returned. After the review: a kept stock correction,
  delivery, order step, catalogue operation or model change refused on
  resend says «… не записано.» before why, and the exact words of a kept
  return confirmed later.
- **The docs:** going back by the code alone across `0036` names one case
  that holds a phone (ADR-0013 §12).

## Not covered here

- **Nothing has run in production.** The outage has not been tried on a real
  phone in Telegram: the drill is release checklist row 24.
- **The release reading and the tap recount are owed** (release checklist,
  rows 22 and 10).
- **A store blocked, or a warehouse closed, while a phone keeps an
  operation there** holds that phone in that store until it trades or
  reopens; there is no button to discard it (owner, 2026-10-08).
- **An offline mode** is not built ([backlog](backlog.md)).
- **What stays open is in the risk register,** "the server is unreachable".
- **Tests built on today and yesterday in Kyiv** can fail right at
  midnight, as the existing report tests can.
- **A kept operation whose request keeps getting no answer while reads do**
  is resent on each answered read, with the same key: never recorded twice,
  but "once per return of the server" holds only while nothing else
  answers (found by the frontend's mutation tester).
- **A kept delivery refused on resend** says it was not recorded and why,
  not whether to enter it again; the owner confirmed this as built with the
  other new texts on 2026-10-08 (G17).
- **The sellers' list of a store that does not trade** answers 403 even to
  the network's owner and managers, as a command there would; nobody can
  sell there anyway.

## Changed files

From `git diff --stat 73c94b9` and `git status --short`, at this work's
commit: 73 changed and 16 new, beside the release reading's evidence.
- New, backend: `app/core/unavailable.py`, `app/api/unavailable.py`,
  `app/modules/sales/outage.py`, `migrations/versions/0036_outage_mark.py`,
  and the six new test files above.
- New, frontend: `src/shared/reach.ts`, `src/sales/paper.ts`,
  `e2e/outage.spec.ts`.
- New, docs: ADR-0013, the sellers' page
  (`paper-when-the-server-is-down.md`), this report.
- Backend:
  - `core/` (errors, correlation), `main.py`;
  - `api/v1/` (inventory, reports, sales, stores);
  - `modules/`: authz (service), backups (incidents), catalog
    (corrections), credit (service), inventory (service), orders (service),
    refunds (service), reports (sales), sales (models, service, shelf),
    transfers (service);
  - `pyproject.toml` (contracts);
  - 13 existing test files (above).
- Frontend:
  - `index.html`, `src/main.tsx`, `App.tsx`;
  - `shared/` (api, journal, CrashScreen), `sales/` (Sale, commands,
    types), `orders/commands.ts`, `cash/` (Cash, errors),
    `credits/Credits.tsx`, `returns/` (Returns, types), `reports/`
    (SalesReport, types), `catalog/` (Catalog, commands, Models),
    `inventory/Correction.tsx`, `damaged/Damaged.tsx`;
  - 10 E2E specs: `cash`, `catalog`, `credits`, `failures`, `models`,
    `order-shipping`, `orders`, `returns`, `session`, `size`.
- Docs: the business rules (the owner's sections and "how it is carried
  out"), the risk register, the server runbook ("when the server does not
  answer", a new version, going back), the release checklist (rows 2, 3,
  10, 22, 24, 25, and what does not block), the hot path report, the
  glossary, the backlog, the README.
- Evidence: the hot path's release reading and the A/B against main,
  `output/verification/2026-10-08-hot-path/`; the edge on Docker,
  `output/verification/2026-10-08-edge/`.
