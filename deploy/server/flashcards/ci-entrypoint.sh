#!/usr/bin/env bash
# The ONLY thing the CI deploy key may run. It is installed in
# ~deploy/.ssh/authorized_keys as a forced command:
#
#   restrict,command="/srv/flashcards/ci-entrypoint.sh" ssh-ed25519 AAAA... github-actions-deploy
#
# so a leaked CI secret can deploy an image from this repository's registry
# path and nothing else: no shell, no other commands, no port forwarding.
#
# CI sends:   deploy ghcr.io/<owner>/flashcards:<40-hex commit sha> <github actor>
# and the job's short-lived registry token on stdin.
set -euo pipefail

read -r cmd image actor extra <<<"${SSH_ORIGINAL_COMMAND:-}"

fail() {
  echo "ci-entrypoint: $1" >&2
  logger -t flashcards-deploy "rejected: $1 (from ${SSH_CLIENT%% *})" 2>/dev/null || true
  exit 1
}

[ "$cmd" = "deploy" ] || fail "only 'deploy <image> <actor>' is allowed"
[ -z "${extra:-}" ] || fail "unexpected extra arguments"
[[ "$image" =~ ^ghcr\.io/hendrikmelse/flashcards:[0-9a-f]{40}$ ]] || fail "image is not an allowed flashcards tag"
[[ "$actor" =~ ^[A-Za-z0-9-]{1,39}$ ]] || fail "invalid actor name"

logger -t flashcards-deploy "deploy requested: $image by $actor"

# The token arrives on stdin; it is never stored on this machine.
docker login ghcr.io -u "$actor" --password-stdin >/dev/null

exec /srv/flashcards/deploy.sh "$image"
