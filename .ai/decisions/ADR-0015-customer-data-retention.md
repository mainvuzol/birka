# ADR-0015: How long a customer's name and phone are kept

Status: Accepted (2026-10-09). Built on `feat/customer-data-retention`; see
the [report](../project-memory/customer-data-retention-report.md).
Owner decisions: business-rules.md, "customers' data" (2026-10-09).
Extends: ADR-0010 §1 (personal data stays on the server) with how long a
customer's data is kept at all, and the rules of paying in parts
(2026-10-01) with its end. Amends: the backup runbook's retention (the
owner's own copies, which kept everything).
Builds on: ADR-0001 (module boundaries), ADR-0003 (a command's permanent
identity), ADR-0012 (the debt's ledger and the drawer).

## Context

A sale paid in parts records the customer's name and phone on its debt
(owner, 2026-10-01). Nothing ever removed them, so after going live they
would only pile up: in the database, in every backup, and on the owner's
computer, which kept every copy forever.

The owner decided on 2026-10-09 how long they are kept and what happens
then. Before this change, the only place a customer's name and phone are
stored was mapped:

| Where | What | Kept |
|---|---|---|
| `customer_credit` | the name, the phone and its digits | until now, for ever |
| `credit_entry.note` | a write-off's reason, where people write names | for ever, append-only |
| `audit_log.reason` of `credit.written_off` | the same reason, copied | for ever, append-only |
| the server's backups | all of the above | 7 days, and each month's first night 3 months |
| the owner's computer or NAS | the encrypted backups | for ever |
| the seller's phone | a credit sale not yet answered, in its journal | until it is resolved |

An order keeps no name, phone or address. A receipt, a refund, an order's
answer and the audit log leave them out (2026-10-01), and so do the logs and
Sentry (ADR-0010 §1). The answers kept for replays (`sale`, `order_command`,
`idempotency_record`) hold a debt's id and sums, never the name or phone.
Free text elsewhere, such as a return's reason, holds a name only if someone
types it there. What the review found beside these:

| Where | What | Kept |
|---|---|---|
| the seller's phone, the orders' journal | an order collected in parts, with its terms | until it is resolved |
| the seller's phone, the debts' journal | a write-off's reason not yet answered | until it is resolved |
| the command fingerprints | hashes of whole commands, a name, a phone or a reason among them | for ever (Consequences) |
| the owner's Telegram chat | a drawer difference's reason, sent by the bot (ADR-0012) | in Telegram, beyond the app |

## Decision

### 1. The terms (owner, 2026-10-09)

- **A debt paid or returned** keeps its customer's name and phone **a year**
  after it closed.
- **A written-off debt** keeps them **three years** after the write-off: about
  as long as a debt can still be claimed, which the owner checks with a
  lawyer, and long enough to see whom not to sell to in parts again.
- **An open debt** keeps them as long as it is open, then its term runs.

"A year after" is the same date and time a year later; 29 February is
28 February then (`erasure.years_before`).

### 2. What is erased

The name, the phone and its digits, set to NULL, and the write-off's reason
with them. **Every sum stays:** the agreed amount, every payment, return
and write-off, and the history's dates, ways and people. The drawer and
every report read the same as before. The debt reads «Покупця стерто», with
the date it was erased.

Deleting the debt was not offered: the drawer's periods, the sales report
and the returns read its ledger.

An erased debt:
- is found by neither a name nor a phone;
- stands alone in «Борги», its own card, never joined to the customer's
  other debts, since nothing says whose it was any more;
- still takes a return of its goods, which lowers or pays back as before.

### 3. What the database guarantees (`0038`)

- `customer_erased_at`, and `customer_erased_by_user_id` (the owner who
  erased on request; NULL when the term ran out).
- `customer_erased_whole`: the name, the phone and its digits, or none of
  them, exactly when erased.
- `customer_erased_when_closed`: an open debt is never erased.
- `customer_erased_by_when_erased`: an erasing owner only with an erasure.
- `customer_credit_stays_erased` (trigger): once erased, the erasure is never
  moved, reassigned or undone, so no name or phone can be written back.
- `credit_entry_guard`, in place of `credit_entry_append_only`: the ledger
  stays append-only and never deleted, with one exception. A write-off's
  reason may become NULL, nothing else in its row changing (every column
  compared as one JSON value, so a column added later is guarded too), and
  only once its debt's customer is erased. "A write-off says why" moves from
  the row's CHECK to the insert, where it still holds for every new row.
- `ix_customer_credit_kept_closed`: the closed debts still keeping their
  customer, by closing time, for the hourly erasure.

### 4. The term's erasure: hourly, in the watcher

`credit.erasure.erase_expired` runs once an hour in the `backup-watch`
service, beside the idempotency purge, and at once when it starts. It takes
500 debts a transaction, locked with `SKIP LOCKED`: a debt a return is being
taken on is skipped and erased an hour later. It logs only how many.

The watcher was chosen over the nightly backup job: it already runs the
hourly upkeep against the database, it is restarted by Docker, and a failure
reaches Sentry. A name past its term is erased within the hour, and so
leaves the next night's backup.

### 5. On the customer's request: the owner

`POST /credits/{id}/erase-customer`, under the new `credit:erase_customer`,
held by the owner's role (granted, like `credit:write_off`, to every role
that manages people). Its reach follows where the role is held (owner,
2026-10-09, reading C-c, changed by the owner from the network's owner
alone):
- **the network's owner**, holding it network-wide, erases the customer
  from **every closed debt of the network under the same phone** (C-a);
- **a store's owner**, holding it in one store, erases them from every
  closed debt of **that store** under the phone, asked from a debt of that
  store while it trades. The answer says which (`network`).

One phone is one customer (owner, 2026-10-01), so a couple sharing a phone
are one customer here too. Anyone holding the permission nowhere is refused
before any debt is looked for.

- Asked of an open debt, it is refused (`STILL_OWED`), and nothing changes.
- The customer's other open debts keep them. Once one closes, its own term
  runs, or the owner erases it again: nothing records that the customer
  asked, since that record would itself say who they are. The answer says
  how many are open.
- The network owner's reaches the debts of a blocked or archived store too,
  as the term's erasure does; a blocked store's own owner does nothing
  there, as in everything else.
- Asked again, it finds the customer erased and erases nothing. It needs no
  command id: the result is the same however often it is sent, so it is
  sent directly, not through the phone's journal.
- It locks the customer's debts, and the hourly erasure skips what is
  locked, so the two never both erase one debt.

In the app: «Стерти дані покупця» on a closed debt, for the network's owner,
and for a store's owner on their store's debts, with a confirmation that
says it reaches every closed debt of the network (or of this store) with
that phone, that the sums stay, and that it cannot be undone.

### 6. The audit log

Each erasure writes `credit.customer_erased` with who erased (NULL for the
term) and `{"by": "term"}` or `{"by": "request"}`: never a name or phone. A
write-off no longer copies its reason into the audit log. The audit log is
append-only, and the reason is kept on the debt's ledger, where it can be
erased. No shop database existed yet, so no audit row holds a reason.

### 7. «Без імен і телефонів покупців»

Under the fields where people explain something about a customer's purchase
or money (owner, 2026-10-09; which fields is reading C-d): a return's reason
(the till and an order), a debt's write-off, a drawer's difference, a
corrected way of paying, cash taken out or put in, where an order went
abroad (as it is sent, and corrected), and «Брак»'s notes, the one for the
supplier included. Ten fields in all. A shared hint
(`shared/NoCustomerData`) describes each field (`aria-describedby`) and
stays out of its name. Supplier, invoice, catalogue, store and stock notes
are not about a customer and have none.

### 8. The owner's copies: older than 3 months deleted

`infra/pull-backups.sh` deletes the nights older than 3 months, as the
server counts months (`nightly_backup.months_before`), after checking every
copy there against its checksum. It keeps the newest night whose archive is
whole, whatever its age, and touches only files named by a night's stamp.

It deletes by date on every run, also one that could not reach the server
or found a damaged copy, and then exits non-zero naming the trouble. Two
cases decided that (review, 2026-10-09):
- a copy damaged here is never collected again (`--ignore-existing`), so a
  rule of "delete nothing on a damaged run" would have stopped deleting for
  good; the run fails until someone deletes that night's files here, and it
  is collected again while the server has it;
- a server out of reach would have kept every old copy for as long as it
  lasted.

"The newest whole night" rather than the newest night: a server whose
encryption keeps failing sends manifests with no archive, and keeping the
newest of those would have let the last copy that can be restored go.

So, while the collector runs, an erased name leaves the owner's copies
within 3 months. While the server keeps a night past 3 months (its own
newest, or one it could not prune), each run collects it again and deletes
it again.

## Consequences

- An erased name stays in older backups for up to 3 months, on the server
  and on the owner's computer. Restoring such a copy brings back names that
  were erased after it was made. The term's erasure runs again within the
  hour of the restored server starting. **An erasure on request does not:**
  after a restore, the erasures asked since that night are read from the old
  database's audit log, when it can still be read, and made again; otherwise
  the owner repeats them from memory (runbook, "restoring for real"). From
  the newest night, that is at most a day of them.
- The collector deletes only when it runs: a computer that stopped
  running it keeps what it had. A copy the owner moved elsewhere by hand,
  outside the collector's folder, is the owner's to delete.
- A failing erasure is logged and sent to Sentry when it is on, as the
  idempotency purge is; it does not reach the owner's trouble messages.
- **A command's fingerprint is a hash of the whole command, the name and
  phone among them** (`sale.command_fingerprint`, the first payment's,
  `order_command.fingerprint`). It is kept so a retry is answered with what
  was done, however late (ADR-0003). It cannot be read back into a name, but
  someone holding the database and guessing the exact name, the phone and
  the rest of the command could confirm the guess. A write-off's fingerprint
  hashes its reason the same way. Replacing them would make a late retry a
  conflict; they are kept, and recorded as a risk.
- A credit sale, an order collected in parts or a write-off whose answer
  never came stays in the seller's phone, name, phone or reason included,
  until it is resent or resolved, as before.
- A drawer difference's reason reaches the owner's Telegram chat; the hint
  is under its field.
- Free text elsewhere is not erased. The hint asks people not to write names
  there.
- The terms are constants in `credit/erasure.py`. Changing one is a code
  change, and the owner's.

## Rejected

- **Deleting closed debts.** The drawer, the sales report and returns read
  the debt's ledger.
- **Keeping the name, erasing only the phone.** Offered; the owner chose
  both.
- **Erasing on request through the phone's journal.** The erasure is the
  same however often it is repeated, and is the owner's, online.
- **Running the erasure in the nightly backup job.** It runs once a night
  and in the `ops` image; the watcher already does the hourly upkeep.
- **Rewriting the command fingerprints.** See Consequences.
