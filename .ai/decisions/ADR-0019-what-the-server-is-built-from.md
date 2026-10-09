# ADR-0019: What the server is built from, named exactly

Status: Accepted (2026-10-10). Built on `chore/pinned-build`; see the
[report](../project-memory/pinned-build-report.md).
Owner decision: business-rules.md, "what the server is built from"
(2026-10-10).
Extends: ADR-0010 §5 (the locked libraries, the pinned Python). Closes: the
risk register's "a rebuild picks up new minor versions" and "the images
float, actions by tag, no hashes".

## Context

CI vouches for a commit. What the server builds from that commit was not
always what CI ran:
- **Images by tag.** `postgres:17-alpine` and `caddy:2-alpine` in compose,
  `node:24-alpine` and `alpine:3.22` in the web image's Dockerfile, and even
  `python:3.12.14-slim`, are tags. A tag is rebuilt in place now and then
  (a newer minor release, or a Debian fix underneath), so `docker compose
  pull` or a build on the server may take an image CI never started. By
  2026-10-10 `caddy:2-alpine` already named a newer build than the one
  tested on 2026-10-02.
- **Libraries by version only.** `requirements.lock` names each version,
  but a version is a name: a file replaced on PyPI, or on the way, would
  install unchecked.
- **CI by moving names.** `actions/checkout@v4` follows every v4 release;
  `ubuntu-latest` becomes Ubuntu 26.04 over 2026-10-19 to 11-19 (GitHub's
  runner-images, announcement 14748); `python-version: "3.12"` takes the
  runner's newest 3.12, not the image's 3.12.14, and `node-version: "24"`
  likewise.

## Decision

1. **Every image is pinned by its digest** (owner, 2026-10-10), as
   `name:tag@sha256:…`: the tag stays for the reader, the digest decides.
   - The digest is the multi-arch index, so an amd64 server and an arm64
     one take the same release. Each pinned index serves both (Docker Hub,
     read on 2026-10-10).
   - It is the digest CI and the local checks ran: the images in the local
     store and the bases in the build cache, not whatever the tag named on
     the day of pinning.
   - A name and tag carry one digest wherever they appear: compose, the dev
     compose, CI's services, the edge job's Caddyfile check, the
     Dockerfiles.
2. **Each library is pinned by its files' hashes.** Both locks hold the
   sha256 of every file PyPI has for each version; the versions are
   unchanged, and every hash was checked against PyPI's own list. The image
   and CI install with `--require-hashes`, so a file that matches no hash,
   or a line without one, fails the install. CI installs the backend itself
   after the lock, alone and `--no-deps`: pip checks no hash of an editable
   install, so it may not share the locked one's command.
3. **CI is named too:** every action by a commit, its release in a comment
   beside it; every job on `ubuntu-24.04`; Python `3.12.14`, the image's,
   and Node `24.21.0`, the one in the pinned `node:24-alpine`.
4. **A pin moves only on purpose**, on a branch, with the whole CI run: the
   server runbook's "a pinned version, changed on purpose" says how and when.
5. **A test holds all of it** (`tests/unit/test_pinned_inputs.py`, with
   `test_dependency_lock.py`): no image by tag alone, one digest per tag, no
   action by tag, a named Ubuntu, the images' Python and Node in CI, and a
   hash for every pin, installed by hash.

## Consequences

- A security release of PostgreSQL, Caddy, Python, Node or Alpine no longer
  reaches the server by itself: someone moves the pin. That is the point,
  and also the cost; the runbook asks for it after each security release and
  every month or so.
- Going back to an older commit brings back its images too, as long as
  Docker Hub serves their digests. It does for official images, without a
  promise.
- The backup image's PostgreSQL client and `age` still come from apt at its
  build, the newest within PostgreSQL 17 and Debian 13: the PostgreSQL
  project's repository keeps only its newest release, so pinning it would
  stop the build at the next one.
- CI still takes `pip-audit`, and the `setuptools` that builds the backend's
  own package for `pip install -e`, fresh. The server's image installs
  neither.
- The npm packages were already pinned: `npm ci` installs
  `package-lock.json`'s versions, each checked against its `integrity` hash.

## Rejected

- **Pinning to the tag's digest on the day of pinning.** For Caddy that
  would have put an image on the server that no check had started.
- **Platform digests** (one per architecture). The server's architecture is
  not chosen; the index serves both and still names one release.
- **Dependabot or Renovate pull requests** to move pins. No one is named to
  act on them yet (as in ADR-0010 §5).
- **Pinning the backup tools' apt versions,** or serving them from a snapshot
  of the repository: the first breaks at every PostgreSQL release, and the
  second is a mirror to keep for two packages.
