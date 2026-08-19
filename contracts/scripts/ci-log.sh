#!/usr/bin/env bash
# Print the failing tail of a GitHub Actions job log.
#
# Why this exists: Actions stores job logs in Azure blob storage. Some
# development environments can reach api.github.com but not that blob host, and
# `gh run view --log` fails there with an opaque EOF. This resolves the signed
# redirect explicitly so the failure is at least legible, and prints the URL so
# it can be fetched by other means when the blob host is unreachable.
#
# Usage: ./scripts/ci-log.sh [job_id]
#        ./scripts/ci-log.sh            # newest protocol job
set -euo pipefail

REPO="${REPO:-Persat-Labs/persat-finance}"
JOB_ID="${1:-}"

if [ -z "$JOB_ID" ]; then
  RUN_ID=$(gh run list --repo "$REPO" --workflow "Verify Solana protocol" \
    --limit 1 --json databaseId --jq '.[0].databaseId')
  JOB_ID=$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs" --jq '.jobs[0].id')
fi

URL=$(curl -sS -I -H "Authorization: token $(gh auth token)" \
  "https://api.github.com/repos/$REPO/actions/jobs/$JOB_ID/logs" \
  | grep -i '^location:' | sed 's/^location: //' | tr -d '\r')

echo "job:  $JOB_ID"
echo "log:  $URL"
echo

# Print the interesting part if the blob host is reachable from here.
if curl -sSf --max-time 20 "$URL" -o /tmp/ci-log.txt 2>/dev/null; then
  grep -nE "^.*(error(\[E[0-9]+\])?|warning: unused|test result|FAILED|panicked)" /tmp/ci-log.txt \
    | tail -60
else
  echo "Blob storage unreachable from this environment. Fetch the URL above." >&2
fi
