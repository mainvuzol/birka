#!/bin/zsh
# Read-only: what the dev lock installs on Windows, Linux and macOS, hashes required (uv's dry run; no
# package is downloaded). Windows takes colorama and leaves uvloop; the other two the reverse.
cd ${0:A:h}/../../../backend
export UV_CACHE_DIR=$HOME/.cache/birka-runtime/uv-cache
for plat in windows linux macos; do
  out=$(mktemp -d)
  echo "== $plat"
  uv pip install --dry-run --python-platform $plat --python-version 3.12 --python ~/.cache/birka-runtime/python/bin/python \
    --no-deps --require-hashes -r requirements-dev.lock --target $out 2>&1 | grep -E "Would install|error|colorama|uvloop"
  rm -rf $out
done
