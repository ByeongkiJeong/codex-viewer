# Codex Viewer

Codex Viewer is a web-based client for local Codex sessions.
It reads Codex session JSONL files directly and provides an interactive UI for browsing, searching, and continuing sessions.

## Features

- Browse projects and sessions grouped by working directory
- Codex-native conversation timeline rendering
- Start, continue, abort, and approve session processes from the UI
- Live updates via SSE
- Tasks management backed by `~/.codex/tasks`
- Full-text search across sessions

## Requirements

- Node.js `>=20.19.0`
- A working Codex CLI installation (`codex`)

## Quick Start

```bash
npx @kimuson/codex-viewer@latest --port 3400
```

Then open `http://localhost:3400`.

## CLI Options

| Option | Environment Variable | Description | Default |
| --- | --- | --- | --- |
| `--port <port>` | `PORT` | HTTP port | `3000` |
| `--hostname <hostname>` | `HOSTNAME` | HTTP host | `localhost` |
| `--password <password>` | `CCV_PASSWORD` | Web login password | unset |
| `--executable <path>` | `CCV_CODEX_EXECUTABLE_PATH` | Path to `codex` executable | resolve from `PATH` |
| `--codex-home <path>` | `CCV_GLOBAL_CODEX_HOME` | Codex home directory | `~/.codex` |
| `--terminal-disabled` | `CCV_TERMINAL_DISABLED` | Disable in-app terminal | `false` |
| `--terminal-shell <path>` | `CCV_TERMINAL_SHELL` | Terminal shell path | system default |
| `--terminal-unrestricted` | `CCV_TERMINAL_UNRESTRICTED` | Disable restricted bash flags | `false` |

## Data Paths

- Sessions: `~/.codex/sessions/**/rollout-*.jsonl`
- Skills: `~/.codex/skills`
- Tasks: `~/.codex/tasks/<projectId>/<sessionId>/<taskId>.json`
- Viewer cache: `~/.codex-viewer`

## API Overview

- `GET /api/codex/meta`
- `GET /api/codex/features`
- `GET /api/codex/session-processes`
- `POST /api/codex/session-processes`
- `POST /api/codex/session-processes/:sessionProcessId/continue`
- `POST /api/codex/session-processes/:sessionProcessId/abort`
- `POST /api/codex/permission-response`
- `GET /api/projects/:projectId/codex-commands`
- `GET/POST/PUT /api/tasks/*`

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm fix
pnpm vitest run --changed origin/main
./scripts/lingui-check.sh
```
