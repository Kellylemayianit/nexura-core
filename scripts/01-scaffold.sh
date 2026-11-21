#!/usr/bin/env bash
# Scaffolds the Hub chain AROUND the files already in this repo.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Ignite v30+ uses "ignite cosmos ..."; v29 and older use plain "ignite ...".
IGN="$(bash "$REPO_ROOT/scripts/ignite-cmd.sh")"
echo "Using: $IGN"
ignite version | head -3

TMP="$(mktemp -d)"
cd "$TMP"

scaffold_chain() {
  for FLAGS in "--address-prefix nexura --no-module" "--no-module" ""; do
    rm -rf nexura-core
    # Success only counts if the chain folder really exists.
    if $IGN scaffold chain github.com/Kellylemayianit/nexura-core $FLAGS && [ -d nexura-core ]; then
      echo "Scaffolded with flags: [$FLAGS]"
      return 0
    fi
    echo "Scaffold failed with flags [$FLAGS], trying the next option"
  done
  echo "ERROR: no scaffold attempt created the chain folder" >&2
  return 1
}
scaffold_chain

cd nexura-core

# Ignite asks a yes/no question if the chain has uncommitted changes, and a CI runner
# cannot answer it. Commit after every step so it never needs to ask.
git config user.email "scaffold@local"
git config user.name "scaffold"
commit_all() { git add -A && git commit -qm "$1" || true; }
commit_all "chain scaffold"

for SPEC in "fiatoracle --dep bank" "zoneregistry --ibc" "ramp --dep bank" "nexuratex --dep bank" "identitymap"; do
  echo "=== scaffolding module: $SPEC"
  # shellcheck disable=SC2086
  $IGN scaffold module $SPEC
  commit_all "scaffold module $SPEC"
done

# Copy generated files into the repo WITHOUT overwriting anything we already have.
if command -v rsync >/dev/null; then
  rsync -a --ignore-existing --exclude .git ./ "$REPO_ROOT"/
else
  cp -rn ./. "$REPO_ROOT"/ || true
fi
echo "Scaffold merged into $REPO_ROOT"
