# Paying in parts: the screens — 2026-10-01

Baseline: `6d4e662` (the credit server, merged as PR #54).
Status: implemented and verified locally. No migration.
Branch: `feat/credit-screens`.

## Why this was next

The server for a sale paid in parts merged as PR #54 with no screen. Until
now nothing in the app could sell this way. The owner's rules are in
business-rules.md, "paying in parts"; nothing new was decided here.

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

## Evidence

- **Backend: 1156 passed, 1 skipped** (the `age` test, run by CI). The one new
  test pins `paid_in_parts`: true for a sale paid in parts, false for an
  ordinary one.
- **E2E: 95 passed** on a fresh database against the real API. 8 are new:
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
- **Gates:**
  - ruff, format, mypy, all 20 import contracts and `alembic check` are
    clean;
  - frontend lint, types and build pass;
  - prettier is clean on every changed hunk.

**Mutation testing — 22 mutants, all caught (backend 1, frontend 21).**
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

## Found on the way

- **A return whose answer was lost said nothing once settled.** It now says
  what to hand back (see above).
- **The till offers a hundred models a page.** A test whose model had been
  pushed onto the second page by earlier runs could not find it. The
  journeys now page on as a seller would. The till itself has no search;
  that is unchanged.

## Not covered here

- **A customer with two debts shows as two.** Nothing groups debts by
  customer. Not asked.
- **Nothing reports totals owed** across a store or the network. Not asked.
- **Paying an order collected as a sale in parts** is not possible, as on the
  server.
- **The phone is shown to everyone holding `sale:credit` in the store,** as
  the owner chose. It also sits in the backups.
- **Nothing has run in production.**

## Changed files

- New:
  - `frontend/src/credits/Credits.tsx`, `commands.ts`, `types.ts`;
  - `frontend/e2e/credits.spec.ts`.
- Frontend:
  - `src/sales/Sale.tsx`, `commands.ts`, `types.ts` — the option, the terms
    in the journal, the receipt;
  - `src/returns/Returns.tsx`, `types.ts` — the split;
  - `src/App.tsx` — the section, its journal, and a settled return's notice;
  - `src/styles.css` — the debt's summary.
- Backend:
  - `app/api/v1/sales.py` — `paid_in_parts`;
  - `app/modules/credit/service.py` — `credited_sales`;
  - `tests/integration/test_customer_credit.py` — one test.
- Docs:
  - the credit report;
  - business rules;
  - the risk register;
  - the milestone;
  - the README.
