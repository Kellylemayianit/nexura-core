#!/usr/bin/env bash
# Phase 1: scaffold the Hub chain and the four custom modules.
# Run from the PARENT directory of where you want nexura-core to live.
set -euo pipefail
ignite scaffold chain github.com/Kellylemayianit/nexura-core \
  --address-prefix nexura --no-module
cd nexura-core
# Custom modules. IBC-capable so Zones can talk to them (zoneregistry, ramp).
ignite scaffold module fiatoracle   --dep bank
ignite scaffold module ramp         --dep bank,fiatoracle,zoneregistry
ignite scaffold module zoneregistry --ibc
ignite scaffold module nexuratex    --dep bank
ignite scaffold module identitymap
echo "Scaffold done. Now copy the proto contracts from ../proto over the generated ones (see docs/BUILD.md, Phase 2)."
