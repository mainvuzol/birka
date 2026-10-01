# Where an order goes — 2026-10-01

Baseline: `366b007` (supplier invoices, merged as PR #59).
Status: implemented and verified locally. Migration `0028`.
Branch: `feat/order-shipping`.

## Why this was next

The owner asked for it on 2026-10-01, put it on the future list, and chose
it as the next work. Until now an order knew only its status, from «До
відправлення» to «Клієнт забрав». It did not record where the goods went or
how they were sent.

The owner answered on 2026-10-01 (business-rules.md, "where an order goes").

## What exists now

**A new order.** Under the goods, «Куди»: «По Україні», the default, or «За
кордон».
- Within Ukraine, «Перевізник» is one of «Нова пошта», «Укрпошта» or «Міст».
  Without it the order is not made: «Оберіть перевізника».
- Abroad there is no carrier to pick.
- The waybill comes later, and the screen says so.

**An order.**
- **«Доставка»:** «Укрпошта · ТТН 0500012345678», «Нова пошта · ТТН ще
  немає», «За кордон · Варшава, Польща, …», or «Доставку не вказано» for an
  order made before.
- **When it is sent:** «Номер накладної (можна дописати пізніше)», or abroad
  «Куди і як відправили: місто, країна, спосіб». It may be left empty.
- **«Змінити доставку»**, while the order is open:
  - where it goes, the carrier, and the waybill or the text abroad;
  - «Зберегти доставку» saves it, and the form closes on the order as it
    now stands.
- **«Історія доставки»:** each version, with when, what and who — «Вказано
  при створенні», «Вписано при відправленні», «Змінено».
- **One waybill on two orders:** saved anyway, and the order says «Ця
  накладна є також у замовленні № …». Several orders may travel in one
  parcel.

**The list of orders** shows how each one goes. «Пошук за номером накладної»
finds orders by their waybill, however it is spaced.

**A lost answer** to a correction blocks the app until the same command is
resent unchanged, through the orders' own journal, as every order step does.

**On the server:**
- **`POST /orders`** takes `destination` (`UKRAINE`, the default, or
  `ABROAD`) and, within Ukraine, a `carrier` it requires (`CARRIER`).
  - Abroad, a carrier is refused (`CARRIER_WITHIN_UKRAINE`).
  - A command sent before orders said where they go is still answered with
    its order: its fingerprint holds the destination only when one is
    stated, and the carrier is required only after the stored answer is
    looked for.
- **`POST /orders/{id}/dispatch`** has its own route and may carry:
  - a `waybill` within Ukraine; abroad it is refused
    (`WAYBILL_WITHIN_UKRAINE`);
  - an `abroad_note` abroad; within Ukraine it is refused
    (`NOTE_ABROAD_ONLY`);
  - neither, for an order made before, until it states where it goes
    (`NO_DESTINATION`).
- **`POST /orders/{id}/shipping`** states all of it again, with a permanent
  `command_id`.
  - It needs what making an order needs (`sale:create`).
  - It is refused once the order is collected, cancelled or returned
    (`ORDER_CLOSED`).
  - Stating it as it stands adds nothing to the history.
- **Each order's answer** has `destination`, `carrier`, `waybill` and
  `abroad_note`. One order alone also has:
  - `shipping_history`;
  - `same_waybill` — the store's other orders whose waybill is the same once
    spaces, dashes and letter case are set aside.
- **`GET /orders?waybill=`** finds them the same way.
- **The audit entry** of every order step that knows where its order goes
  carries it, and a correction carries it before and after.
- **Migration `0028`:**
  - `customer_order` gains `destination`, `carrier`, `waybill`,
    `waybill_key` and `abroad_note`, checked to stand together;
  - `customer_order_shipping_change` keeps each version, append-only;
  - an order made before stays without a destination.

  The downgrade refuses while any order states where it goes. The `0027`
  digest is frozen.

No name, phone or address is recorded.

## Evidence

- **Backend: 1211 passed, 1 skipped** (the `age` test, run by CI). 7 tests
  are new, in `test_order_shipping.py`:
  - **where an order goes:**
    - within Ukraine always by a carrier, never one off the list;
    - each of the three carriers;
    - abroad by none;
    - the same command is answered with its order, another carrier under it
      is refused;
    - nobody's phone is taken;
  - **a command from before** is still answered with its order;
  - **the waybill:**
    - written when the order is sent, or not;
    - kept as typed;
    - a note within Ukraine, a waybill abroad and one of dashes alone are
      refused;
    - nothing but dispatch takes it;
  - **corrections:**
    - while open, before and after it is sent, every version kept;
    - never by someone who only reads orders, not even as a replay;
    - stating it as it stands adds nothing;
    - a closed order stays as it went;
  - **an order made before** says nothing until told, and takes no waybill
    meanwhile;
  - **one waybill on two orders:**
    - saved and named both ways, however spaced;
    - another store's order with it is not named;
    - the search finds both, and an empty search lists every order;
    - the list shows each one's carrier and waybill;
  - **the migration** keeps an order made before without a destination,
    round-trips, and refuses to go down while an order says where it goes.
- **Older tests changed by design:** 7 places that make an order now name
  its carrier (`test_customer_orders`, `test_order_read_api`,
  `test_customer_credit`, `test_store_states`, `test_supplier_returns`), and
  the frozen digests gain `0027`.
- **Gates:**
  - ruff, format and mypy are clean;
  - 25 import contracts are kept;
  - `alembic check` is clean.
- **E2E: 120 → 125 passed** against the real API. 5 are new, in
  `order-shipping.spec.ts`:
  - an order within Ukraine is refused without a carrier, made with
    Укрпошта, and sent with its waybill; the bodies and the history are
    checked;
  - an order abroad has no carrier to pick, and is sent with where and how
    it went;
  - an order sent without a waybill is corrected to Міст with one; the form
    closes, both versions are listed, and once collected it is no longer
    changed;
  - two orders with one waybill are found by part of it, spaced otherwise,
    and the second names the first;
  - a lost correction is resent unchanged after the page is closed.

  Three older journeys now pick a carrier: `orders.spec.ts`,
  `credits.spec.ts` and `suppliers.spec.ts`.

**Mutation testing — 32 mutants, all caught (backend 18, frontend 14).**
None survived on the first run.
- **Backend:**
  - an order within Ukraine without a carrier, a carrier abroad;
  - a note within Ukraine, a waybill abroad, a waybill of dashes alone;
  - a command from before refused;
  - the history not written, or written for nothing new;
  - two spellings of a waybill taken for two;
  - the waybill sent with the order ignored, or written for an order going
    nobody knows where;
  - a closed order corrected; whoever only reads correcting;
  - another store's order named, or the order naming itself;
  - the search ignored; the list hiding the carrier;
  - the downgrade forgetting where orders go.
- **Frontend:**
  - an order within Ukraine made without a carrier;
  - where it goes, the carrier, the waybill or the note abroad not sent;
  - a carrier offered abroad;
  - a closed order offered a correction;
  - one waybill on two orders not named;
  - the search not sent; the history or the list's line not shown;
  - a correction dropping its waybill, or leaving its form open;
  - a lost correction that the journal cannot keep.

Two checks are not mutated, because no request can reach them: the server
refuses a waybill on any step but dispatch, and the screen sends no carrier
abroad. A request carrying either is refused first by its schema, or the
carrier is cleared when abroad is picked.

## Not covered here

- **A waybill is not checked** with the carrier, as the owner chose.
- **The country abroad is not a field of its own.**
- **Still waiting for the owner's rules:** the JSON stock import, and
  settling money between stores ([backlog](backlog.md)).
- **Nothing has run in production.**

## Changed files

- New:
  - `backend/migrations/versions/0028_order_shipping.py`;
  - `backend/tests/integration/test_order_shipping.py`;
  - `frontend/e2e/order-shipping.spec.ts`;
  - `.ai/project-memory/backlog.md` (the future list, with this item moved
    out to here).
- Backend:
  - `orders/models.py`: the five columns and the history;
  - `orders/service.py`: checking, recording, correcting, naming and
    finding;
  - `api/v1/orders.py`: the fields, `/dispatch`, `/shipping`, `?waybill=`;
  - `models_registry.py`.
- Frontend:
  - `src/App.tsx`: «Куди» and «Перевізник», «Доставка», the waybill when
    sent, «Змінити доставку», «Історія доставки», the search;
  - `src/orders/types.ts`, `src/orders/commands.ts`.
- Docs:
  - business rules;
  - the backlog, the release checklist and the milestone;
  - the risk register;
  - the README.
