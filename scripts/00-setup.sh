#!/usr/bin/env bash
# Phase 0: toolchain on Linux Mint / Ubuntu. Run once.
set -euo pipefail
GO_VERSION="${GO_VERSION:-1.23.4}"   # confirm the version your target Cosmos SDK release requires
if ! command -v go >/dev/null; then
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz
  sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz
  echo 'export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin' >> ~/.bashrc
  export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin
fi
sudo apt-get update && sudo apt-get install -y git make gcc jq curl
# Ignite CLI (chain scaffolding)
curl -fsSL https://get.ignite.com/cli! | bash
# buf (proto lint/generate)
go install github.com/bufbuild/buf/cmd/buf@latest
go version && ignite version && buf --version
