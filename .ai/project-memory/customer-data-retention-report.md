# How long a customer's name and phone are kept — 2026-10-09

Baseline: `6867576` (the shops' existing stock from a JSON file, merged as
PR #74).
Status: implemented locally; reviewed and mutation-tested as below.
Migration `0038`.
Branch: `feat/customer-data-retention`.
Design: [ADR-0015](../decisions/ADR-0015-customer-data-retention.md).
Owner decisions: business rules, "customers' data" (2026-10-09).

## Why this was next

With PR #74 merged, the owner chose this from the candidates on 2026-10-09:
a sale paid in parts records the customer's name and phone (2026-10-01), and
nothing ever removed them. After going live they would only pile up, in the
database, in every backup, and on the owner's computer, which kept every
copy forever. It was worth deciding before going live.

The same day the owner answered the count the JSON import waited on: the
shops' largest warehouse comes to at most 5 000, so the opening list's limit
is not raised before going live (business rules, "Answered on 2026-10-09").

## What the owner decided

Six questions, asked in two rounds the same day; every answer is in the
business rules with its question. In short:

| Asked | Answer |
|---|---|
| A debt paid or returned: how long are the name and phone kept? | a year after it closed |
| A written-off debt? | three years after the write-off |
| Then? | the name and phone erased, every sum kept |
| A customer asks to be erased sooner? | the owner erases their closed debts; an open one waits until closed |
| The owner's own copies of the backups, kept forever? | deleted when older than 3 months, as on the server |
| Names written in explanations? | a hint under the fields, and a write-off's reason erased with the name |

## What was mapped first

Before asking, every place a customer's name and phone are stored was
mapped (ADR-0015, Context): only `customer_credit` holds them; a
write-off's reason may, and was also copied into the audit log; the
backups and the owner's copies hold everything; a credit sale not yet
answered sits in the seller's phone. An order keeps no name, phone or
address, and the receipt, a refund, an order's answer, the logs, Sentry and
the audit log leave them out. The answers kept for replays hold a debt's id
and sums, never the name; the command fingerprints are hashes that include
it (Risks).

## What exists now

| Owner's rule | Where |
|---|---|
| A year after a debt was paid or returned, three after a write-off | `credit/erasure.py` `erase_expired`, run hourly by the `backup-watch` service, and at once when it starts; 500 debts a transaction, `SKIP LOCKED` |
| The name and phone erased, every sum kept | `customer_credit.customer_name`, `customer_phone`, `phone_digits` set to NULL with `customer_erased_at`; the ledger and the sums untouched |
| On the customer's request, by the owner | `POST /credits/{id}/erase-customer`, `credit:erase_customer` (the owner's role): the network's owner erases every closed debt of the network under the same phone, a store's owner every closed debt of that store; an open debt refused, `STILL_OWED`; «Стерти дані покупця» on a closed debt |
| A write-off's reason erased with the name | `credit_entry.note` set to NULL in the same transaction; the reason no longer copied into the audit log |
| The hint | `shared/NoCustomerData`: «Без імен і телефонів покупців.» under ten fields (ADR-0015 §7) |
| The owner's copies kept 3 months | `infra/pull-backups.sh` deletes the nights older than 3 months on every run, keeping the newest night that can be restored; a run that could not reach the server or found a damaged copy still deletes by date, then fails saying why |

**What the database guarantees** (`0038`, ADR-0015 §3): a customer whole or
erased whole; never an open debt erased; an erasure never undone, moved or
reassigned (trigger); the debt's ledger append-only but for an erased
customer's write-off reason going to NULL, every other column the same.

**In «Борги»:** an erased debt reads «Покупця стерто», with «Ім’я й телефон
стерто <дата>. Суми лишаються.», no phone link, its sums and history; a
write-off's line reads «причину стерто разом з даними покупця». It is found
by neither name nor phone and stands alone as a card, «Відкрити борг
(покупця стерто) від …». After the owner's erasure the app says how many
closed debts lost the customer, and how many are still open: those keep the
customer, and are erased the same way once closed.

## Verification

On the laptop, in the isolated environment (PostgreSQL 16.2), 2026-10-09:

- **Migration `0038`:** up, down to `0037` and up again; `alembic check`
  clean. Its downgrade refuses once a customer is erased, and changes
  nothing (`test_0038_goes_down_only_while_no_customer_is_erased`).
- **Backend:** the full suite, 3 296 passed, 1 skipped, before the review's
  fixes; then the touched files again. New: `test_customer_erasure.py` (19
  tests: the terms to the second, 29 February, batches and a held debt, the
  owner's erasure across stores and spellings of a phone and not another
  network, a store owner's within their store, every refusal, the reads after, a return after, each database
  guard, the race of the two erasures, the watcher erasing as it starts,
  the downgrade), `test_pull_backups.py` (10, 7 new), the watcher's job, the
  role matrix.
- **E2E:** the touched specs, 51 journeys, on a phone profile against the
  real API: the owner erasing, «Скасувати», the erased card and its search,
  a written-off debt's reason, a store's owner erasing in their store, no
  button without the permission or on an open debt, and the hint as each
  field's description and not its name.
- **Mutation testing,** each mutant alone, its file restored and the tree
  compared with a checksum after:
  - 27 in the server (terms, boundaries, locking, the eraser, open debts,
    permissions, spellings, networks, grouping, search, the audit, batches,
    the commit, the watcher, the downgrade, and after C-c a store owner's
    reach and refusal): all caught, two after tests were added (the flat
    list's search; a refusal before any debt is looked for);
  - 8 in the database's guards, each in a scratch database of its own, with
    an unchanged control that passed: all caught;
  - 10 in the collector: all caught;
  - 14 in the screens, each after a fresh E2E database, with an unchanged
    control that passed: all caught.

The whole of CI, run locally: below.

## Review (2026-10-09)

Two independent reviewers, one on the server, the database and the
collector, one on the owner's rules, the screens and the documents. No
blocker. Every finding was fixed or answered:

| Finding | What was done |
|---|---|
| The collector kept the newest night of any kind: a server whose encryption kept failing sends manifests alone, and the last night that can be restored would have gone | **Fixed:** the newest night whose archive is whole is kept; test |
| One copy damaged on the owner's computer is never collected again, and "delete nothing on a damaged run" would have stopped deleting for good; a server out of reach kept every old copy too | **Fixed:** deletion by date on every run, which then fails saying why; the runbook says what to do with a damaged copy; tests |
| `list_customers` could fail when a customer is erased between its two reads | **Fixed:** such a customer is left out of that page |
| The app told the owner that the customer's open debts lose the name once closed; they keep it until their term or the owner's next erasure | **Fixed:** both texts say so; ADR-0015 §5 |
| A payment or write-off checked after the owner erased the customer showed an empty name | **Fixed:** «Покупця стерто» |
| «До списку боргів» during an erasure; other stores' lists kept the name until reloaded | **Fixed:** disabled while sending; every store's debts reread |
| A written-off debt's reason disappeared without a trace | **Fixed:** «причину стерто разом з даними покупця» |
| The cash note had no hint; the docs and the fields disagreed | **Fixed:** the hint under cash taken out or put in; one list of the ten fields everywhere (reading C-d) |
| Where else data lives: the orders' and debts' journals on the phone, a write-off's fingerprint, a drawer difference's reason in Telegram | **Documented:** ADR-0015 Context and Consequences, known risks |
| The runbook's "erase again after a restore" could not be followed | **Fixed:** the audit log query and how the owner finds each customer |
| «До 5 000» written as "under 5 000" | **Fixed:** "at most 5 000", the caveat kept |
| README, the milestone, two older documents saying nothing is deleted, ADR-0010's citation | **Fixed** |
| Tests missing: another network with the same phone, the reason erased on request, the downgrade's refusal, a deterministic race, an erasure far in the future touching other tests' debts | **Added** |
| A failing erasure reaches Sentry, not the owner | **Recorded** in known risks |

**Answered by the owner's own choice, not readings.** A written-off debt is
erased on request, and the reason goes with the name: the option the owner
chose said so in its description («Сплачені, повернені й списані борги
стираються одразу…», «Причина списання боргу стирається разом з ім'ям
покупця»). The business rules now quote each option's description.

**Four readings, asked at the end** (business rules, C-a to C-d): the
request reaching the whole network by phone, an open debt keeping the
customer once it closes, and the fields with the hint were confirmed as
built. **C-c was changed by the owner:** a store's owner erases too, in
their own store; built the same day, with its tests and mutants.

## Where the build departs from the design

None so far.

## Risks

In [known risks](known-risks.md), "Customers' data — 2026-10-09": older
backups for up to 3 months; a restore and an erasure on request; the
command fingerprints; free text; the seller's phone; one phone, one
customer; the terms as constants; the hourly erasure and a watcher that is
down.

## What is not done

- **The owner's computer running today's collector** (release checklist
  row 19). Until it does, its old copies stay.
- **A real server.** Nothing here has run on one.
