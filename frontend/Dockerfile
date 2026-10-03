# Builds the Mini App bundle and copies it into a volume that Caddy serves.
FROM node:24-alpine AS build
WORKDIR /app
# Copy the lockfile too: npm ci requires it and installs exactly that tree.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# .dockerignore keeps a developer's node_modules, dist and test output out of
# this copy, so it cannot land on top of the tree npm ci just installed.
COPY . .
RUN npm run build

# Alpine 3.20's support ended in spring 2026; 3.22 is supported until 2027.
FROM alpine:3.22
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
