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
