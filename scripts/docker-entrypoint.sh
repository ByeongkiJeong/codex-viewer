#!/usr/bin/env bash
set -euo pipefail

CODEX_HOME="${HOME}/.codex"

# Make sure codex directories exist.
mkdir -p "$CODEX_HOME/sessions"
mkdir -p "$CODEX_HOME/tasks"
mkdir -p "$CODEX_HOME/skills"

exec "$@"
