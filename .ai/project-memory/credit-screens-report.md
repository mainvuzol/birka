# Paying in parts: the screens — 2026-10-01

Baseline: `6d4e662` (the credit server, merged as PR #54).
Status: implemented and verified locally. No migration.
Branch: `feat/credit-screens`.

## Why this was next

The server for a sale paid in parts merged as PR #54 with no screen. Until
now nothing in the app could sell this way. The owner's rules are in
business-rules.md, "paying in parts". Three more were decided for the
review additions below ("debts by customer, totals, orders").

## What exists now

**At the till, «Оплата частинами»** — for whoever holds `sale:credit`:
- Tick it and fill in the customer's name, phone, and what they pay now.
  The till shows what will be left owing.
- **Checked before anything is sent:**
  - the name is not blank;
  - the phone has 10 to 15 digits, written however;
  - what is paid now is above nothing and below what is being sold.

  Paying everything now is an ordinary sale, and the till says so.
  "What is being sold" takes the shortfall answers into account: a line
  dropped as not on the shelf, or sold as «на місці лише N», changes it.
- **The terms travel with the sale's own command.** A sale whose answer was
  lost is resent with the same terms, and settles as one sale and one debt.
- **The receipt** says what was paid now and what is owed. It never names the
  customer, as the server's receipt does not.
- **The next sale starts without the terms.**

**«Борги»** — a section for whoever holds `sale:credit`:
- The store's debts, newest first, found by name or by any spelling of the
  phone. By default only those still owing; «Усі» adds the settled and
  written-off.
- **A debt** shows:
  - the customer, with the phone as a link to call;
  - the goods and when they were sold;
  - the sale's amount, what was paid, goods returned (and how much of that
    went back in cash), anything written off, and what is still owed;
  - its whole history: each payment, return and write-off, when, and by whom.
- **Taking a payment.**
  - Any amount above nothing and up to what is owed. «Увесь залишок» fills
    in what is owed.
  - Above what is owed is stopped before sending.
  - If the debt moved meanwhile (another seller took a payment, goods came
    back), the server refuses and the screen shows the debt as it now is.
- **Writing off**, for whoever holds `credit:write_off` (the owner):
  - it asks once more and needs a reason;
  - the reason shows in the history.
- **A payment or write-off is written down before it is sent**, as returns
  and receipts are (`@/shared/journal`). If its answer is lost, the app is
  blocked until the same command is resent. It counts once, even after a
  reload.

**«Повернення»** — for a sale paid in parts:
- The sale is marked «Оплата частинами» in the list.
- The form explains that the goods lower the debt first. Its button says
  «Оформити повернення на N», not «Повернути покупцю N»: the till cannot
  say up front what goes back in cash.
- **The answer says it:**
  - how much the debt went down by;
  - how much cash to hand back, or that none goes back;
  - what is still owed, or that nothing is.

**A return whose answer was lost now says what to hand back once settled.**
Before, the app unblocked but showed nothing. That was true of every return.
For a sale paid in parts the seller has no way to work the amount out.

**The server gained one field.** `GET /sales` now says whether each sale was
paid in parts (`paid_in_parts`).

### Added on review: debts by customer, the store's total, orders

The first version left three things out, as not asked. The user asked for
them in the same change, and the owner gave the rules (business-rules.md,
"debts by customer, totals, orders"):

- **One phone is one customer.**
  - «Борги» now lists customers, each with every debt and what they owe in
    all, the one with the newest debt first.
  - The newest debt names the customer.
  - A search by any name or spelling of the phone finds the customer, and
    then shows all their debts. The debt written as «Ірина» belongs to
    «Ірина Коваль» when the phone is one.
  - A payment is still taken on the debt the seller opens.
  - `GET /credits/customers` groups on the server, so a customer's debts
    never split across pages.
- **The store's total.** «Магазину винні N», with how many customers owe
  and how many debts are open, at the top of «Борги»
  (`GET /credits/summary`). It is by store only.
- **An order collected may be paid in parts.**
  - «Клієнт забрав» offers «Оплата частинами» with the till's own form and
    checks. The till and the order now share it (`credits/Terms.tsx`).
  - `POST /orders/{id}/collect` takes `credit`. The debt opens in the
    collection's own transaction, owed to the order's store.
  - The terms are in the command's fingerprint: the same command with other
    terms is refused, and a revoked grant is not handed the cached answer.
  - The order then shows what is paid and owed (`credit` on the order).

## Evidence

- **Backend: 1162 passed, 1 skipped** (the `age` test, run by CI). 7 tests
  are new:
  - `paid_in_parts`: true for a sale paid in parts, false for an ordinary one;
  - **one phone is one customer:** two spellings and two names are one card,
    the newest name, both debts and their sum; a search by the older name
    finds both; a debt paid off leaves the owing list;
  - customers come a page at a time;
  - **the store's total:**
    - only open debts, less what was paid and returned;
    - a phone written two ways is one customer;
    - the other store's debts are its own;
    - only `sale:credit` in that store sees it;
  - **an order collected paid in parts:**
    - the debt opens, and the order then shows it;
    - the same command replays;
    - other terms are refused, and a revoked grant gets no cached answer;
    - payments and a return then work as for any debt;
  - **the till's rules at collection:** everything paid, a bad phone, a blank
    name, nothing paid and no permission are refused, and nothing of them
    stays. The order is then collected as an ordinary sale;
  - only a collection takes terms.
- **E2E: 99 passed** on a fresh database against the real API. 12 are new:
  - **The whole path.** A sale paid in parts at the till, with the terms on
    the wire. Then «Борги» finds it by phone, takes 500, then the rest, and
    the debt closes and leaves the list of those owing.
  - **The till checks the terms** — name, phone, nothing paid, everything
    paid — before anything is sent. Unticked, the same basket sells as an
    ordinary sale with no terms.
  - **A sale paid in parts whose answer is lost** is resent with the same
    body and key, and the settled notice says what is owed.
  - **A payment whose answer is lost** blocks the app across a reload. It is
    resent unchanged and counts once.
  - **More than is owed:** stopped before sending, and refused when another
    payment arrived meanwhile. The screen then shows the debt as it now is.
  - **A write-off** asks again, needs a reason, and keeps it in the history.
    Without `credit:write_off` it is not offered.
  - **A return of a sale paid in parts.** Two coats at 1500 with 1000 paid:
    - the first back lowers the debt by 1500 and gives no cash;
    - the second, with its answer lost and then settled, lowers it by 500
      and gives 1000 back.
  - **Permissions.** Without `sale:credit`, neither the option nor «Борги».
  - **One phone is one customer, and the store's total.**
    - Two debts written under two names and two spellings make one card.
      Searching the older name finds both.
    - The total rises by what the second debt leaves owing.
    - Paying the older debt off, chosen by the seller, lowers the customer's
      sum and the store's total.
  - **An order collected in parts.**
    - Everything paid now is stopped before sending.
    - Part paid sends the terms; the order shows paid and owed, and the debt
      appears in «Борги».
  - **An order collected without the option** sends no terms.
  - **Collecting in parts needs `sale:credit`.**
- **Gates:**
  - ruff, format, mypy, all 20 import contracts and `alembic check` are
    clean;
  - frontend lint, types and build pass;
  - prettier is clean on every changed hunk.

**Mutation testing — 43 mutants, all caught (backend 11, frontend 32).**
The first 22 ran before the review additions; the till's checks were
mutated again once they moved into the shared form.
- **Backend:** no sale marked as paid in parts.
- **The till:**
  - the terms not sent;
  - a blank name accepted;
  - any phone accepted;
  - paying everything now sent as a debt;
  - the terms kept for the next customer;
  - the receipt silent about what is owed;
  - the option offered to anyone.
- **«Борги»:**
  - the settled listed as owing;
  - more than is owed sent;
  - a second payment under the first's command;
  - a refused payment leaving the stale debt shown;
  - writing off offered to a seller;
  - writing off without a reason;
  - writing off without asking again;
  - a write-off sent as a payment.
- **The app:**
  - a lost payment forgotten on reload;
  - a lost payment blocking nothing;
  - «Борги» for anyone;
  - a settled return saying nothing.
- **«Повернення»:**
  - a return of a sale paid in parts telling the seller to hand back the
    goods' whole worth;
  - the button promising that cash before the server has answered.

**The review additions:**
- **Backend:**
  - a `+38` number taken as another customer;
  - a search showing only the debts it matched;
  - the total counting settled and written-off debts;
  - the total ignoring what was paid;
  - the total counting a phone written twice as two customers;
  - a collected order opening no debt;
  - other terms replayed under the same command;
  - a revoked grant handed the cached collection;
  - the order not saying what is owed;
  - a name's digits looked for among phones.
- **Frontend:**
  - the store's total not shown;
  - a customer's total being one debt's;
  - every button opening the newest debt;
  - the shared form's checks: everything paid, the phone, a blank name;
  - the order's terms not sent;
  - the order checked against another total;
  - the order not showing what is owed;
  - the option offered at collection without `sale:credit`;
  - the till not offering the shared form.

## Found on the way

- **A name with digits was also looked for among phones** (since #54). A
  search for «Покупець 1a2b» took «12» from it, and found whoever's number
  holds a 12. Grouping by customer made it show: CI found a second customer
  for one name. The server now looks among phones only for a query written
  as a phone (digits, spaces, `+`, `-`, brackets), and two tests pin it.
- **A `+38` number and the same number without it were two customers.**
  The stored digits keep how the phone was written. The server tests caught
  it, and grouping now compares a Ukrainian number in its own ten digits.

- **A return whose answer was lost said nothing once settled.** It now says
  what to hand back (see above).
- **The till offers a hundred models a page.** A test whose model had been
  pushed onto the second page by earlier runs could not find it. The
  journeys now page on as a seller would. The till itself has no search;
  that is unchanged.

## Not covered here

- **There is no network total.** The owner chose a total by store only.
- **A payment goes to one debt.** A customer with several debts pays on the
  one the seller chooses, as the owner decided.
- **Only a Ukrainian number is matched across its spellings.** Another
  country's number written once with its code and once without is two
  customers.
- **The phone is shown to everyone holding `sale:credit` in the store,** as
  the owner chose. It also sits in the backups.
- **Nothing has run in production.**

## Changed files

- New:
  - `frontend/src/credits/Credits.tsx`, `Terms.tsx`, `commands.ts`,
    `types.ts`;
  - `frontend/e2e/credits.spec.ts`.
- Frontend:
  - `src/sales/Sale.tsx`, `commands.ts`, `types.ts` — the option, the terms
    in the journal, the receipt;
  - `src/returns/Returns.tsx`, `types.ts` — the split;
  - `src/App.tsx` — the section, its journal, a settled return's notice,
    and paying in parts on collecting an order;
  - `src/orders/types.ts` — `credit` on an order;
  - `src/shared/api.ts` — the terms' refusals in words;
  - `src/styles.css` — the debt's summary.
- Backend:
  - `app/api/v1/sales.py` — `paid_in_parts`;
  - `app/api/v1/credits.py` — `customers` and `summary`;
  - `app/api/v1/orders.py`, `app/modules/orders/service.py` — `credit` on
    collecting an order;
  - `app/modules/credit/service.py` — `credited_sales`, `list_customers`,
    `store_debts`, `customer_key`;
  - `tests/integration/test_customer_credit.py` — 7 tests.
- Docs:
  - the credit report;
  - business rules;
  - the risk register;
  - the milestone;
  - the README.
