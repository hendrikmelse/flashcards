#!/usr/bin/env bash
# Dumps every application database (custom format) plus global objects (roles)
# into ./backups and deletes dumps older than 14 days. Safe to run from cron.
#
# This only protects against mistakes and corruption. It does NOT protect
# against losing the server: copy ./backups somewhere else too (see
# deploy/README.md, "Offsite backups").
set -euo pipefail
cd "$(dirname "$0")"

OUT=backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
chmod 700 "$OUT"

databases="$(docker compose exec -T postgres psql -U postgres -At \
  -c "select datname from pg_database where not datistemplate and datname <> 'postgres'")"

for db in $databases; do
  # Write to a temp name first so a failed dump never looks like a good backup.
  docker compose exec -T postgres pg_dump -U postgres -Fc "$db" > "$OUT/$db-$STAMP.dump.partial"
  mv "$OUT/$db-$STAMP.dump.partial" "$OUT/$db-$STAMP.dump"
  echo "$(date -u +%FT%TZ) dumped $db ($(du -h "$OUT/$db-$STAMP.dump" | cut -f1))"
done

docker compose exec -T postgres pg_dumpall -U postgres --globals-only > "$OUT/globals-$STAMP.sql"

find "$OUT" -type f -mtime +14 -delete
