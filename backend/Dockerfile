# The Python CI and the local checks run on, to the patch release: a floating
# `3.12-slim` would change it under the server at its next build, untested.
FROM python:3.12.14-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so a code change does not reinstall the world. Exactly
# the versions CI tested (requirements.lock), and nothing they did not ask
# for: --no-deps, so a package missing from the lock fails `pip check` here
# rather than arriving at whatever version PyPI has that day. The project
# itself is not installed: the code is copied below and imported from /app.
COPY requirements.lock ./
RUN pip install --no-deps -r requirements.lock && pip check

COPY app ./app
COPY migrations ./migrations
COPY scripts ./scripts
COPY alembic.ini ./

# Run as a non-root user: a container that can rewrite its own code is a
# larger blast radius than it needs to be.
RUN useradd --create-home --uid 10001 birka && chown -R birka:birka /app
USER birka

EXPOSE 8000

# Migrations are NOT run automatically on boot: a production migration is a
# human-approved step (.ai/policies/tool-permissions.md, level 3).
#
# Behind Caddy every request arrives from Caddy's address. The proxy headers
# give the app the address Caddy was reached from, which the sign-in limit
# counts by. Trusting them from any sender ('*') is safe only because nothing
# but Caddy can reach this port: infra/docker-compose.yml exposes 8000 on the
# compose network and never publishes it, and Caddy, which trusts no proxy in
# front of it, replaces any X-Forwarded-For a client sends with the address
# it saw.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]

# Backups and restore drills (.ai/project-memory/backup-restore-runbook.md).
# The same code, plus the PostgreSQL client tools of the server's major
# version: pg_dump refuses a newer server, and the distribution's own client
# may be older than 17. From the PostgreSQL project's apt repository, set up
# by the script and key that postgresql-common itself ships. And `age`, which
# encrypts each copy to the owner's public key (owner decision, 2026-09-30).
FROM base AS ops
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-17 age \
 && rm -rf /var/lib/apt/lists/*
ENV BIRKA_PG_BIN=/usr/lib/postgresql/17/bin
USER birka
# What the schedule runs: back up, drill, encrypt, keep what the owner keeps.
CMD ["python", "-m", "scripts.nightly_backup", "--out", "/backups"]

# The API. Last, so it stays the target a plain `docker build` produces.
FROM base AS api
