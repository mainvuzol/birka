# The app's own database role — 2026-10-09

Baseline: `65546f6` (the first install rehearsed, merged as PR #78).
Status: built, reviewed and rehearsed: the whole CI run locally passed,
and a first install, an update from main, going back and a restore onto a
new server held with the role, on a laptop in Docker.
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

- **Tests:** `tests/integration/test_app_role.py`, 17 tests. They give the
  role its rights as on the server, sign in as it, and try what it must not
  do. They also run on a database shaped otherwise and with a grant from
  another role, and check the verifier against the one PostgreSQL makes. A
  wrong password is refused where passwords are asked for. They passed on
  the local PostgreSQL 16, which trusts every connection, and on a
  throwaway PostgreSQL in the scratchpad that asks for passwords. One test
  in `test_server_image.py` pins who connects as whom in compose. Backend
  locally: 3 322 passed.
- **Mutation:** 36 mutants of `scripts/app_role.py` and the readiness log
  line, every one caught. On the way, five survivors showed the tests were
  hidden by grants an earlier run had left. The final check had looked
  unreachable until the review showed a right given by another role
  reaches it.
- **CI, run locally at `2701706`** ([summary](../../output/verification/2026-10-09-app-db-role-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 304 on PostgreSQL 17, which asks for passwords;
  - e2e: 264 journeys, the API as `birka_app`;
  - edge: the API `birka_app`, no superuser;
  - restore-drill: the watcher signing in as `birka_app`;
  - hot path: worst p95 68.9 ms and 127.6 ms.
- **Rehearsals** ([evidence](../../output/verification/2026-10-09-app-db-role-rehearsal/), drivers beside it):
  - **A first install by the runbook**, steps 3 to 10 as the install
    rehearsal ran them. The migration, its check and the command ran from
    `ops`; the API and the watcher connected as `birka_app`. The old
    downgrade from `api` was refused, the schema unchanged. The people's
    and stores' commands, the night, the watcher's incident, the stock list
    and the check all held.
  - **An update from main** (`65546f6`, the API a superuser) to `2701706`,
    `.env` given its new line first. The data stayed; the app worked as
    `birka_app`: a sale, a payment, a customer erased on request. Turning
    off the ledger's triggers from the API's own connection was refused,
    "must be owner of table credit_entry". The night was backed up.
  - **Going back by the code alone** to main: its API was the owner again,
    the data the same; forward again.
  - **Restoring for real** onto a new server from that night. Started
    before the command, the API was not ready, «database», and its log
    said `InvalidPasswordError`: on an empty volume the role is not there
    yet, as the review had said. After the command it was ready, as
    `birka_app`, with the night's stock and sales, the erased customer
    still erased, and a new sale.
  - The update and restore's first run stopped on two faults of the
    driver, not of the server; kept as `first-run.md`.

Everything the rehearsals started was removed, and Docker stopped as it
was found. The containers had no way out of their network.

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
