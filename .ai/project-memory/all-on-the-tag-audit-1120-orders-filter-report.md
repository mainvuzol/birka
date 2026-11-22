# «Усе на бірці», audit 2026-11-20, batch 6: the orders' closed screens read on the server — «Клієнт забрав» only the collected, «Скасовані й повернені на склад» only the cancelled and come back — 2026-11-22

Baseline: `048c8064` (main after #239).

Point: orders-cash Н3 (б) — the server's filter of the collected and of the
cancelled and come back (Backend). Н3 (а), the phone reading on while none
of a screen's own was read, was built in batch 2 (#236) and is replaced.

Taken as the next after «merged go next»: the last point of the audit that
waits for no owner's answer.

No right, check, journal, step or word changes; nothing recorded changes.
What each closed screen shows, its rows, words, «Показати ще» and a failed
page's plate: as before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1238 (three replaced, one extended).
- Branch: `feat/audit-1120-orders-filter`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-22 (audit
  2026-11-20, batch 6: …)".

## What exists now

- **The server reads each closed screen's own:** `GET /orders` takes
  `status=collected` and `status=cancelled_or_returned`, besides `open` and
  `closed`. Newest first, paged, the rights' filter before the page, as
  every order list.
- **«Клієнт забрав» and «Скасовані й повернені на склад» each read their
  own:**
  - Before: one read of every closed order, fifty a page, picked out on the
    phone; a screen with none of its own among those read read on, page
    after page — a shop with none cancelled read all its closed orders to
    say «Тут посилок немає.».
  - Now: a page holds the screen's own, or there are none.
- **The link «Скасовані й повернені на склад ›»:** once «Клієнт забрав» is
  answered, when their read found any, or whenever it failed (their screen
  says the failure and reads again). It was shown while there were more
  closed pages to read.
- **«Замовлень ще немає.»:** nothing open and both reads empty; the rows'
  places until both are known.

## How it was built and proven

Sources:
- `backend/app/modules/orders/service.py`: `ListStatus`, `LIST_STATUSES`
  (each name's statuses); `list_orders` filters by them.
  `backend/app/api/v1/orders.py`: the query's `status` is `ListStatus`.
- `frontend/src/orders/Orders.tsx`: `collectedRead` and `goneRead` in place
  of the one closed read; batch 2's reading on, its press state and its two
  effects gone; `closedRows`, `closedRead` and `more` per read; the link's
  and «Замовлень ще немає.»'s conditions on both.

Decided here:
- the names `collected` and `cancelled_or_returned`; `closed` kept for an
  app still open on a phone across the update;
- the link shown whenever their read failed, the first or a later one: a
  failed read never hides the way (review);
- the collected stay read while their search or the cancelled screen stands
  over «Клієнт забрав», as the closed were: the way back finds them as they
  are.

Tests (server): `test_order_read_api` — `collected` and
`cancelled_or_returned` beside `closed`; a new test of both apart, a come
back order with the cancelled, paged one by one, past the end empty: 8/8.

Journeys:
- Replaced (`orders-list`, batch 2's three):
  - «Клієнт забрав» reads only the collected, «Скасовані й повернені на
    склад» only the cancelled and come back: three rows at once, no places,
    no «Показати ще»; sixty cancelled fifty and «Показати ще»; each read
    once, never the closed whole; back, the link in focus, nothing read
    again;
  - the link comes once their read says there are some, under «Показати
    ще»; none, never; «Клієнт забрав» not answered yet, no link over its
    places;
  - their read failed: the link stands, their screen says the failure, its
    retry reads them — none, «Тут посилок немає.»; back, no link; a read
    again as the app comes back fails, the link stands again.
- Extended: `orders-list`'s «no order yet» — only cancelled ones are
  orders too; none collected and the cancelled unanswered, the rows'
  places, neither words. Its first check: no closed read before
  «Клієнт забрав» is chosen.
- Stubs taught the two names: `orders-list`, `orders-card`, `orders-new`.

Runs on a fresh seed:
- The 11 specs that read the order lists (`design-system` first,
  `orders-list`, `orders-card`, `orders-new`, `orders`, `order-shipping`,
  `credits`, `today`, `today-search`, `outage`, `telegram-back`): 409/409.
- After the review's fixes, `orders-list`, `orders`, `orders-card`,
  `order-shipping`: 114/114.
- CI runs all 1238.

Mutants:
- Server, against `test_order_read_api`: 3/3 caught — the collected with
  the cancelled, the cancelled without the come back, the collected
  unfiltered.
- Phone, mutate83, 10, each against its journey: 10/10 caught — either
  read asking `closed`; the cancelled read only on their screen; no
  «Показати ще» under them; the link always, while «Клієнт забрав» is
  unanswered, never on a failure, only on a first failure; «Замовлень ще
  немає.» with cancelled ones, or before the cancelled are answered.

## The review

An independent review read the diff against Н3 (б), the 2026-11-01 link
rule and batch 2's entry, with the decisions' draft. `tsc`, ESLint, ruff
and mypy are clean; the journeys have no type error main has not.

Checked and found right:
- `closed` the same rows as before (every status is one of six, not null);
  the rights' filter before the page; `has_more` at the edge; an unknown
  name refused 422; nothing else read `closed`;
- each read's places, first and next page failures, empty words; both
  re-read on a step and as the app comes back; one read pending and the
  other answered draws nothing wrong; nothing open with one failed, the
  list as before;
- the cursor on their heading and back on the link; the carried tap's
  guard as before — a late link comes under everything;
- batch 2's code gone cleanly; the replaced journeys fail on main's code;
  the other specs' stubs mean what they meant.

Found and fixed:
- **Low:** an empty answer read again and failed hid the link — it shows
  on any failure of their read now; a journey brings the app back with it
  failing.
- **Low:** a failed «Клієнт забрав» hid the link to cancelled ones read —
  the link waits only for it to be answered.
- **Low:** two absence checks could pass before the read they test — one
  after the link, one on the answer itself.
- **Low:** two conditions no journey held — «Клієнт забрав» unanswered
  under a link, and the cancelled unanswered with nothing open: the stub
  holds either, a check each.
- **Nit:** `closedRows`' type; `LIST_STATUSES` keyed by `ListStatus`.

Known, kept:
- **Low:** the collected read while the cancelled screen or a search
  stands — as the closed were; decided above.
- **Low:** back from «Скасовані й повернені на склад» whose retry found
  none, no link to put the cursor on — as before.
- The «no order yet» extension for only cancelled ones passes on main too:
  a guard of the two reads, not their proof.

## Left

- goods P2-5 waits for В20-Т1 (the owner pack).
- The set-off's return names its place as «склад «…»» where
  «Постачальникам» says «з «Браку» «…»» — for the next audit.
- The owner pack's answers.
- Dependabot pull request #223 is redundant after #233. It is closed only on
  the user's word.
