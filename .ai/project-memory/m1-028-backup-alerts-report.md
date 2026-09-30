# The owner hears about the backups (M1-028) — 2026-09-30

Baseline: `8d59454` (PR #43, the nightly backup and its restore drill).
Status: implemented and verified locally. One migration, `0018`, and one new
read endpoint, `GET /api/v1/backups`.
Branch: `feat/m1-028-backup-alerts`.

## Why this was next

PR #43 made a backup that proves itself. But a night that failed was written
only to `last-run.json` on the server, and a night that never ran — cron
broken — was written nowhere. The owner decided on 2026-09-30 (business-rules.md,
"backups"): "a failed backup or drill is shown to the owner in the app, in a
«Резервні копії» section only the owner sees, and sent by the bot in
Telegram, so it is not missed when nobody opens the section."

## What exists now

- **Each night is recorded in the database.** `scripts.nightly_backup` writes
  one row to `backup_run`, the only thing it ever writes there:
  - when the night ran, and whether it held;
  - the archive the owner collects, and its size;
  - the drill, and how long the restore took;
  - each failed step as `{step, detail}` — `backup`, `drill` (with its failed
    checks), `encrypt` or `key`.

  The database holds that a night is `ok` exactly when it has no problems. A
  night that cannot write its row fails, with the step `record`.
- **The `backup-watch` service** runs beside the app, restarted by Docker,
  not by cron: a schedule that stopped is exactly what it must notice. Every
  10 minutes it reads the newest night and decides:

  | State | When | Telegram |
  |---|---|---|
  | OK | the newest night held and ended under 26 hours ago | nothing; after a warning, one «✅ знову працює» |
  | FAILED | the newest night did not hold | once for that night, with what failed, in words |
  | OVERDUE | no night for 26 hours | once, then once a day while it lasts |
  | NOT_SET_UP | no night ever recorded | once a day until the first one |

- **Each message is recorded before it is sent** in `backup_alert`, unique
  by what it is about and to whom. However often the watcher looks, the
  same news is queued once. It is then sent at least once:
  - a sent message is `SENT`;
  - one Telegram refuses for good (the person never pressed «Start», or
    blocked the bot) is `REFUSED` and not tried again;
  - anything else is tried five times, then `FAILED`.

  Two watchers never send the same message at once: each is locked while it
  is sent.
- **Who is told:** everyone holding the new permission `backup:view`
  organization-wide. It is in the owner's default role, and migration `0018`
  grants it to every existing system `OWNER` role. A grant for one store does
  not count, in the API or for Telegram: a backup is of the whole server.
- **The section** «Резервні копії» appears only for that permission. Its
  tab is marked «⚠» whenever the state is not OK. It shows:
  - the state, and what failed, worded exactly as the Telegram message;
  - the last good copy;
  - the last 14 nights;
  - whether the last message reached the person reading, and if Telegram
    refused it, how to fix that («Start» in the bot's chat).
- **`python -m scripts.backup_watch --status`** prints the state and exits
  0 only if it is OK: for an operator, and for CI.
- **CI's `restore-drill` job** now also:
  - checks, from the API image, that the night it just ran reads as OK;
  - runs the watcher and stops it the way Docker does — SIGTERM to PID 1 —
    and fails unless it exits cleanly.

## Choices made here, not by the owner

The owner decided *that* a failed night reaches them in the app and in
Telegram. The following are how, chosen to be safe and easy to change:

- **26 hours** before a missing night counts as overdue: one night, and two
  hours for a slow or late one.
- **Reminders once a day** while a backup is overdue or was never set up.
- **A «✅ знову працює» message** after a warning, so the owner knows it is
  over.
- **"Never set up" is told**, daily. A server without backups is the worst
  case, not a quiet one.
- **At least once rather than at most once.** A duplicate warning is a
  nuisance; a missing one is what this exists to prevent.

**Decided by the owner on 2026-10-01:** every backup message is sent
**silently**, without a sound or a vibration, whatever the hour. The job runs
at 03:15, and a failed night must not wake anyone; the owner looks at the
section to see what went wrong (business-rules.md).

## Evidence

- **Backend: 1034 passed, 1 skipped** (the `age` test, run by CI). 41 are
  new:
  - 13 for the state and the words;
  - 9 for the Telegram client, one of them that the watcher sends silently;
  - 17 for recording, queuing, sending, the section and the migration;
  - 1 for the owner-only permission;
  - 1 freezing `0017`, which has shipped.
- **The Telegram client is tested against Telegram's own answers**, played
  through aiogram's response handling: 403 and «chat not found» are final,
  while 429, 5xx and a bad token are worth another try. The text goes as
  plain text, so nothing in it is read as markup, and the watcher's
  messages go with `disable_notification`.
- **E2E: 61 passed against the real API**, 5 of them new, on a Pixel 7
  profile. The seed gives the owner a failed night, two good ones and a
  message Telegram refused. The tests prove:
  - the owner sees all of that, with no sideways scrolling on a phone;
  - a seller holding every permission *for the store* has no tab, and the
    app never asks for the status;
  - the OK, OVERDUE and NOT_SET_UP states render as the words above.
- **The watcher, run for real**:
  - it refuses to start without a bot token;
  - `--status` exits 1 on an empty server;
  - it stops cleanly on SIGTERM.
- **Gates:** ruff, format, mypy and all 17 import contracts are clean, three
  of them new. `alembic check` reports no drift. The downgrade to base and
  back up is lossless. Frontend lint, types and build pass, with 0
  advisories.

**Mutation testing — twenty-four, twenty-four caught.**

| Mutation | Caught by |
|---|---|
| Exactly 26 hours counts as overdue | the boundary unit test |
| An overdue backup is told once, never again | the daily reminder tests |
| "Never set up" is told once ever | the once-a-day tests |
| «✅» after «✅» | the nothing-to-undo test |
| The same news queued twice | every queuing test |
| A grant for one store receives the message | the only-organization-wide test |
| A paused membership receives it | the same |
| A disabled account receives it | the same |
| A refused chat is tried again | the refusal test |
| A failing send is never given up | the give-up test |
| Messages are not locked while sent | the two-watchers test |
| Telegram's 403 is taken as worth retrying | the client's refusal tests |
| The message may be read as markup | the plain-text test |
| The watcher's messages make a sound | the silent-sender test |
| The section is open to anyone | the owner-only API test |
| A grant for one store opens the section | the same |
| A night that could not be recorded passes | the cannot-back-up test |
| The night is not recorded at all | the good, keyless and failed-drill nights |
| `0018` grants every system role | the migration test |
| The database lets a night be ok with problems | the constraint test |
| The last good copy is not looked for past the list | the overview test |
| The message leaves out what failed | the unit and integration message tests |
| The tab shows for a store's grant (frontend) | the seller E2E test |
| The tab is marked even when all is well (frontend) | the OK E2E test — after a fix |

The last one survived its first run: the test read the tab's label before
the state had arrived, when it is unmarked anyway. The test now reads it
once the verdict is on screen.

## Not verified here

- **Nothing has run on a production server**, and no message has gone to a
  real Telegram chat. The steps are in the
  [runbook](backup-restore-runbook.md): the service starts with the stack,
  and the owner must press «Start» in the bot's chat once.
- **The Docker parts run in CI, not here**, as in PR #43: the `backup-watch`
  service and the `--status` check in the images.

## Changed files

- `backend/app/modules/backups/` — new: models, the pure state and words
  (`status.py`), and the service.
- `backend/app/modules/telegram/messages.py` — new.
- `backend/app/api/v1/backups.py` — new; registered in `router.py`.
- `backend/migrations/versions/0018_backup_alerts.py` — new.
- `backend/app/modules/authz/{permissions,service}.py` — `backup:view` and
  `organization_wide_holders`.
- `backend/app/modules/identity/service.py` — `telegram_chats`.
- `backend/scripts/backup_watch.py` — new; `nightly_backup.py` records each
  night and its problems as `{step, detail}`.
- `backend/scripts/seed_orders_e2e.py` — the owner and their nights.
- `backend/pyproject.toml` — three import contracts.
- Tests:
  - `backend/tests/unit/test_backup_status.py`, `test_telegram_messages.py`
    and `backend/tests/integration/test_backup_alerts.py` — new;
  - `test_backup_restore_drill.py`, `test_authz.py` and
    `test_migration_history_is_frozen.py` — updated.
- `frontend/src/backups/` — new; `App.tsx` gains the tab, `orders/types.ts`
  gains `organization_permissions`, and `styles.css` the blocks.
- `frontend/e2e/backups.spec.ts` — new.
- `infra/docker-compose.yml` — the `backup-watch` service.
- `.github/workflows/ci.yml` — the status and watcher checks.
- ADR-0001 (the amendment), the runbook, the risk register, the milestone,
  the backup report and the README.
