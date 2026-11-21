#!/usr/bin/env bash
# Phase 1 acceptance: single-node local testnet.
set -euo pipefail
cd "$(dirname "$0")/.."
ignite chain serve --reset-once
