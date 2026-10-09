# The first install, rehearsed — 2026-10-09

Baseline: `1903cfe` (an update and going back rehearsed, merged as PR #77).
Status: steps 3 to 10 of the server runbook's first install rehearsed on a
laptop, in Docker; every check held, and the runbook now says what the
rehearsal saw at step 4 and step 9 ([evidence](../../output/verification/2026-10-09-install-rehearsal/rehearsal.md),
the first run and the driver beside it).
Branch: `docs/install-rehearsal`.

## Why this was next

With PR #77 merged, the owner chose it on 2026-10-09. The restore and update
rehearsals had set up a server's database, its start, the owner and a
night, but none of the rest of the first install: the people, a store's
name, the administrators and the trouble the watcher records, the shops'
existing stock, and the check before the first day.

## How

One server (Compose project `birka-rehearsal-install`) from this checkout's
`infra/`. The runbook's commands ran as written, in `/bin/sh` from `infra/`,
in a shell that has not read `.env`. The API was used through Caddy, as a
phone would, signed in as the owner and a seller with the tests' fake bot
token.

- **Images:** made here earlier the same day, for #75's checks; the run
  pulled and built nothing. The API and ops images hold this checkout's
  backend code exactly (compared file by file). The web image was built at
  the same time, and the frontend has not changed since #75.
- **No way out:** the containers sat on an internal network. Caddy alone
  also joined a second network, to publish on this Mac's loopback. Nothing
  the watcher tried to send could leave, so no message reached Telegram.
- **Test secrets** made for the run, and kept out of the log.
- **Removed afterwards:** the containers, volumes, networks and the run's
  files; Docker stopped, as it was found.

The first run stopped at one check that was wrong, not the server (below);
the second ran whole.

## What held

| Step | What was done | What held |
|---|---|---|
| 3–4 | The database, the migration, `alembic check`, the start; health and readiness through Caddy | migrated to `0038`; ready (the readiness check retries, #77) |
| 6 | `seed_organization` with both stores' names; later `scripts.stores rename` on the owner's word | the owner sees both stores by their names, then the new name |
| 7 | A seller who opened the app before being added; `people grant` and `people list`; `people sign-out` for a lost phone | refused before, then works in `MAIN` alone; after the sign-out the old sign-in is refused (401) and the app opens again (200) |
| 8 | The first night by hand, and `--status` | `"ok": true`, the drill held |
| 8a.1 | `BIRKA_ADMIN_TELEGRAM_IDS` with an id and a part that is not a number | the watcher starts with one administrator |
| 8a.3 | `stop api` for 6 minutes 40 seconds, then `start api` | an incident open, «Сервер застосунку не відповідає.»; 90 seconds after the start it was closed, and the owner's «Резервні копії» showed it among the recent ones |
| 9 | The validator on a parser's file; the catalogue; «Новий список» from the file; every line answered; the approval; a paper sale; a delivery | the validator passes; a delivery waits while the list does (409); «Залишки» hold the list's 7 |
| 9 | A second opening list for the same warehouse, after the approval | started as a record; holds nothing back (a delivery is received); its approval refused (409); rejected |
| 10 | «Залишки» after everything; the sign-in's address in `docker compose logs api` | 9: the list's 7, less the paper sale, plus deliveries of 2 and 1; the API logs the address Caddy saw, not Caddy's own |

## Findings, and what changed

| Finding | Changed |
|---|---|
| **At the first start, the first `curl` met Caddy before its certificate**, in both runs: a TLS error on its first attempt, not the 502 the runbook named. The retry added the same day (#77) carried it, since `--retry-all-errors` retries that too. On a real server the certificate comes from the internet, and fails for a wrong `A` record or a closed port. | Step 4 names both causes, and where to look if the SSL error stays. |
| **Step 9 said "the warehouse takes no second list".** The first run read it as written, and expected a second list to be refused: it was started. The server is right and the screen says so: a list can be started, as a record, it holds nothing back, and its approval is refused because the warehouse has history (ADR-0005 §5). «Початкові залишки» then says to reject it and receive what is missing through «Приймання». | The runbook says what happens, and to reject it. |

## Not rehearsed

- **Telegram itself:** no message left the rehearsal's network. Not tried:
  - the bot's menu button (step 5);
  - «Start» pressed in the bot by the owner and the administrator;
  - the messages arriving, with a sound in the shops' hours or silently;
  - the outside check-in service (8a.2), and its half of 8a.3.
- **Step 10's address on a real server.** On Docker Desktop a published
  port arrives from the VM's gateway, so the address logged is a `172.…`
  one. What was shown is that the API takes the address Caddy forwards, not
  Caddy's own. That it is the phone's own is still for the server
  (release checklist row 16), with no `AAAA` record (public hardening).
- A real domain and certificate, a server's disk, cron and log rotation;
  steps 1, 2 and 8's cron and the owner's computer.
- A phone opening the app in Telegram, and a real count's files.

The restore and update rehearsals earlier the same day did not cut their
containers off: their watcher had the same fake bot token and may have
tried Telegram, which would refuse it. Nothing of the shop's was in those
servers.

## CI

Only documents changed: no code, script or test. The driver is kept beside
the evidence, not in the repository's code.
