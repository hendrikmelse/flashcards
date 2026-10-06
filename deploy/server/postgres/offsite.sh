#!/usr/bin/env bash
# Copies ./backups to the offsite restic repository (Backblaze B2), applies
# retention, verifies the repository, and pings Healthchecks.io. Run by the
# backup service right after backup.sh (ExecStartPost), so it only runs when
# the dump itself succeeded; when it does not, the missing ping is what raises
# the alert.
#
# The repository location, its password, the B2 key, and the ping URL come from
# /etc/flashcards-backup.env (root only, loaded by systemd; see
# deploy/README.md, "Offsite backups"). restic encrypts everything before it
# leaves the server, which matters because globals-*.sql holds password hashes.
set -euo pipefail
cd "$(dirname "$0")"

: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${HC_PING_URL:?}"

ping() { curl -fsS -m 10 --retry 3 -o /dev/null "$HC_PING_URL$1" || echo "warning: could not reach Healthchecks ($1)" >&2; }

fail() {
  echo "$(date -u +%FT%TZ) offsite backup FAILED" >&2
  ping /fail
  exit 1
}
trap fail ERR

ping /start

restic backup backups --host flashcards --tag nightly --quiet
# 7 daily, 4 weekly, and 6 monthly snapshots; --prune frees what nothing uses.
restic forget --host flashcards --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --quiet
# Checks the repository structure each night; reads a slice of the data too, so
# all of it gets read over a few weeks.
restic check --read-data-subset=10% --quiet

echo "$(date -u +%FT%TZ) offsite backup ok ($(restic snapshots --host flashcards --json | grep -o '"short_id"' | wc -l) snapshots kept)"
ping ""
