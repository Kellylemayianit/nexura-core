#!/usr/bin/env bash
# Scaffolds the Hub chain AROUND the files already in this repo.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cd "$TMP"
ignite scaffold chain github.com/Kellylemayianit/nexura-core --address-prefix nexura --no-module
cd nexura-core
ignite scaffold module fiatoracle   --dep bank
ignite scaffold module zoneregistry --ibc
ignite scaffold module ramp         --dep bank
ignite scaffold module nexuratex    --dep bank
ignite scaffold module identitymap
if command -v rsync >/dev/null; then
  rsync -a --ignore-existing --exclude .git ./ "$REPO_ROOT"/
else
  cp -rn ./. "$REPO_ROOT"/ || true
fi
echo "Scaffold merged into $REPO_ROOT"
