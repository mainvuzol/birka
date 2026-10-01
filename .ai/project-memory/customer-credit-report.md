# A sale paid in parts — the server (2026-10-01)

Baseline: `a084563` (the opening-stock screen, merged as PR #52).
Status: the server is implemented and verified locally. The screens follow
in their own change. Migration `0023`.
Branch: `feat/customer-credit`.

## Why this was next

The owner confirmed full and installment payment on 2026-09-15. On
2026-10-01 they chose it as the next work and answered the open rules
(business-rules.md, "paying in parts").

Until now a sale had a total and nothing else, and read as paid in full.

## What exists now

**A debt opens with its sale.** `POST /sales` takes an optional `credit`:
- the customer's name and phone;
- what they pay now: above nothing, below the total.

In the same transaction this records:
- **`customer_credit`**: the agreed amount, which is the sale's total;
- **the first payment.**

The goods leave as in any sale. The receipt says what was paid and what is
owed. It does not name the customer or give the phone.

**Its ledger, `credit_entry`, is append-only.** It uses the trigger the stock
ledger uses. Every row lowers what is owed:
- **a payment** by what was paid;
- **a return** by the part of the goods' worth still owed. The rest is cash
  back;
- **a write-off** by everything left.

What is owed is never stored: it is the agreed amount less the rows. No edit
can rewrite a debt.

**Later:**
- **`POST /credits/{id}/payments`** — in the store that sold, never above what
  is owed. When nothing is left, the debt closes as `SETTLED`.
- **`POST /credits/{id}/write-off`** — the owner, with a reason.
- **`GET /credits?store_id=&status=&query=`** — the store's debts, found by
  name or by any spelling of the phone. «+38 (067) 123-45-67» and
  «0671234567» are one number. **`GET /credits/{id}`** — one debt, its goods
  and every entry.

**Returns.**
- A return of such a sale goes through `POST /sales/{id}/refunds` as before.
- Its answer now carries `credit`: `debt_reduced`, `cash_back` and
  `owed_after`. `total_amount` stays the goods' worth, so hand the customer
  `cash_back`.
- **The rule:** cash back is what was paid, less cash already given back, less
  the worth of what the customer keeps. It is never below zero, and never
  above what came back.
- **For example**, two coats at 1500, with 1000 paid:
  - the first coat back gives no cash, and 500 is still owed;
  - the second gives the 1000 back, and nothing is owed.
- **After a write-off**, only what was paid can come back.

**Identity (I20).**
- **The sale's fingerprint carries the credit terms.** The same `command_id`
  retried with other terms, or none, is refused.
- **Payments and write-offs have their own `command_id`s.**
- **A retry is answered with what it did.**

**Permissions** (migration `0023`):
- **`sale:credit`** goes to every role that sells: selling in parts, taking
  payments, and seeing the store's debts with phones.
- **`credit:write_off`** goes to every role holding `user:manage`, the
  owner's by default.

**Concurrency.** Every payment, write-off and return locks the debt's row
before reading what is owed. Two payments of 1500 against 2000 owed: one is
taken, and the other is refused as more than owed.

**Import contracts:** a new one, "credit keeps money owed and moves no
stock", brings them to 20. The refund reaches the credit module and hands it
the goods' worth. The credit module reaches neither refunds nor the ledger.

## Evidence

- **Backend: 1149 passed, 1 skipped** (the `age` test, run by CI). 20 new, in
  `test_customer_credit.py`:
  - a sale paid in part leaves the rest owed, and the phone stays out of the
    audit log and the receipt;
  - payments until nothing is owed;
  - a payment retried is answered once, and other terms conflict;
  - never more than is owed;
  - the seller's statement checked: nothing paid, all paid, a bad phone, a
    blank name;
  - returned goods first lower the debt;
  - a paid-off sale gives each coat's worth back;
  - only the owner writes off, with a reason, and a write-off never becomes
    cash;
  - only the selling store takes payments and sees the debt;
  - a store lists only its own debts;
  - selling in parts needs its own permission;
  - the same sale retried is one debt;
  - two payments at once: one transaction held open while the other waits;
  - the ledger refuses `UPDATE` and `DELETE`;
  - search by name or by any form of the phone;
  - the service's own bounds;
  - the downgrade refusing while a debt exists.

  `test_authz` declares both permissions. `0022` is frozen.
- **Gates:**
  - ruff, format and mypy (110 files) are clean;
  - all 20 import contracts are kept;
  - `alembic check` is clean;
  - the full downgrade to base and back up is lossless on a fresh database.

**Mutation testing — 19 mutants, 18 caught, 1 equivalent.**
- **Caught:**
  - more than owed accepted;
  - no lock on a payment;
  - a settled debt paid again;
  - paid in another store;
  - all returned goods paid back;
  - a written-off debt paid out;
  - anyone writes off;
  - a write-off of the whole sale;
  - paid in full taken as a debt;
  - any phone;
  - nothing paid first;
  - paid off but still open;
  - another store's debts listed;
  - selling in parts without its permission;
  - the terms not part of the sale's identity;
  - a return that does not touch the debt;
  - the phone in the audit log;
  - the downgrade dropping debts.
- **Equivalent:** forgetting cash already given back. Once any cash goes back,
  what was paid equals what is kept. From then on, the cap at the returned
  goods' worth gives the same answer either way. A second test of two cash
  returns now pins the cumulative behaviour anyway.

## Not done here

- **The screens:** the option at the till, a «Борги» section, and the cash
  to hand back on a return. Built next, the same day; see the
  [credit screens report](credit-screens-report.md).
- **Customer orders collected as a sale** cannot be paid in parts. Not asked.
- **The store's own purchase installments** (owner, 2026-09-15) are a
  separate record, and not built.
- **Nothing reports totals owed** across stores.

## Changed files

- New:
  - `app/modules/credit/` (models and service);
  - `app/api/v1/credits.py`;
  - migration `0023_customer_credit.py`;
  - `tests/integration/test_customer_credit.py`.
- `api/v1/sales.py` — `credit` on the request and response.
- `modules/sales/service.py` — the terms in the fingerprint.
- `modules/refunds/service.py`, `api/v1/refunds.py` — the split on return.
- `authz/permissions.py` — the two permissions.
- `models_registry.py`, `api/v1/router.py`, `pyproject.toml` — registration
  and the contract.
- Tests: `test_authz.py` and the frozen migrations.
- Docs:
  - business rules;
  - the risk register;
  - the milestone;
  - the README.
