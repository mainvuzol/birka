#!/bin/sh
# Stands in for `docker compose build && docker compose --profile ops build ops`
# in the rehearsal: the checkout's backend code over the images built here.
set -eu
release="$1"
backend="$2"
here=$(dirname "$0")
for service in api ops; do
  docker build -q --network=none --pull=false -f "$here/Dockerfile.release" \
    --build-arg BASE="birka-ci-local-$service" --build-arg BIRKA_RELEASE="$release" \
    -t "birka-rehearsal-role-$service:$release" "$backend" >/dev/null
  echo "birka-rehearsal-role-$service:$release"
done
