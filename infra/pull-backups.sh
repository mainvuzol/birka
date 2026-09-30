#!/bin/sh
# Collect the server's encrypted backups onto this machine — the owner's own
# computer or NAS (owner decision, 2026-09-30; backup-restore-runbook.md).
#
#   BIRKA_BACKUP_SOURCE=birka-backup@shop.example.com: \
#   BIRKA_BACKUP_DEST="$HOME/birka-backups" \
#   sh pull-backups.sh
#
# It takes only what the server encrypted, with its manifest and drill
# report: never the plaintext of a night whose encryption failed. It never
# deletes anything here, so this copy outlives the server's own retention.
# Then it checks every archive against the checksum the server recorded, and
# exits non-zero if any arrived damaged. It needs rsync and ssh, not age:
# the private key is only needed to restore, and should not live here.
set -eu

source="${BIRKA_BACKUP_SOURCE:?set BIRKA_BACKUP_SOURCE, e.g. birka-backup@shop.example.com:}"
dest="${BIRKA_BACKUP_DEST:?set BIRKA_BACKUP_DEST, e.g. \$HOME/birka-backups}"
key="${BIRKA_BACKUP_SSH_KEY:-$HOME/.ssh/birka_backup}"

mkdir -p "$dest"
rsync -rt --ignore-existing \
  --include='birka-*.dump.age' --include='birka-*.json' --exclude='*' \
  -e "ssh -i $key -o IdentitiesOnly=yes" \
  "$source" "$dest/"

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

checked=0
damaged=0
for manifest in "$dest"/birka-*[0-9]Z.json; do
  [ -e "$manifest" ] || continue
  expected=$(sed -n 's/^ *"encrypted_sha256": "\([0-9a-f]*\)".*/\1/p' "$manifest")
  # A night whose encryption failed left no .age here to check.
  [ -n "$expected" ] || continue
  archive="${manifest%.json}.dump.age"
  if [ ! -e "$archive" ] || [ "$(digest "$archive")" != "$expected" ]; then
    echo "DAMAGED OR MISSING: $archive" >&2
    damaged=$((damaged + 1))
  else
    checked=$((checked + 1))
  fi
done

echo "$checked encrypted backups here are whole; $damaged damaged or missing"
[ "$damaged" -eq 0 ]
