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
# overwrites a copy here. Then it checks every archive against the checksum
# the server recorded. It needs rsync and ssh, not age: the private key is
# only needed to restore, and should not live here.
#
# Then it deletes the nights older than 3 months, as the server does, so a
# customer's erased name is gone from every copy within 3 months (owner
# decision, 2026-10-09; ADR-0015). It always keeps the newest night whose
# archive is whole, however old, and touches no file the server did not
# name. It deletes by date even when the server could not be reached or a
# copy here is damaged, and then exits non-zero, saying which.
set -eu

source="${BIRKA_BACKUP_SOURCE:?set BIRKA_BACKUP_SOURCE, e.g. birka-backup@shop.example.com:}"
dest="${BIRKA_BACKUP_DEST:?set BIRKA_BACKUP_DEST, e.g. \$HOME/birka-backups}"
# A NAS's task scheduler may run this without HOME: then name the key.
key="${BIRKA_BACKUP_SSH_KEY:-${HOME:?set HOME, or BIRKA_BACKUP_SSH_KEY to the SSH key}/.ssh/birka_backup}"
# The moment now, as the server stamps its nights; set only by the tests.
now="${BIRKA_BACKUP_NOW:-$(date -u +%Y%m%dT%H%M%SZ)}"
months=3

mkdir -p "$dest"
pulled=0
rsync -rt --ignore-existing \
  --include='birka-*.dump.age' --include='birka-*.json' --exclude='*' \
  -e "ssh -i $key -o IdentitiesOnly=yes" \
  "$source" "$dest/" || pulled=$?

digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

checked=0
damaged=0
# The nights whose archive is whole, oldest first.
whole=""
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
    stamp=${manifest##*/birka-}
    whole="$whole ${stamp%.json}"
  fi
done

echo "$checked encrypted backups here are whole; $damaged damaged or missing"

# A stamp as a number: 20260930T031500Z is 20260930031500.
number() {
  printf '%s\n' "$1" | tr -d 'TZ'
}

# The same moment $months months earlier, the day kept within the month, as
# the server counts it (`nightly_backup.months_before`).
year=$(printf '%s\n' "$now" | cut -c1-4)
month=$(printf '%s\n' "$now" | cut -c5-6)
day=$(printf '%s\n' "$now" | cut -c7-8)
clock=$(printf '%s\n' "$now" | cut -c9-)
month=$((${month#0} - months))
day=${day#0}
if [ "$month" -le 0 ]; then
  month=$((month + 12))
  year=$((year - 1))
fi
case $month in
  4 | 6 | 9 | 11) last=30 ;;
  2)
    if [ $((year % 4)) -eq 0 ] && { [ $((year % 100)) -ne 0 ] || [ $((year % 400)) -eq 0 ]; }; then
      last=29
    else
      last=28
    fi
    ;;
  *) last=31 ;;
esac
[ "$day" -le "$last" ] || day=$last
cutoff=$(number "$(printf '%04d%02d%02d%s' "$year" "$month" "$day" "$clock")")

# Every night here, oldest first, by the stamp the server names its files with.
nights=$(
  for path in "$dest"/birka-*; do
    if [ -f "$path" ]; then printf '%s\n' "${path##*/}"; fi
  done | sed -n 's/^birka-\([0-9]\{8\}T[0-9]\{6\}Z\)\..*/\1/p' | sort -u
)
# The newest night that can be restored stays, however old: a server whose
# encryption keeps failing sends nights with no archive. With none whole,
# the newest night of any kind.
newest=$(printf '%s\n' $whole | sort | tail -n 1)
[ -n "$newest" ] || newest=$(printf '%s\n' "$nights" | tail -n 1)
removed=0
for stamp in $nights; do
  [ "$stamp" != "$newest" ] || continue
  [ "$(number "$stamp")" -le "$cutoff" ] || continue
  for path in "$dest/birka-$stamp".*; do
    if [ -f "$path" ]; then rm -f "$path"; fi
  done
  removed=$((removed + 1))
done
echo "$removed nights older than $months months deleted here"

if [ "$pulled" -ne 0 ]; then
  echo "NOT COLLECTED: rsync exited $pulled; the server's newest nights are not here" >&2
fi
[ "$pulled" -eq 0 ] && [ "$damaged" -eq 0 ]
