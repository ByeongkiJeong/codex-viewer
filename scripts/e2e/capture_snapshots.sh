#!/usr/bin/env bash

set -euo pipefail

export GLOBAL_CODEX_HOME=$(git rev-parse --show-toplevel)/mock-global-codex-dir

pnpx tsx ./e2e/captureSnapshot/index.ts
