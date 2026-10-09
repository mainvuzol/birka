# What the server is built from, named exactly — 2026-10-10

Baseline: `6136cfe` (text from outside, merged as PR #81).
Status: TODO(final).
Branch: `chore/pinned-build`. Decision: [ADR-0019](../decisions/ADR-0019-what-the-server-is-built-from.md);
owner: business-rules.md, "what the server is built from" (2026-10-10).

## Why this was next

After the three risks chosen on 2026-10-09 were closed (PRs #79 to #81), the
owner chose two more from what needs neither a server nor a person: this
first, then a request limit per person. The risk register said the images
float, the actions are pinned by tag and the Python lock has no hashes; and
GitHub moves `ubuntu-latest` to Ubuntu 26.04 from 2026-10-19
(runner-images, announcement 14748).

## What was found

- **Five images by tag:** `postgres:17-alpine` and `caddy:2-alpine` (compose,
  CI's four PostgreSQL services, the edge job's Caddyfile check),
  `node:24-alpine` and `alpine:3.22` (the web image), `python:3.12.14-slim`
  (the API's and the backups' images). Read on Docker Hub on 2026-10-10:
  `caddy:2-alpine` already named a newer build than the one every check had
  run since 2026-10-02; the other four tags still named the tested image.
- **Four actions by tag,** 17 uses: `checkout@v4`, `setup-python@v5`,
  `setup-node@v4`, `upload-artifact@v4`.
- **Seven jobs on `ubuntu-latest`;** CI's Python was `"3.12"` (the runner's
  newest 3.12, not the image's 3.12.14) and its Node `"24"`.
- **Both locks without hashes,** 43 and 71 pins.
- The bundle's packages were already pinned by hash (`package-lock.json`'s
  `integrity`, installed by `npm ci`).

## What exists now

- **Every image by its digest,** `name:tag@sha256:…`, the multi-arch index
  (each serves linux/amd64 and linux/arm64), and the one every check ran:
  the images in the local store and the bases in the build cache.

  | image | release | digest |
  |---|---|---|
  | `postgres:17-alpine` | 17.11 | `b0f9560a…` |
  | `caddy:2-alpine` | 2.11.6 | `881bbc60…` |
  | `python:3.12.14-slim` | 3.12.14 | `f77ac9e4…` |
  | `node:24-alpine` | 24.21.0 | `ebfe2f90…` |
  | `alpine:3.22` | 3.22 | `5291449c…` |

  One digest per tag in every file: compose, the dev compose, CI's services,
  the edge job's check, the Dockerfiles.
- **Every library by its files' hashes:** the locks hold the sha256 of every
  file PyPI has for each version (1 520 and 1 942 hashes). The versions did
  not change. The image installs with `--no-deps --require-hashes`; CI does
  the same, then the backend alone with `--no-deps -e`, since pip checks no
  hash of an editable install. The README says the same for a developer.
- **CI named too:** every action by a commit with its release beside it
  (`checkout` v4.4.0, `setup-python` v5.6.0, `setup-node` v4.4.0,
  `upload-artifact` v4.6.2); every job on `ubuntu-24.04`; Python `3.12.14`
  and Node `24.21.0`, the images' own. GitHub publishes both for 24.04.
- **The runbook says how to move a pin** ("a pinned version, changed on
  purpose"): on a branch, with the whole CI; after a security release and
  every month or so. Caddy's newer build is the first candidate.
- **A test holds it** (`tests/unit/test_pinned_inputs.py`, and
  `test_dependency_lock.py` for the hashes).

## How it was built and proven

- **Digests:** read from the local image store and the build cache, then
  checked on Docker Hub (read only: manifests, no layer): each is a
  multi-arch index serving amd64 and arm64, and the Node, Python,
  PostgreSQL and Caddy releases were read from their configurations.
- **Hashes:** `uv pip compile --generate-hashes` with the current locks as
  constraints (`uv` already on this Mac, its cache under
  `~/.cache/birka-runtime`); the versions came out equal, and every pin's
  hashes equal PyPI's list of that version's files, all 71.
- **The images rebuilt** with network, inside Docker only (owner,
  2026-10-10): the API image installed the 43 locked libraries by hash; the
  backup image holds pg_dump 17.11, `age` 1.2.1 and Python 3.12.14. The web
  image built with its downloads blocked: every layer came from the cache
  through the digest-pinned bases.
- **Only a file the lock names is installed:** in the API image, one lock
  line, `aiofiles`, four ways. As locked, the wheel was installed. With the
  wheel's hash changed, pip never took the wheel: it installed the other
  file the line names, the source archive. With both hashes changed it
  refused (“THESE PACKAGES DO NOT MATCH THE HASHES”), and a line without a
  hash was refused in `--require-hashes` mode.
- **Mutation:** twenty-five ways of loosening a pin, one at a time, each
  caught: nineteen first, six more after the review (below).
- **The local CI runner** learnt the pinned bases: a Dockerfile's digest
  must be in the build cache, and `docker image inspect` is given the full
  `docker.io/library/…` name, the only form of `name:tag@digest` it accepts.

## Review of the built change

An independent review (2026-10-10) found nothing that breaks CI on
`ubuntu-24.04`, the server's build, an update or going back. It checked the
action commits against their releases, Python 3.12.14 and Node 24.21.0 on
the runner, the five digests, hash mode with `--no-deps -e` and `pip check`,
pip-audit on the hashed lock, and the runbooks for any image by tag. It
found three things, fixed:
- **The README's install broke on Windows.** The locks are Linux's, so
  `uvloop`, which has no Windows build, came without a marker, and
  `colorama` was missing. Keeping the old `-c` form was no way out: a lock
  with hashes, given as constraints, turns hash mode on, and pip then
  refuses the unhashed `-e .` (tried in the API image, offline). Now the
  dev lock marks `uvloop` `sys_platform != "win32"` and holds `colorama`
  for Windows, as uv's Windows resolution has it; a dry run for Windows
  takes `colorama` and leaves `uvloop`, Linux and macOS the reverse, 71
  packages each, hashes required. The runtime lock is unchanged.
- **The test could pass with a pin loose:** a new service by tag, an image
  by Docker Hub's full name, a job's container, a `.yaml` workflow, a
  Docker action, or a Node release moved with its digest but not in CI.
  It now reads compose's and CI's images whatever they are, every
  Dockerfile base, every workflow file, and CI's Node against the release
  the web image's Dockerfile names; six mutants for these, each caught.
- **What CI still takes fresh was understated;** the list is now whole.

And two small ones: the runbook resolved an action by its moving major tag
(now by the exact release), and `.ai/project.md` named an install without
the lock.

## Evidence

TODO(final)

## Not covered here

- **The backup image's PostgreSQL client and `age`** come from apt at each
  build of `ops`, the newest within PostgreSQL 17 and Debian 13: the
  PostgreSQL project's repository keeps only its newest release.
- **A pin moves only when someone moves it.** A security release reaches the
  server through a change, not by itself.
- **Going back** to an older commit needs Docker Hub to still serve its
  digests: it does for official images, without a promise.
- **CI still takes some things fresh,** none of which the server's image
  holds: `pip-audit` and its dependencies, the `setuptools` that builds the
  backend's own package for `pip install -e`, the backend job's PostgreSQL
  17 client and `age` from apt, Playwright's Chromium and its system
  packages, and the runner image's own Docker, Compose and Buildx.
- **GitHub has not run this,** blocked by the billing hold: the pinned
  actions, `ubuntu-24.04` and the exact Python and Node are proven by the
  test and by GitHub's own lists, not by a run there.
- Once, with the images building beside it, a timing test of the backups
  (`test_a_tool_that_hangs_is_stopped_and_its_step_says_so`, a 0.5 s limit)
  failed in the unit suite; alone it passed three times, and the next whole
  run passed. Nothing it touches changed here.
