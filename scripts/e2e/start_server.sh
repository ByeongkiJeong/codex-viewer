#!/usr/bin/env bash

set -euo pipefail

codex_home="$(git rev-parse --show-toplevel)/mock-global-codex-dir"

echo "Check directory structure in $codex_home:"
ls -l $codex_home

node ./dist/main.js --port 4000 --codex-home "$codex_home"
