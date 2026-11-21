#!/usr/bin/env bash
<<<<<<< HEAD
=======
# Tests the ramp state machine on its own (needs only Go, no chain, no downloads).
>>>>>>> 918ca8d308f4f7e7748fb2975b738bf4871c5d6a
set -euo pipefail
cd "$(dirname "$0")/../x/ramp/types"
go test -v fsm.go fsm_test.go
