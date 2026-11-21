#!/usr/bin/env bash
# Prints the prefix for Cosmos commands: "ignite cosmos" on Ignite v30+, plain "ignite" before that.
VER="$(ignite version 2>/dev/null | grep -i 'Ignite CLI version' | grep -oE 'v[0-9]+' | head -1 | tr -d 'v')"
if [ "${VER:-0}" -ge 30 ]; then echo "ignite cosmos"; else echo "ignite"; fi
