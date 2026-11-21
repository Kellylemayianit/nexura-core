#!/usr/bin/env bash
# Tests the ramp state machine on its own (needs only Go, no chain, no downloads).
set -euo pipefail
cd "$(dirname "$0")/../x/ramp/types"
go test -v fsm.go fsm_test.go
