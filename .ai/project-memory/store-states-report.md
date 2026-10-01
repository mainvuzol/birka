# Store states — 2026-10-01

Baseline: `dc20627` (returns at another store, merged as PR #56).
Status: implemented and verified locally. Migration `0025`.
Branch: `feat/store-states`.

## Why this was next

The owner chose it after returns at another store. Owner-decisions-2026-09-15
§2 asked for two states, "temporarily blocked by an administrator" and
"ceased trading / archived", and said to define first what each may do and
who decides. Until now `store.is_active` was the only flag:
- nothing in the app set it;
- a store with it off vanished for everyone, its owner included, history and
  debts too;
- a refund there could still pay money out without the goods (an open
  question in the code).

The owner answered on 2026-10-01 (business-rules.md, "store states").

## What exists now

**«Магазини» — the network owner's section.**
- Every store of the network, its state and since when.
- **The reason for the last change,** and the history of changes: who made
  each, when, and why.
- **Actions by state:**
  - a trading store: «Заблокувати», «Закрити в архів»;
  - a blocked store: «Розблокувати», «Закрити в архів»;
  - an archived store: «Відкрити знову», never a block.
- **Each change asks for a reason** and says what will happen.
- **An archive that is refused** lists what is left: units in the store's own
  warehouses or its «Брак», and its open orders.
- **A lost answer** blocks the app until the same change is resent, as every
  other command does. It is never done twice.

**A store that does not trade** (blocked or archived):
- **Its own people** see it in the list of stores, marked «Заблоковано
  власником з …» or «Закрито, в архіві з …». Opening it shows only that,
  never the reason.
  - They still sign in: a seller whose only store is blocked is not "without
    access".
  - Once it is unblocked, they work as before.
- **The owner and the network's managers** open it read-only:
  - a banner says «Лише перегляд»;
  - only the screens that read stay: orders, stock, debts, «Брак», with no
    button that changes anything;
  - the till, receiving, returns, the catalogue and opening stock are gone.
- **Its open orders wait.** Their goods stay held, and no other store sells
  them.
- **Its sales come back at a store that trades,** by the returns-elsewhere
  rules. It takes nothing back itself, not even money without the goods.
- **Its debts are paid at any store that trades.**
  - In «Борги», «Де брали в борг: У магазині, що заблокований чи закритий»
    finds the customer by a search of two letters or more, never a list.
  - The debt says which store sold it, and that this store takes the payment
    while the debt stays the other's.
  - Each payment taken that way names the store that took it, in the history.
  - The owner of the network may still write such a debt off.

**On the server:**
- **`GET /stores` and `POST /stores/{id}/state`** need `store:manage`, held
  network-wide.
  - `store:manage` is given to every role that manages people, the owner's
    by default.
  - A change carries a `command_id` and a reason. Refusals carry their own
    reason: `ALREADY`, `NOT_FROM_ARCHIVE`, `NO_REASON`, or `NOT_EMPTY` with
    the `leftovers`.
- **One place decides what a store that does not trade allows: the person's
  scope.**
  - Any change there is refused with `STORE_NOT_TRADING` and its state, before
    any stored answer is replayed.
  - A `GET` is let through only for a role that covers the network.
  - A membership of that store alone grants nothing; `/me` lists the store
    with its `state` and `state_since`, and no permissions.
- **A command that moves or reserves stock holds its store** until it commits
  (`FOR KEY SHARE`, which its foreign key takes anyway).
  - A change of state takes the store `FOR UPDATE`, so it waits for those
    commands and they wait for it.
  - So goods cannot land in a store in the instant it is archived. A return
    and a debt payment hold the store taking them the same way.
- **Payments for another store's debt:**
  - `POST /credits/{id}/payments` takes `store_id`, the store taking the
    money, only while the store that sold does not trade. Otherwise it is
    refused with `PAID_WHERE_SOLD`.
  - `GET /credits/customers?elsewhere=true&query=…` searches the debts of
    the stores that do not trade.
  - `GET /credits/{id}?store_id=…` reads one from the store taking it.
  - A debt answers `store_name` and `store_state`; a payment entry answers
    `taken_at`.
- **Writing off** a debt of a store that does not trade needs
  `credit:write_off` held network-wide.
- **Migration `0025`:**
  - `store.state` (`ACTIVE`, `BLOCKED`, `ARCHIVED`) and `store.state_since`
    replace `store.is_active`. A store that was inactive becomes BLOCKED:
    BLOCKED keeps every rule an inactive store had, while ARCHIVED promises
    an empty store, which an old inactive one may not be.
  - `store_state_change` records every change, append-only.
  - `credit_entry.taken_at_store_id` is set only for a payment taken
    elsewhere, so no row of that append-only ledger was rewritten.
  - The downgrade refuses once a state was changed from the app, a store is
    archived, or a payment was taken elsewhere.
  - The `0024` digest is frozen.
- **`scripts.stores list`** shows each store's state.
- **People:**
  - `scripts.people` still lets someone go from a store that does not trade,
    on the network owner's word.
  - It adds nobody to such a store.

## Evidence

- **Backend: 1185 passed, 1 skipped** (the `age` test, run by CI). 14 are
  new.
  - **`test_store_states.py`, 11 tests**, with real people signed in by a
    session token:
    - only the network's owner changes or lists the states: not a manager,
      not a child store's owner, not a seller; each change is in the audit
      log;
    - a blocked store does nothing and the network reads it:
      - its seller signs in and sees the state, never the reason;
      - its own reads are refused, as are its owner's;
      - a network role reads its sales and stock, and is refused a sale and
        a «Брак» step there;
      - the other store sells on from the shared warehouse;
      - unblocked, all works again;
    - a blocked store's sale comes back at a store that trades, never at
      itself;
    - its open order waits with its goods held, and keeps it from being
      archived;
    - only an empty store is archived, from trading or blocked; the refusal
      lists its own warehouse and its «Брак»; archived, it opens again with
      its people;
    - a change is named by its command: replayed, conflicting, and never
      redone after the store was unblocked in between;
    - a debt of a blocked store:
      - its own seller cannot take a payment there;
      - another store finds it only by a search, takes the payment, and
        names itself;
      - while the selling store trades, nobody else takes or reads it;
    - the network's owner writes off a blocked store's debt; its own owner
      and a manager do not;
    - **an archive waits for a command already holding the store**, then
      reads what it did;
    - a seller only in a blocked store still signs in;
    - the migration round-trips an operator's inactive store, and refuses
      to go down once a state was changed from the app.
  - **`test_scope_store_states.py`, 3 tests:** the request scope's contract
    for a store that does not trade.
  - **Gates:**
    - ruff, format and mypy are clean;
    - 22 import contracts are kept (2 new for `stores`);
    - `alembic check` is clean;
    - the full `downgrade base` → `upgrade head` round trip passes.
- **Older tests changed by design:**
  - `is_active` → `state` wherever a test closed a store;
  - a closed store's refund now refuses money without the goods too, with
    `STORE_NOT_TRADING`, where it used to pay out;
  - a seller whose only store is blocked now signs in and is told so,
    where they used to get no access;
  - a blocked acting store at the ledger's door is `STORE_NOT_TRADING`, not
    "Unknown store";
  - the role matrix gains `store:manage`;
  - a migration test that seeded at revision 0020 now writes the
    organization as 0020 knew it.
- **E2E: 104 → 109 passed** on a fresh database against the real API. 5 are
  new, in `stores.spec.ts`:
  - the owner blocks «Ринок» (never without a reason):
    - Петро sees only that, and since when;
    - the owner reads it, with no button that changes anything, «Брак»
      included;
    - unblocked, Петро sells again;
    - a seller never sees «Магазини»;
  - a blocked store's debt:
    - found by a search at «Центр» and paid there, with the store named in
      the body and the history;
    - in «Ринок» itself the owner reads it, may write it off, and takes no
      payment;
  - an archive refused with what is left;
  - «Старий» reopened and archived again;
  - a lost answer resent unchanged, and done once.
- **The E2E seed gains a second network** for these journeys, so blocking a
  store stops nothing another journey sells in:
  - «Центр» and «Ринок» share a warehouse; «Ринок» has its own and its
    «Брак»;
  - «Старий» is archived;
  - its owner works network-wide; «Ганна» and «Петро» each in one store.

**Mutation testing — 46 mutants, all caught (backend 27, frontend 19).**
- **Two survived at first**, both a network role writing in a closed store:
  - its permissions applying to a write;
  - every request treated as a read.

  The only write tried there had been a sale, which the ledger's door
  refuses on its own. A «Брак» step, which moves nothing, now shows it, and
  the scope's contract has unit tests of its own.
- **Backend:**
  - a network role changing a closed store;
  - its permissions applying in a write;
  - a closed store's own grants still counting;
  - the network not reading a closed store;
  - every request reading, and no request reading;
  - a command not holding its store;
  - the ledger's door letting a blocked store through;
  - a return not held to a trading store;
  - anyone changing or listing the states;
  - a store with goods archived; «Брак» or open orders not counted;
  - a late command done again;
  - an archived store blocked;
  - a debt paid elsewhere while its store trades;
  - who took the money not recorded;
  - a payment elsewhere needing the selling store's authority;
  - a closed store's debt written off by a role in it;
  - other stores' debts browsed without a search, or with trading stores'
    among them;
  - another store's debt read while it trades;
  - its people not told the state;
  - an operator's inactive store coming back trading;
  - the downgrade forgetting the changes;
  - a closed store taking someone new.
- **Frontend:**
  - a closed store showing every screen;
  - its people not told it is closed, in the list or on opening it;
  - no banner saying it is read only;
  - everyone seeing «Магазини»;
  - a lost change forgotten on reload, blocking nothing, or resent as
    another;
  - the store taking a payment not sent, or the payment not marked as
    taken elsewhere;
  - other stores' debts browsed without a search, or never searched;
  - a closed store offering other stores' debts, or taking payments;
  - the network owner unable to write off a closed store's debt;
  - «Брак» acting in a closed store;
  - a change without a reason;
  - what is left not listed;
  - an archived store offered a block.

## Found on the way

- **The journal binds an attempt to the store it was made in.** The first
  «Магазини» journal named the store being changed instead, so validation
  refused it before it was sent, and the screen said nothing. The E2E
  journeys found it. The journal now keeps the store worked in, and the
  target apart; the section shows such a refusal if one ever comes.
- **Nothing could set `is_active`, yet code depended on it.** A closed
  store's refund rule, written as an open question, could only be reached by
  an operator. The owner's answer removes it.

## Not covered here

- **Nothing settles money between stores.** Each payment taken for another
  store's debt names the store that took it, as each return does. Nothing
  adds it up.
- **A command already running finishes.** A stock command holds the store,
  so a block waits for it; a payment or an order step sent in that same
  instant may still land.
- **A store's private warehouse** could receive goods from another store
  after it is archived, if an owner ever grants that store access. No such
  grant exists today.
- **Still waiting for the owner's rules:** supplier returns, the store's
  purchase installments, and the JSON stock import.
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0025_store_states.py`;
  - `backend/app/modules/stores/` and `backend/app/api/v1/stores.py`;
  - `backend/tests/integration/test_store_states.py`;
  - `backend/tests/unit/test_scope_store_states.py`;
  - `frontend/src/stores/` («Магазини»);
  - `frontend/e2e/stores.spec.ts`.
- Backend:
  - `authz/scope.py`, `authz/service.py`, `api/deps.py`: a store that does
    not trade, in the person's scope;
  - `authz/permissions.py`: `store:manage`;
  - `core/errors.py`: `STORE_NOT_TRADING`;
  - `tenancy/models.py`, `tenancy/service.py`: the state, its history,
    `hold_stores`;
  - `inventory/service.py`: `lock_stock` holds the store; `units_held`;
  - `orders/service.py`: `open_order_count`;
  - `refunds/service.py`: the taking store held, the old closed-store rule
    gone;
  - `credit/models.py`, `credit/service.py`, `api/v1/credits.py`: payments
    elsewhere, the network owner's write-off;
  - `identity/people.py`: people of a closed store;
  - `api/v1/router.py`: `/me` lists closed stores with their state;
  - `scripts/stores.py`: the state in the list;
  - `scripts/seed_orders_e2e.py`: the second network;
  - `pyproject.toml`: two contracts.
- Frontend:
  - `src/App.tsx`: the state on the list, the closed screen, the read-only
    workspace, «Магазини»;
  - `src/orders/types.ts`: the state and `asShown`;
  - `src/credits/`: debts of stores that do not trade;
  - `src/damaged/Damaged.tsx`: read-only;
  - `src/shared/api.ts`: `STORE_NOT_TRADING`.
- Docs:
  - business rules;
  - ADR-0001;
  - the release checklist;
  - the risk register;
  - the milestone;
  - the README.
