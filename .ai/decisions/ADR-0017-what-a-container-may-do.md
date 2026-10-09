# ADR-0017: What a container may do

Status: Accepted (2026-10-09). Built on `feat/container-limits`; see the
[report](../project-memory/container-limits-report.md).
Owner decision: chosen on 2026-10-09, after PR #78, second of the risks left
before the public domain (the app's own database role first, ADR-0016).
Closes: the risk register's "containers run with Docker's defaults: a
writable root filesystem, the default capabilities, no memory limits"
(ADR-0010, "before the public domain").

## Context

Every container ran with Docker's defaults. Whoever took over a process in
one could:
- write into its image: change the app's code, or leave a program behind
  that runs at the next start;
- use the kernel privileges Docker gives every container by default (to
  change file owners, send signals to any process, open raw sockets, and
  more), or gain more by running a program marked to grant them;
- take all the server's memory. A process that ran away by itself could do
  the same: the kernel then kills whatever it chooses, the database
  included.

What each service needs was checked in Docker on 2026-10-09:
- the API, the watcher and `ops` run as their own user (uid 10001), write
  nothing to their image (no bytecode: `PYTHONDONTWRITEBYTECODE`), and use
  no temporary file;
- `web` copies the bundle into its volume and exits;
- Caddy runs as root, writes only to its volumes, and binds ports 80 and 443;
- PostgreSQL's entrypoint starts as root: it reads the data directory,
  gives it and the socket's directory to `postgres`, and becomes `postgres`.

## Decision

### 1. Every service, the one-off `ops` and `web` too

- **A read-only image** (`read_only: true`). What a service writes goes to
  its volumes, or to a `/tmp` held in memory with a size of its own: 16 MB
  for the API, the watcher and Caddy, 64 MB for `ops` and the database.
  `web` writes only its volume.
- **No kernel privilege** (`cap_drop: [ALL]`) but the one it uses (§2).
- **None gained by running a program** (`no-new-privileges`).
- **A memory limit** (§3).

### 2. The privileges kept

- **PostgreSQL:** `CHOWN`, `DAC_READ_SEARCH`, `FOWNER`, `SETGID`, `SETUID`,
  for the entrypoint's start as root. Without `DAC_READ_SEARCH` it cannot
  read its own data directory; it is narrower than the `DAC_OVERRIDE` a
  first trial used (it reads and searches, never writes). The server
  itself, once it is `postgres`, holds none.
- **Caddy:** `NET_BIND_SERVICE`, to bind ports below 1024.
- **Everything else:** none.

### 3. Memory limits, from measurement

Measured on 2026-10-09 in Docker, the limits raised out of the way: the
most each container reached under the heaviest work Birka does. In MiB:

| | peak | under | limit |
|---|---|---|---|
| database | 256 | a list of 10 000 answers approved | 1 GiB |
| the API | 300 | the app approving lists of 2 000 to 10 000 answers | 768 MiB |
| the API | 234 | six sellers at once (the hot path) | |
| the watcher | 191 | at rest, as it always is | 512 MiB |
| `ops` | 181 | the night's backup and drill of the largest database | 512 MiB |
| Caddy | 21 | | 256 MiB |
| `web` | — | copying the bundle | 128 MiB |

Each limit is about 2.5 to 4 times its peak: a Python process grows over
weeks, and the database's figure counts the cache it may give back. They
are **ceilings for a process run away, not shares**: together they exceed
a 2 GB server's memory, and need not fit in it. The same work then ran
again under these limits (pass 2), and nothing was killed.

The API and the watcher sit at about 220 and 190 MiB at rest: a 2 GB
server holds the four long-running containers in about 650 MiB.

## Consequences

- A taken-over process can no longer change its image or gain a kernel
  privilege. Its volumes stay writable: the database's data, Caddy's
  certificates, the backups for `ops`.
- A process that runs away is killed at its own limit, and Docker restarts
  it (`unless-stopped`); the others keep their memory. The watcher tells of
  an API that stops answering (ADR-0011).
- A new release that needs more memory, or a write outside its volumes,
  fails here first: CI's `edge` job runs the stack with these settings, and
  checks each container as Docker runs it.
- PostgreSQL's five privileges, and Caddy's one, are what remains; Caddy and
  `web` still run as root, without privileges.

## Rejected

- **Process-count limits (`pids_limit`).** Not asked for; PostgreSQL opens a
  process per connection, so a limit is one more figure to keep right.
- **Running Caddy and `web` as a user of their own.** Their images run as
  root; with every privilege dropped but one, root inside them can do no
  more than that user could. A change of image, if wanted.
- **Limits read from `.env`.** One more setting per service; a larger server
  needs none of them changed, since they are ceilings.
