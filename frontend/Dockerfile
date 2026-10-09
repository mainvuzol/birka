# Builds the Mini App bundle and copies it into a volume that Caddy serves.
# Each base by its digest, the multi-arch index CI built from (Node 24.21.0
# here, the one CI's frontend jobs set up): a tag is rebuilt in place now and
# then. To move one, see the server runbook, "a pinned version, changed on
# purpose".
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
# Copy the lockfile too: npm ci requires it and installs exactly that tree.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# .dockerignore keeps a developer's node_modules, dist and test output out of
# this copy, so it cannot land on top of the tree npm ci just installed.
COPY . .
# The build's version, its git commit (infra/docker-compose.yml passes it):
# Vite writes it into the bundle, which names it on the crash screen and in
# the note a broken screen sends. Only this stage needs it, and only after
# `npm ci`, so a new commit does not reinstall the packages.
ARG BIRKA_RELEASE=dev
RUN npm run build

# Alpine 3.20's support ended in spring 2026; 3.22 is supported until 2027.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
COPY --from=build /app/dist /dist
# Source maps would hand anyone the app's source with its comments; nothing
# reads them (vite.config.ts no longer writes them; this is the backstop).
# The page is kept apart: it is published last, on its own.
RUN find /dist -name '*.map' -type f -delete \
 && mv /dist/index.html /index.html

# The compose `web` service runs once and exits; Caddy serves from the volume
# while this runs, so nothing may disappear or be half-written under it:
#  1. Every file of the new bundle is written beside its name and renamed into
#     place, so Caddy never serves half a file (a half file of the year-long
#     cached /assets would stay broken on that phone).
#  2. The previous bundles' files stay: a page opened before the update still
#     asks for them. The files the outgoing page names are dated now, first,
#     so they count from the moment they are replaced, however long they were
#     live; republishing a file refreshes its date too.
#  3. The page goes last, by rename, so it never names a file not yet there.
#  4. Files replaced or unpublished for 30 days are dropped: far longer than a
#     12-hour session, so no open app still needs them. Any source map an older
#     bundle left behind goes too.
CMD set -eu; \
    mkdir -p /output/assets; \
    if [ -f /output/index.html ]; then \
        grep -o 'assets/[^"]*' /output/index.html | while IFS= read -r file; do \
            if [ -f "/output/$file" ]; then touch "/output/$file"; fi; \
        done; \
    fi; \
    cd /dist; \
    find . -type f | while IFS= read -r file; do \
        mkdir -p "/output/$(dirname "$file")"; \
        cp "$file" "/output/$file.publishing"; \
        mv -f "/output/$file.publishing" "/output/$file"; \
    done; \
    cp /index.html /output/.index.html.publishing; \
    mv -f /output/.index.html.publishing /output/index.html; \
    find /output/assets -type f -mtime +30 -delete; \
    find /output -type f -name '*.map' -delete; \
    echo 'web bundle published'
