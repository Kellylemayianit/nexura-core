#!/usr/bin/env bash
# Prints the prefix for Cosmos commands: "ignite cosmos" on Ignite v30+, plain "ignite" before that.
# NOTE: "ignite version" prints to the ERROR stream, so we capture both streams (2>&1).
OUT="$(ignite version 2>&1 || true)"
VER="$(printf '%s\n' "$OUT" | grep -i 'Ignite CLI version' | grep -oE 'v[0-9]+' | head -1 | tr -d 'v')"
if [ "${VER:-0}" -ge 30 ]; then
  echo "ignite cosmos"
elif ignite --help 2>&1 | grep -qi 'gno.land'; then
  echo "ignite cosmos"
else
  echo "ignite"
fi
