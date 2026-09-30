#!/usr/bin/env bash
# Deploys one image: pull, migrate, restart, wait for health, roll back if the
# new version never becomes healthy. Called by CI over SSH, or by hand:
#   ./deploy.sh ghcr.io/hendrikmelse/flashcards:<commit-sha>
#
# Rolling back by hand is the same command with the previous tag.
#
# Migrations are applied BEFORE the new version starts and are not undone by a
# rollback. Keep them backward compatible (add columns/tables first, remove
# old ones in a later deploy) so the previous version keeps working.
#
# The app is a single container, so each deploy has a few seconds of downtime
# (Caddy answers 502 while it restarts).
set -euo pipefail
cd "$(dirname "$0")"

NEW="${1:?usage: deploy.sh <image>}"
PREV="$(cat current-image 2>/dev/null || true)"
export IMAGE="$NEW"

# Waits up to ~60s for the container's healthcheck to pass. Returns early if
# Docker has already declared it unhealthy.
wait_healthy() {
  local status="none"
  for _ in $(seq 1 30); do
    status="$(docker inspect -f '{{.State.Health.Status}}' flashcards-api 2>/dev/null || echo none)"
    [ "$status" = "healthy" ] && return 0
    [ "$status" = "unhealthy" ] && return 1
    sleep 2
  done
  return 1
}

echo "==> pulling $NEW"
docker compose pull api

echo "==> applying migrations"
docker compose run --rm --no-deps api node apps/api/dist/migrate.js

echo "==> starting $NEW"
docker compose up -d --no-deps api

if ! wait_healthy; then
  echo "!! $NEW did not become healthy" >&2
  docker compose logs --tail 50 api >&2 || true
  if [ -n "$PREV" ]; then
    echo "==> rolling back to $PREV" >&2
    IMAGE="$PREV" docker compose up -d --no-deps api
    if wait_healthy; then
      echo "==> rollback succeeded: $PREV is healthy" >&2
    else
      echo "!! rollback FAILED: $PREV is not healthy either; investigate now" >&2
    fi
  else
    echo "!! no previous version recorded, so there is nothing to roll back to" >&2
  fi
  exit 1
fi

echo "$NEW" > current-image
docker image prune -f >/dev/null
echo "==> deployed $NEW"
