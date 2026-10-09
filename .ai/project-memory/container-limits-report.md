# What a container may do — 2026-10-09

Baseline: `4954b3f` (the app's own database role, merged as PR #79).
Status: built, measured, reviewed and rehearsed: the whole CI run locally
passed, and a first install, an update from main, going back and a restore
onto a new server held under the limits, on a laptop in Docker.
Branch: `feat/container-limits`. Decision: [ADR-0017](../decisions/ADR-0017-what-a-container-may-do.md).

## Why this was next

On 2026-10-09 the owner chose three of the risks left before the public
domain, in this order: the app's own database role (PR #79), this one, and
the catalogue's text shown safely. Every container ran with Docker's
defaults: a writable image, the kernel privileges Docker gives every
container, and no memory limit.

## What exists now

- **Every service is read-only**, the one-off `ops` and `web` too. What each
  writes goes to its volumes, or to a small `/tmp` held in memory.
- **No kernel privilege but the one used**, and none gained by running a
  program (`no-new-privileges`):
  - PostgreSQL keeps five for its entrypoint's start as root (`CHOWN`,
    `DAC_READ_SEARCH`, `FOWNER`, `SETGID`, `SETUID`);
  - Caddy keeps `NET_BIND_SERVICE`, for ports 80 and 443;
  - the API and the watcher hold none at all, and run as their own user.
- **A memory limit each**, swap included, from measurement: at least about
  2.5 times the most each reached under the heaviest work.
- **Never privileged**, nor sharing the host's processes or network.
- **In CI** the `edge` job checks each container as Docker runs it, and the
  restore drill runs the night's backup, its drill and the watcher held as
  compose holds them; a test keeps the two equal.

## How it was found and measured

All in Docker on this Mac, in a project of its own, its containers cut off
from the internet, the images built here (nothing pulled):

- **What each service needs.** The stack was started with every limit and
  used as the runbook does: the migration and `scripts.app_role` from
  `ops`, the start, the bundle published, the night's backup with its drill,
  and the watcher's status.
  - Writing into any image was refused ("Read-only file system"); `/tmp`
    took a write.
  - The API and the watcher held no capability (`CapEff 0`); Caddy only
    `NET_BIND_SERVICE`; PostgreSQL's server none, its bounding set the five
    above. All had `NoNewPrivs: 1`.
  - PostgreSQL with only `CHOWN`, `FOWNER`, `SETGID`, `SETUID` could not
    read its data directory and never became healthy; with
    `DAC_READ_SEARCH` beside them it started, restarted, and answered.
    `DAC_OVERRIDE`, which a first trial used, is not needed.
- **Memory** ([evidence](../../output/verification/2026-10-09-container-limits/)),
  `docker stats` read every second.
  - The work, each in the service it runs in:
    - the hot path's load, six sellers at once, on an API of its own;
    - lists of 2 000, 5 000 and 10 000 answers approved, the app in process;
    - the night's backup and drill of the largest database that left.
  - The measuring scripts ran in a container of the API's image with its
    HTTP client added, held to the API's limits. The server's images do not
    hold that client (below).
  - Pass 1, every limit raised to 3 GiB, gave each peak. Pass 2 ran the
    same work under the chosen limits: nothing was killed, and the peaks
    were the same.

| container | peak, pass 1 | peak, pass 2 | limit |
|---|---|---|---|
| database | 256 | 233 | 1 GiB |
| the app approving lists | 300 | 298 | 768 MiB (the API's) |
| the API, six sellers | 234 | 233 | 768 MiB |
| the API at rest | 222 | 234 | 768 MiB |
| the watcher | 191 | 190 | 512 MiB |
| `ops`, backup and drill | 181 | 196 | 512 MiB |
| Caddy | 21 | 19 | 256 MiB |

The approvals passed at 2 000 and 5 000 answers (at most 8.4 s). At 10 000
the approval was refused, as measured before (ADR-0014 §10): the
reservations' read fails at about 6 500 answers, a limit of PostgreSQL's,
not of memory.

## Findings

- **The API and the watcher take about 220 and 190 MiB at rest.** The first
  limits written, 512 and 256 MiB, would have left the watcher a quarter
  of its limit to spare; it got 512.
- **The runbook's "hot path on this server" could not run.** Its harness
  needs `httpx`, which only the tests install; the server's images hold the
  app's locked packages alone. The runbook and the hot path report now say
  so, and that the reading stays the laptop's and CI's.

## Review of the built change

An independent review (2026-10-09) found nothing that stops the stack, the
backup or a restore, and these gaps, all closed:

| Finding | Fixed |
|---|---|
| **The night's backup and the watcher never ran with the limits in CI**: the restore drill runs them by `docker run`, and the `edge` job does not start the watcher. A write somewhere new in them would pass CI and fail at night. | The restore drill holds them as compose does; a test keeps CI's settings equal to compose's. |
| **`privileged: true` would have passed** the test and the `edge` job, and given a container every privilege back; so would the host's processes, IPC or network, devices, another user. | The test refuses each of those keys; the `edge` job reads `Privileged`. |
| **Swap doubled every limit** on a server with swap. | `memswap_limit` equal to each limit, pinned. |
| Only "some" `/tmp` mount was checked, so a mount making the code writable would pass. | Every service's mounts pinned in full. |
| The runbook's signs missed a database backend killed (the container stays up), the night's log, and a full `/tmp`. | Named, with the kernel's own log. |
| Caddy, root without root's privileges, can no longer read a Caddyfile only its owner may. | The runbook's step 1 says to check it. |
| Smaller: the "2.5 to 4 times" said of Caddy (12 times), the checklist's server reading, the `edge` check passing on any failed write, `psql`'s history in a read-only container. | Reworded; the check needs "Read-only file system"; the restore's step 7 says the warning is harmless. |

## Evidence

- **Tests:** `test_server_image.py` pins every service's settings:
  - read-only, every privilege dropped, none gained;
  - the privileges kept;
  - none of the keys that give everything back;
  - each service's mounts in memory;
  - the measured limits, swap included;
  - CI's settings for the backup and the watcher, equal to compose's.

  Ten mutants of compose and CI, each caught.
- **Measurement** ([evidence](../../output/verification/2026-10-09-container-limits/),
  the driver and its compose files beside it): the two passes above.
- **CI, run locally at `98afbd8`** ([summary](../../output/verification/2026-10-09-container-limits-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 308 on PostgreSQL 17;
  - restore drill: 7/7, the night's backup, its drill and the watcher held
    as compose holds them;
  - e2e: 264 journeys;
  - edge: 9/9, each container as Docker ran it: not privileged, read-only,
    `[ALL]` dropped, only its own kept, its memory limit; the API's
    `CapEff` 0;
  - hot path: worst p95 66.9 ms and 71.2 ms.
- **Rehearsals** ([evidence](../../output/verification/2026-10-09-container-limits-rehearsal/), drivers beside it):
  - **A first install by the runbook, steps 3 to 10, under the limits.**
    Every container was checked as Docker ran it, and a write into the
    API's image was refused. The people, the night, the watcher's incident
    (the API stopped 6 minutes, then started), the stock list and the check
    all held.
  - **An update from main** (`4954b3f`, no container held) to `98afbd8`.
    The containers came back held, on the volumes the old ones left, and
    the data stayed. A sale, a payment, an erasure, the people's and
    stores' commands, the night's backup with its drill and the watcher all
    worked under the limits.
  - **Going back by the code alone** to main: the containers were not held
    again, the data the same. Forward again: held.
  - **A restore onto a new server**, every container held: the restore
    through the read-only database container. Then the role's rights, and
    the night's stock and sales back, with a new sale.

Everything started was removed, and Docker stopped as it was found. The
containers had no way out of their network.

## Not covered here

- No process-count limit (ADR-0017, "Rejected").
- Caddy and `web` run as root, without privileges; PostgreSQL's entrypoint
  starts as root.
- The heaviest work was measured once, on this Mac in Docker (arm64), not on
  the server; CI's `edge` job runs the stack under the limits, but not that
  work.
