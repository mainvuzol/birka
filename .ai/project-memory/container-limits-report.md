# What a container may do — 2026-10-09

Baseline: `4954b3f` (the app's own database role, merged as PR #79).
Status: built and measured; TODO(final).
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
- **A memory limit each**, from measurement: about 2.5 to 4 times the most
  each reached under the heaviest work.

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

## Evidence

TODO(final)

## Not covered here

- No process-count limit (ADR-0017, "Rejected").
- Caddy and `web` run as root, without privileges; PostgreSQL's entrypoint
  starts as root.
- The heaviest work was measured once, on this Mac in Docker (arm64), not on
  the server; CI's `edge` job runs the stack under the limits, but not that
  work.
