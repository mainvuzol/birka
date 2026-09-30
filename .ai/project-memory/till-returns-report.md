# Returns at the till (M1-027) — 2026-10-01

Baseline: `92d7a67` (PR #44), on top of the E2E-in-CI change
([report](m1-027-e2e-ci-report.md)).
Status: implemented and verified locally. Migration `0019`, and a new read,
`GET /sales`.
Branch: `feat/m1-027-till-returns`.

## Why this was next

The fifth default golden path — "refund or return correctly" — had no screen.
`POST /sales/{sale_id}/refunds` has existed since M1-017, but it could not be
put in front of a seller. On 2026-09-15 the owner asked that returned units
be marked intact or damaged, and that damaged ones never silently go back on
sale, and left what happens to them to be designed.

## The owner's decisions (2026-10-01)

Asked, not guessed; recorded in business-rules.md, "returns at the till".

- Each returned unit is stated **intact or damaged**, and one sale line may
  come back partly each way.
- **Intact** goes back to the warehouse it was sold from, as since
  2026-09-17.
- **Damaged** goes to a separate **«Брак»** warehouse. It stays in the
  stock records, but nothing sells from it. A manager later repairs it and
  puts it back on sale, returns it to the supplier, or writes it off.
- **Every store has its own «Брак»**, because a warehouse is a physical
  place and a damaged coat stays where it was handed back.
- A return is taken **only in the store that made the sale**.
- The seller finds the sale in **the store's list of sales, searchable**.

## What exists now

**The return, on the server:**
- Every line that comes back carries `condition`, and the request is refused
  without it, at the schema and again in the command.
- A sale line may appear once per condition. The check against what was sold
  (invariant I9) sums every part, still under the sale line's row lock.
- The destination is derived, never requested. For intact goods it is the
  sale line's warehouse. For damaged goods it is the store's «Брак», the one
  warehouse whose access row says `damaged_returns`.
- A damaged return is refused, and nothing is written, if the store has no
  «Брак» (`DAMAGED_RETURNS_UNAVAILABLE`, `NOT_SET_UP`), or if any store sells
  from it (`SOLD_FROM`).
- The condition is part of the permanent command fingerprint. Swapping which
  line came back damaged is a different return, not a replay.
- A money-only refund keeps the fingerprint it had before conditions existed.

**The database** (`0019`):
- a store's «Брак» is received into and never sold from;
- a store has at most one «Брак»;
- a condition is stated only for goods that came back;
- one row per sale line and condition in a refund.

Returns taken before this revision keep no condition. The downgrade refuses
while a line came back in parts, rather than lose a part's meaning.

**Setup:** `seed_organization` gives each store its «Брак»
(`BOOTSTRAP-DAMAGED-MAIN`, `…-SECOND`), recorded like every bootstrap
warehouse.
- A recorded one is never recreated, even after its grant is revoked.
- A store someone gave a «Брак» by hand keeps it.
- A warehouse that merely carries the code is refused, never adopted.
- An organization set up before this change gets its «Брак» on the next run.

**`GET /sales?store_id=&q=&limit=&offset=`** lists a store's sales, newest
first, for anyone who may view them there. Each line shows:
- the name and size from the receipt;
- the price paid;
- how many have already come back.

The search is by goods name, in any letter case, and `%` is a letter, not a
pattern.

**The app:**
- **The «Повернення» tab**, for a seller holding both `sale:refund` and
  `sale:view`. The seller searches, opens a sale, and enters how many of each
  line came back intact and how many damaged. The button says the amount to
  give back, and asking for more than is left is stopped before anything is
  sent.
- **The same journal as receiving and corrections.** A return is written down
  before it is sent. A definite refusal frees the screen; an unknown outcome
  blocks the app until the identical return is resent. `@/shared/journal`
  gained a per-body path, and what it keeps for itself (store and sale) is
  never sent.
- **Receiving no longer offers «Брак»**, and the stock screen names it.

## Evidence

- **Backend: 1068 passed, 1 skipped** (the `age` test, run by CI); 34 more
  than at the baseline:
  - the returns themselves, over HTTP and against the command;
  - the schema's own rule;
  - the database constraints, on a freshly migrated database;
  - the downgrade;
  - the list and its search;
  - five bootstrap cases.

  Existing refund tests now state the condition wherever goods come back.
- **E2E: 68 passed against the real API**, 7 of them new:
  - one coat back intact and one damaged, checked in both warehouses' real
    balances;
  - more than is left stopped before sending;
  - an unknown outcome resent unchanged, with the same key and command;
  - a store without «Брак» told so;
  - the search's empty answer;
  - the permission;
  - receiving not offering «Брак».
- **Gates:** ruff, format, mypy and all 17 import contracts are clean.
  `alembic check` reports no drift. The downgrade to base and back up is
  lossless. Frontend lint, types and build pass, with 0 advisories.

**Mutation testing — twenty-five, twenty-five caught (backend 21, frontend
4).** Five survived their first run and led to new tests:

| Survived first | Why | Now caught by |
|---|---|---|
| The command defaults a missing condition to intact | the schema refused first, so no test reached the command | the command's own refusal test |
| The schema accepts goods back unjudged | the command refused next | the schema's own unit tests |
| The condition is left out of the fingerprint | the test's two returns went to different places anyway | swapping which of two lines came back damaged |
| `0019` lets «Брак» be sold from | the test ran on a database migrated before the mutation | the same test, on a freshly migrated database |
| `0019` allows two «Брак» per store | the same | the same |

The others were caught at once:
- damaged goods going back on sale;
- parts not summed;
- the same part twice;
- a missing or sold-from «Брак»;
- the condition not stored;
- the list ignoring the store, its permission, its order, its case or its
  wildcards;
- refunded counts dropped;
- the downgrade dropping a part;
- three bootstrap guards.

On the frontend:
- receiving offering «Брак»;
- the journal sending its own fields;
- over-returning;
- the tab without the permission.

## Not verified here

- **Repaired goods cannot leave «Брак» yet.** Transfers need `can_sell` at
  the source. Writing off works. The owner decided the inspection flow the
  same day — back on sale, or «брак підтверджений» — and it is the next
  change (business-rules.md, "what happens in «Брак»").
- **Nothing has run in production.** The E2E job's own first run on GitHub,
  on PostgreSQL 17, is this PR's CI.

## Changed files

- Migration `0019_till_returns.py`.
- Models:
  - `tenancy/models.py` — `damaged_returns`;
  - `refunds/models.py` — `condition`, `ReturnCondition`.
- Services:
  - `refunds/service.py`;
  - `tenancy/service.py`;
  - `sales/read.py` (new);
  - `core/errors.py`.
- API:
  - `refunds.py`;
  - `sales.py` (`GET /sales`);
  - `locations.py` (`damaged_returns`).
- Scripts: `seed_organization.py` and `seed_orders_e2e.py`.
- Tests:
  - `test_till_returns.py` and `test_refund_schema.py` — new;
  - refund, bootstrap and location tests — updated.
- Frontend:
  - `src/returns/` — new;
  - `App.tsx`;
  - `shared/journal.ts`;
  - `Receive.tsx` and `Stock.tsx`;
  - `orders/types.ts` and `styles.css`;
  - `e2e/returns.spec.ts` — new.
- Docs:
  - business rules;
  - ADR-0004 (amendment);
  - the risk register, the milestone, the E2E report and the README.
