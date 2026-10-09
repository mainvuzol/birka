# The app's own database role — 2026-10-09

Baseline: `65546f6` (the first install rehearsed, merged as PR #78).
Status: built; TODO(final).
Branch: `feat/app-db-role`. Decision: [ADR-0016](../decisions/ADR-0016-the-apps-database-role.md).

## Why this was next

With PR #78 merged, the backlog held nothing the owner had not yet to
decide, so the owner was offered the risks left before the public domain.
On 2026-10-09 the owner chose three, in this order: this one, the
containers' limits, and the catalogue's text shown safely.

The risk register said the API connects "as the owner of every table". It
was worse: the official PostgreSQL image's `POSTGRES_USER`, which the API,
the watcher and `ops` all used, is a **superuser**. Whoever took over the
API's process could have turned off the triggers that keep the ledger, the
audit log and an erased customer as they are, truncated any table, or run
programs in the database's container.

## What exists now

- **`birka_app`**, the role `api` and `backup-watch` connect as. It reads
  and writes rows, and `alembic_version` it only reads. It may not truncate,
  create anything, not even a temporary table, or alter, drop or disable a
  table or a trigger; it is no superuser, member of no role, and owns no
  table.
- **`python -m scripts.app_role`**, run from `ops` as the owner, gives it
  that, in one transaction:
  - creates it if missing, and sets its password from
    `BIRKA_APP_DB_PASSWORD`, sent as a SCRAM-SHA-256 verifier, never the
    password; resets what it may have set on itself;
  - takes back everything, from whoever gave it, then grants the rows of
    every table and of every table created later;
  - checks what it holds, right by right, and refuses, changing nothing,
    when another role gave it more than the owner can take back.

  It refuses a password under 32 characters or a placeholder, a run by
  anyone but a superuser, and a run before the first migration. Run again,
  it changes nothing.
- **Migrations run from `ops`**, the owner's container, everywhere the
  runbooks say to migrate. The API's own role cannot: an old command run
  from `api` is refused and changes nothing.
- **After a restore** the command runs again (backup runbook, step 5, now
  always): backups keep no rights, and on an empty volume the role does not
  exist. Without it, `/api/v1/ready` says the database does not answer,
  and the API's log names `InvalidPasswordError` (no role) or
  `InsufficientPrivilegeError` (no rights); the runbook's table of messages
  says to run the command for both.
- `.env` gains `BIRKA_APP_DB_PASSWORD`; compose refuses to start without it.

## Review of the built change

An independent review (2026-10-09) found two serious faults, one medium and
four small; all fixed:

| Finding | Fixed |
|---|---|
| **The role could still make temporary tables**, which PostgreSQL lets everyone make. The trigger functions name their tables without a schema, and a session finds its own temporary table first: a temporary `cash_close` would have stamped a sale into a drawer closed long ago, a temporary `customer_credit` let a write-off's reason be blanked on a debt never erased. | `TEMPORARY` and `CREATE` on the database taken from everyone but the owner; tests that the role cannot make a temporary table or a schema. |
| **The password test could not pass where passwords are checked**: a refused sign-in arrives as asyncpg's own `InvalidPasswordError`, not SQLAlchemy's error. Confirmed on a throwaway PostgreSQL asking for passwords. | It expects asyncpg's error, and never skips: on a cluster that trusts every connection it checks the verifier PostgreSQL keeps instead. |
| **The log's hint after a restore named the wrong error**: on an empty volume the role is missing, and the log says `InvalidPasswordError`. | The runbook, the ADR and the risk register name both errors. |
| The 16-character minimum let `.env.example`'s placeholder through. | 32 characters, a placeholder starting `change-me` refused, and the example's value left empty, which compose refuses. |
| Run before the first migration, it said `alembic_version` was read only when it was not. | Refused before the first migration. |
| What a role may set on itself (its password, its defaults), and memberships given by another role, were not all taken back; the ADR said more than held. | Defaults, expiry and connection limit reset; memberships revoked by their grantor; a final check of every right; the ADR says what the role still can. |
| Tests built `Settings` that could read a real `BIRKA_APP_DB_PASSWORD` from the shell. | They pass an empty one. |

## Evidence

TODO(final)

## Not covered here

- A compromised API still reads and writes every row the app can, the
  customers' names and phones among them.
- `ops` and the database's container hold the superuser's password. A table
  owner other than the superuser is a change of its own (ADR-0016,
  "Rejected").
- `birka_app` may still connect to the cluster's other databases, as any
  role may by default, where it holds no table; make large objects, which
  any role may; and change its own password and defaults until the command
  runs again.
- Local development and the backend tests keep one user, the owner.
