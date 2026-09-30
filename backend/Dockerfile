FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so a code change does not reinstall the world.
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

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
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Backups and restore drills (.ai/project-memory/backup-restore-runbook.md).
# The same code, plus the PostgreSQL client tools of the server's major
# version: pg_dump refuses a newer server, and the distribution's own client
# may be older than 17. From the PostgreSQL project's apt repository, set up
# by the script and key that postgresql-common itself ships.
FROM base AS ops
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*
ENV BIRKA_PG_BIN=/usr/lib/postgresql/17/bin
USER birka
CMD ["python", "-m", "scripts.backup_database", "--out", "/backups"]

# The API. Last, so it stays the target a plain `docker build` produces.
FROM base AS api
