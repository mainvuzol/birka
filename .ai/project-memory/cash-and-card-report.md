# Cash and card, the day's close — 2026-10-04

Baseline: `32ea05a` (failures are visible, merged as PR #67).
Status: implemented and verified locally.
Migration `0035`.
Branch: `feat/cash-and-card`, after `a203eef` and `572650c` (the owner's
rules and answers) and `be806ab` (the store's hold, `FOR KEY SHARE`).
Design: [ADR-0012](../decisions/ADR-0012-cash-and-card.md).

## Why this was next

With PR #67 merged, the owner chose cash and card and the day's close as
the next work. The app did not know how a customer paid, so nobody could
count a drawer against it:
- «Разом у касі» in «Звіт» took every sale, debt payment and return as
  cash, card payments included;
- an order's whole price counted as cash on the day «Клієнт забрав» was
  pressed, though every order comes by a carrier;
- nothing counted a drawer.

The owner answered the rules on 2026-10-04, and the design's derived
readings the same day (business rules, "cash and card, the day's close"):
- **three ways:** cash, card on the terminal, a transfer; one per payment,
  given by the button that sells, five taps as before;
- **an order** says at «Клієнт забрав» how it was paid; only cash paid at
  the counter is the drawer's;
- **money handed back** goes the way the sale was paid, unless the seller
  changes it;
- **one drawer per store,** counted blind by the seller on duty once a day;
  the count is the next day's starting cash;
- **cash taken out** is recorded with who and why, and **cash put in** for
  change by the owner or a manager;
- **a difference** needs a reason, and the bot tells the network's owner,
  silently; under 1,00 грн it needs neither;
- **a closed day is never reopened:** a fix is dated the day it is made,
  and before the close a seller fixes their own operations;
- **a blocked store** is closed by the owner only;
- **fiscal receipts (ПРРО)** are not part of this.

## What exists now

**The way of paying, on every payment.**
- «Продаж»: «Продати» is now «Готівка», «Картка» and «Переказ». A sale is
  still 5 taps. The receipt names the way; for a card it says to charge the
  terminal, for a transfer to check it arrived first.
- «Борги»: the same three buttons take a payment, and the history names
  each payment's way.
- «Повернення»: «Як повертаємо гроші», preselected from the sale's way. A
  return of a sale in parts asks only when money goes back.
- «Клієнт забрав»: five choices, none preselected: in advance by transfer,
  cash on delivery, or cash, card or transfer now.
- On the server, `payment_method` on `sale`, `credit_entry` (payments) and
  `refund`. A new command without it is refused `PAYMENT_METHOD_REQUIRED`,
  `recorded: false`; an old one still replays.

**«Каса», the drawer.**
- **The seller** sees the last close and a reminder to record cash taken out
  first and not to sell while counting. They type the count and confirm:
  «Каса», «Закрити касу», «Так, закрити», 3 taps and the sum. Nothing
  before that says what the drawer should hold.
- **Then the result:** what it should have held, what they counted, the
  difference, card and transfer to compare with the terminal's slip, and
  the days not closed. The first close only records the count.
- **A difference of 1,00 грн or more** asks «Чому не збігається?». Until they
  write it, only «Каса» is open on their phone, even after a reload.
- **«Видати з каси»:** a seller records expenses and a supplier's courier;
  the owner and managers any kind, and «Внести в касу».
- **«Змінити спосіб оплати»:** a seller fixes their own sale, debt payment or
  return before the close; the owner and managers any operation, any day.
  A fix of a closed day explains that close's difference.
- **«Закриття»,** for the owner and managers: every close, 20 at a time,
  with its reason, what explains its difference, card and transfer, and the
  days nobody closed.
- **A blocked store** is closed by the network's owner only.

**The periods are kept by the database.** Every sale, payment, return,
take-out and fix is stamped into its drawer's period by a trigger, under the
store's lock; the close waits for every operation in flight. An operation
belongs to one close, never two and never none, whatever its time says.

**The bot tells the network's owner** of a difference, silently: once its
reason is written, or after 15 minutes without it. The watcher sends it
every minute and retries for a day. Never to whoever closed, never under
1,00 грн.

**«Звіт» splits the money by way.** «Гроші» has «Разом» and the rows
«Готівка», «Картка», «Переказ» (and «Не вказано» for old sales). Orders paid
in advance or on delivery have their own lines, outside «Разом». A fix
counts on the day it is made; a past day never changes.

**Every refusal after a command was looked up says nothing was recorded,**
so a phone that never heard the answer settles. A cash command recorded
before its store was blocked or archived is still answered with what it did.

**A take-out sent after a colleague's close** goes on that close only while
it is the newest and at most ten minutes old (`CLOSE_IN_BETWEEN`
otherwise).

**On the server:** module `cash` and router `/cash`; four permissions,
`cash:close`, `cash:expense`, `cash:take_out` and `cash:correct`, granted by
the migration; `0034` frozen.

## Evidence

**Backend: 2462 passed, 1 skipped** (baseline 2022 and 1), on the shared
test database. New test files:
- integration: `test_cash_close.py`, `test_cash_concurrency.py`,
  `test_cash_corrections.py`, `test_cash_movements.py`,
  `test_cash_messages.py`, `test_cash_watch.py`, `test_cash_schema.py`,
  `test_payment_method_commands.py`;
- unit: `test_cash_arithmetic.py`, `test_cash_errors.py`,
  `test_cash_message_text.py`, `test_payment_method.py`,
  `test_old_prints_are_pinned.py`, `test_import_contracts_name_real_modules.py`.

They cover the design's worked examples with exact figures, the 06:00
boundary, a close racing a raw sale insert, a payment or a return taken
elsewhere, and «Клієнт забрав», in both orders, duplicate sends, the blind
count's exact keys, and the golden prints of every older command. 27
existing test files changed, most of them to send a way.

**E2E: 168 → 182, all passing on a fresh database.** `e2e/cash.spec.ts` (7
journeys) covers:
- «Оля»'s day: selling by cash and card, fixes the card sale from its
  receipt, takes out for bags, closes blind with the exact body, and is held
  on «Каса» until the reason is given;
- a second close refused, and a close kept on the phone that settles;
- the seller's fix refused after the close;
- the owner's history, and a late take-out that explains the difference;
- a take-out kept on the phone that settles on `CLOSE_IN_BETWEEN`;
- a blocked store closed by the network's owner only;
- «Щось пішло не так» with a cash command kept.

Other journeys send a way at the till, in «Борги», in returns and at
«Клієнт забрав»; three old attempts seeded on the real server are refused,
settle, and say what was not recorded.

**Gates,** all run again after the review's fixes:
- ruff, format and mypy are clean;
- 31 import contracts are kept;
- `alembic check` is clean;
- migration `0035` round-trips, up, down and up, on a scratch database,
  with `0034` frozen;
- the frontend typechecks, lints, builds and is formatted. The bundle is
  split: the main chunk 308 kB and the libraries 207 kB, with no size
  warning.

**The hot path's release reading** (checklist row 22). Every case was gated,
three runs on fresh databases, and all 8 cases passed every run. The worst
p95 was 167.6 ms against 500: run 1, four lines with six sellers. Runs 2
and 3 stayed at or under 87 ms. See the
[hot path report](hot-path-budget-report.md#update--2026-10-04-the-way-button-and-the-drawers-stamp)
and [`output/verification/2026-10-04-hot-path/`](../../output/verification/2026-10-04-hot-path/).

**The store's hold** (`be806ab`). Builder 2's mutants showed that
`tenancy.hold_stores` took `FOR NO KEY UPDATE`, not `FOR KEY SHARE`, so
every command of a store queued behind the one before it. It is fixed and
tested (`test_store_hold.py`), with an A/B reading in the risk register.

**Taps:**
- a sale: still 5, the last tap a way instead of «Продати»;
- a close: 3, plus typing the sum, and one more with the reason;
- a return: +0 when the way is preselected, +1 otherwise;
- a debt payment: unchanged;
- «Клієнт забрав»: +1 (not the hot path).

**Built by five builders,** each on its own files and its own test
database, then joined: the schema and the money commands, the drawer, the
report, the till, debts and returns, and «Каса» with the App's wiring. The
join fixed two of builder 5's guesses: the answer for one sale now says
whether it is a collected order, and the seller's own-operations list
always names the kind.

**An adversarial review** (three lenses, each finding checked by a skeptic)
confirmed 7 findings, all fixed:
- **A seller could put a take-out on any past close** by naming an old
  close as the one their screen showed, and "explain" an old shortage without
  `cash:correct` (medium). Now `CLOSE_IN_BETWEEN`.
- **A seller could attach a take-out to a colleague's closed day,** which
  the owner leaves to the owner or a manager (medium, the rules lens).
  Fixed by the same window.
- **A cash command recorded before a block or the archive** was refused
  before it was looked up, without `recorded: false`, so the owner's phone
  stayed held (low).
- **«Каса» kept the reason form** after the reason was recorded, saying the
  other tabs were locked (medium).
- **A return checked its lines before its way,** so an old unrecorded
  return got `REFUND_EXCEEDS_SOLD` without `recorded: false` and held the
  phone (low).
- **«Показати ще» in «Закриття»** asked for more than 100 closes at once,
  and the list turned into an error (low).
- **The `?age=` floor had no test,** and a phone clock set back would have
  had its close refused before the replay (low). The server now takes a
  negative age as 0.

Four were refused: the take-out form keeping the close it opened with (as
designed; the other order is commoner), a seller reading one sale's way at a
time, a seller reading debt payments' ways in «Борги», and a seller writing
their reason after a block. The last three are in the risk register; the
owner confirmed them as built on 2026-10-08 (business rules, "carried
out").

**Mutation testing:**
- by the builders, 233 in all:
  - the schema: 50, all caught; one survived at first, until a test was
    added;
  - the shared frontend file: 4; three caught by the type checker, the
    fourth by a one-off check, and by the E2E journeys since;
  - the money commands: 33, all caught;
  - the drawer: 64, all caught; four survived at first, three of them hidden
    by the store's hold, which led to `be806ab`;
  - the report: 16, backend, all caught;
  - the till, debts and returns: 30, all caught, by a harness outside the
    repo and the type checker;
  - «Каса» and the App: 36, all caught; two survived at first;
- by the fixers: 13 hand reverts of the four backend fixes, each turning
  its test red; 8 frontend mutants, run in a harness outside the repo, all
  red.
- independently, after the fixes: 56 mutants over the key protections:
  - each term of the expected sum, and the 1 грн threshold;
  - whom the bot tells, how quietly, and the 15-minute wait;
  - a closed day's correction, where a payment was taken, and order money
    paid off the till;
  - the blind count, a seller's limits, and the blocked store;
  - the stale count, `CLOSE_IN_BETWEEN`, and the 6:00 boundary;
  - the 7-day print, the way required only after the replay, and the
    report's «Разом».

  53 were caught. Each of the three that survived now has a test:
  - the first payment of an order collected in parts and paid off the till,
    counted as the drawer's cash;
  - the fix step still offering a seller a change after the close;
  - days not closed read without the 6:00 boundary. The existing test
    caught that only when run between midnight and six.

## Not covered here

- **Nothing has run in production,** and the bot's message has not reached a
  real Telegram: it is tested against fakes.
- **The carrier's cash on delivery is not checked** against what the carrier
  paid out. It is later work.
- **Fiscal receipts (ПРРО)** are out of scope.
- **The frontend has no unit runner.** «Каса»'s paging past 100 closes was
  checked only in a harness outside the repo, and a seller fixing their own
  collected order to an order way only by a backend test.
- **What stays open is in the risk register,** "cash and card".

## Changed files

- New, backend:
  - `app/modules/cash/` (`models`, `current`, `service`, `read`,
    `messages`), `app/modules/sales/payment.py`, `app/api/v1/cash.py`;
  - `migrations/versions/0035_cash_and_card.py`;
  - the tests above.
- New, frontend: `src/cash/` (`Cash.tsx`, `commands.ts`, `errors.ts`,
  `types.ts`), `src/shared/payment.ts`, `e2e/cash.spec.ts`.
- Backend:
  - `api/v1/`: credits, orders, refunds, reports, router, sales;
  - `core/errors.py`, `models_registry.py`;
  - `modules/`: authz (permissions, service), credit (models, service),
    orders (service), refunds (models, service), reports (sales), sales
    (models, order_collection, read, service);
  - `pyproject.toml` (contracts);
  - `scripts/` (backup_watch, measure_hot_path, seed_orders_e2e);
  - 27 existing test files.
- Frontend:
  - `src/App.tsx`, `credits/`, `orders/types.ts`, `reports/`, `returns/`,
    `sales/`, `shared/api.ts`, `shared/CrashScreen.tsx` (a comment);
  - `vite.config.ts` (the libraries in their own chunk);
  - 15 E2E specs.
- Docs:
  - ADR-0012, the ADR-0001 amendment, business rules, the risk register;
  - the release checklist (rows 2, 3, 8, 10, 22), the hot path report, the
    sales report's report, the server runbook, the README, the milestone,
    the glossary.
- Evidence: `output/verification/2026-10-04-hot-path/`.
