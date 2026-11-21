#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../x/ramp/types"
go test -v fsm.go fsm_test.go
