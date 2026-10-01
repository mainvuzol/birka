# People: who works in which store (M1-028 release blocker) — 2026-10-01

Baseline: `c8c626e`, the empty shelf, merged as PR #48
([report](empty-shelf-report.md)).
Status: implemented and verified locally. No migration: the tables existed
since M1-008.
Branch: `feat/m1-028-people`.

## Why this was next

Preparing the server runbook for the release gate turned up a gap. **Nobody
but the bootstrap owner could ever use the app.**
- `seed_organization` creates one owner.
- No endpoint, screen or command gave anyone else a store, although
  `user:manage` had existed since M1-008.
- A seller who opened the app was refused, and was told their session had
  ended. That was untrue, and nothing they could do would help.

Gate M1D's exit criterion is "sellers can do the job in Telegram", so this
blocked the release. The runbook waited for it.

## The owner's decisions (2026-10-01)

Asked, not guessed; recorded in business-rules.md, "people".

- **A person is added on the server**, by a command the technical
  administrator runs, by the number of their Telegram account. There is no
  section in the app.
- **Only an owner decides.** The network's owner decides in any store. A
  child store's owner decides only in that store. A manager does not.
- **Either way out:** a person leaves one store, or is turned off in every
  store at once.
- **Each seller works from their own Telegram** (open question Q4, devices).

## What exists now

**The server command** (`backend/scripts/people.py`), run as
`docker compose run --rm --no-deps api python -m scripts.people …`:

| | |
|---|---|
| `list` | everyone, their stores and roles, and what was removed |
| `grant --store MAIN --role SELLER` | a role in one store; `--all-stores` for every store |
| `remove --store MAIN` | out of one store; `--all-stores` takes away a role held in every store |
| `deactivate` | out of every store of the organization at once |

- **Every change takes `--approved-by`**: the owner on whose word it is made,
  by their Telegram number. That owner must hold `user:manage` where the
  change applies, and every permission of the role given, replaced or
  taken away. So nobody gives more than they hold, which is how "a child
  store's owner, only in hers" holds.
- **The owner is the actor of the audit record**:
  - `people.granted`, `people.removed` or `people.deactivated`;
  - per membership, with what it was before and after.
- **A person need not have opened the app** to be added. They are known by
  the given `--name` until Telegram's own name replaces it at first sign-in.
- **Nothing is deleted.** A membership is turned off, and the next grant
  turns it on again.
- **The answer goes to stdout and the exit code says how it went:**
  - 0 when done, or when it was already so;
  - 2 when refused, with the reason on stderr.

The roles are the organization's own: `SELLER`, `MANAGER`, `OWNER`, or one an
owner composed.

**The service** (`app/modules/identity/people.py`):
- **One organization's changes are serialized under one advisory lock.**
- **The approver's authority is read once the lock is held.** A change that
  waited behind another cannot be made on the word of an owner that change
  removed.
- **A safety guard of our own:** a change is refused if it would leave nobody
  who manages people in every store, since no change could ever be approved
  again. A child store's owner does not count.
- **One organization per person** (assumption A2): someone working for
  another organization is refused, as their every sign-in would be.

**The app:**
- **Someone the shop has not added sees «Доступу ще немає»** and their
  Telegram number, to pass on. «Спробувати ще раз» lets them in once added.
- **The server answers `NO_ACCESS`** for a Telegram account with no active
  membership, instead of a generic authentication failure. Every
  `AuthenticationFailedError` caller still sees one, since it is a subclass.
- **Someone turned off mid-session** is told «Доступ до магазину закрито» on
  their next request, not that their session ended.

## Evidence

- **Backend: 1127 passed, 1 skipped** (the `age` test, run by CI). 14 new, in
  `tests/integration/test_people.py`:
  - an owner adds a seller, who then signs in;
  - an account without access is told so, and nothing is written;
  - granting again is "already so", and a new role replaces the old;
  - only an owner decides;
  - a child store's owner decides only in hers — the owner's own example,
    also a manager of the main store;
  - nobody gives or takes away more than they hold, through a role an owner
    composed;
  - leaving one store keeps the other;
  - turned off everywhere at once, history kept, and back by the next grant;
  - turning off is all or nothing;
  - the last owner of every store stays;
  - two owners removing each other at once leave one. One transaction is
    held open while the other waits for the lock;
  - unknown store, role and person, and a closed store;
  - one organization per person;
  - the server command itself, run as a subprocess against the database.
- **E2E: 83 passed against the real API**, 1 new. The real server command is
  run from the spec:
  - a stranger sees their number;
  - the stranger is added and let in;
  - turned off, they are told so, and the reload shows the number again.
- **Gates:**
  - ruff, format and mypy (106 files) are clean;
  - all 19 import contracts are kept. The service lives in `identity`, which
    may use `authz` and `tenancy`; `authz` may not use `audit`;
  - frontend lint, types and build pass.

**Mutation testing — 19 mutants, all caught (backend 16, frontend 3).**
- **The first run let two through:** no lock, and the authority read before
  the lock. The concurrency test used `asyncio.gather`, which never actually
  overlapped the two transactions. It now holds the first open, checks that
  the second is waiting, and commits. Both mutants are caught.
- **Caught, backend:**
  - anyone decides;
  - more than they hold;
  - a role replaced without authority over it;
  - the last owner removed, unchecked on grant, unchecked on deactivate;
  - no lock;
  - the authority read before the lock;
  - a closed store takes people;
  - two organizations per person;
  - a removed membership counted as already so;
  - remove or deactivate leaving them in;
  - an audit naming nobody;
  - no access answered as a lost session;
  - a refusal exiting 0.
- **Caught, frontend:**
  - no «Доступу ще немає» screen;
  - the number not shown;
  - a closed door read as a lost session.

## Not verified here

- **Nothing has run on a server.** The command is documented for Docker
  Compose and run here directly.
- **The approval is not authentication.** Whoever can run the command can
  name any owner, as whoever has the server can read the database.
  `--approved-by` is a record of whose word it was, checked against what
  that owner may do. The real lock is access to the server.
- **The owner cannot see in the app who has access.** That is the owner's
  choice; `list` on the server shows it.
- **`app_user.is_active` is still never set.** Turning off ends the person's
  memberships in this organization, not their account, which other
  organizations would share. Only one organization exists.
- **PostgreSQL 17 was not re-run locally.** CI runs every test on it.

## Changed files

- New:
  - `app/modules/identity/people.py`;
  - `scripts/people.py`;
  - `tests/integration/test_people.py`;
  - `frontend/e2e/people.spec.ts`.
- `core/errors.py` — `NoAccessError` (`NO_ACCESS`, 401).
- `authz/service.py` — raised for an account with no active membership.
- Frontend:
  - `src/App.tsx` — «Доступу ще немає», with the number;
  - `src/shared/telegram.ts` — `telegramUserId()`;
  - `src/shared/api.ts` — `NO_ACCESS` in `errorText`.
- Docs:
  - business rules;
  - the plan's Q4;
  - the risk register;
  - the milestone;
  - the README.
