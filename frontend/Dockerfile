# Builds the Mini App bundle and copies it into a volume that Caddy serves.
FROM node:24-alpine AS build
WORKDIR /app
# Copy the lockfile too: npm ci requires it and installs exactly that tree.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM alpine:3.20
COPY --from=build /app/dist /dist
# The compose `web` service runs once and exits; Caddy serves from the volume.
CMD ["sh", "-c", "rm -rf /output/* && cp -r /dist/. /output/ && echo 'web bundle published'"]
