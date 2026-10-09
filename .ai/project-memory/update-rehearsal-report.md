# A new version, and going back, rehearsed — 2026-10-09

Baseline: `fb567b8` (restoring for real rehearsed, merged as PR #76).
Status: rehearsed end to end on a laptop, in Docker; two findings and one
missing sequence, all three now in the server runbook
([evidence](../../output/verification/2026-10-09-update-rehearsal/rehearsal.md),
the first run beside it).
Branch: `docs/update-rehearsal`.

## Why this was next

With PR #76 merged, the owner chose it on 2026-10-09. The server runbook's
"a new version" and "going back" had never run, and the restore rehearsal
had just found two faults in a runbook that had never run either.

## How

One server (Compose project `birka-rehearsal-update`) ran from its own git
checkout, a local clone standing for `/srv/birka`, installed at #74
(`6867576`, schema `0037`), seeded and used through Caddy and the real API:
a model received 10, three sales, two in parts (one paid off, one still
owed). Then, with the runbook's commands as written, in a shell that has not
read `.env`:

1. **A new version**, to `fb567b8` (main, `0038`), the runbook's block
   whole: a backup first, fetch and checkout, the release exported, the
   build, the migration, `up -d`, the readiness check.
2. **Going back, 2:** `0038`'s downgrade while no customer was erased, then
   the old code; then updated again.
3. **Going back, 1:** the old code alone, once the owner had erased a
   customer on request; then fixed forward.
4. **Going back, 2 again:** the downgrade asked once a customer was erased.
5. **Going back, 3:** everything, from the backup taken before the update,
   on the same server.

Two stand-ins, named in the log: the checkout lives under
`~/.cache/birka-runtime`, not `/srv/birka`; and `docker compose build` is
replaced by `make-images.sh`, which puts each release's backend code over
the images built here, since a build would fetch base images from Docker Hub.
The web bundle stayed the newest release's. The image prune was not run: on
this Mac it would reach other projects' images. Everything started was
removed, and Docker stopped as it was found.

## What held

- **The update:** `0037 → 0038` migrated, the API ran `fb567b8`, and stock
  (7) and sales (3) were what they were.
- **Going back by the downgrade, while lossless:** the schema went down to
  `0037`, the old code ran on it with the same stock and sales, and the
  customer paid off still read by name; updated again cleanly.
- **The downgrade once a customer was erased:** refused, «A customer has
  been erased; 0037 cannot hold a debt without one», and the schema stayed
  `0038` with the new code running.
- **Going back whole on the same server:** the state before the update came
  back exactly: `0037`, stock 7, sales 3, the erased customer named again.

## Findings, and what changed

| Finding | Fixed |
|---|---|
| **The readiness check failed straight after `up -d`.** Caddy answers 502 for the few seconds the API takes to start, so `curl -fsS …/ready` failed in both runs, the first stopping there: an administrator would read a failed update. The first install's `curl` after `up -d` is the same. | `curl --retry 30 --retry-delay 2 --retry-all-errors`, in "a new version" and at the first start. |
| **Going back by the code alone across `0038` breaks «Борги» once a customer is erased.** The old code cannot read a debt with no name: «Борги» with everyone, the debts' list and the erased debt answer 500; who owes, an open debt and the till still work. It also copies a write-off's reason into the audit log again. The runbook listed `0035` and `0036`, not `0038`. | A bullet for `0038` under "the code alone", one under "code and schema" for its downgrade, the order of a downgrade (with the new code, before the checkout), a note at the update itself; known risks, ADR-0015. |
| **Going back whole said only "follow restoring for real"**, which needs an empty database on a new server; on the same server nothing said how to empty it, nor to keep the state being left. | The same-server sequence: a backup of the state being left, the previous release's code, the API and the watcher stopped, the database's container and volume removed, the restore through the database's container, `up -d`. Rehearsed. |

## Not rehearsed

- `docker compose build`, and the image prune (above).
- A phone with the app open across the update; the old page against the new
  API, and the new page against the old.
- The bot's message when the API does not answer for the minutes an update
  takes: the watcher's threshold is 5 minutes, and the update here took
  under one.
- A release whose migration takes long on years of data.

## CI

Only documents changed: no code, script or test. The rehearsal's driver is
kept beside the evidence, not in the repository's code.
