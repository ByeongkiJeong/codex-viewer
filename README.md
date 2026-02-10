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
git clone https://github.com/ByeongkiJeong/codex-viewer.git
cd codex-viewer
corepack enable
pnpm install
pnpm build
pnpm start --port 3400
```

Then open `http://localhost:3400`.

This fork is not published to npm. Use source build or the standalone package.

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

## Standalone Package (Dependencies Included)

Create an internal-distribution archive that contains:
- `dist/` (frontend + backend build output)
- `node_modules/` (production dependencies)
- `codex-viewer` launcher script

```bash
pnpm pack:standalone
```

Output files are created under `temp-pack/standalone/`:
- `codex-viewer-<version>-<os>-<arch>-<timestamp>.tar.gz`
- `codex-viewer-<...>.tar.gz.sha256`

`<arch>` is normalized to values like `amd64` / `arm64`.

Run on target host:

```bash
tar -xzf codex-viewer-<...>.tar.gz
cd codex-viewer-<...>
./codex-viewer --hostname 0.0.0.0 --port 3000 --executable codex
```

Notes:
- Node.js `>=20.19.0` and `codex` CLI are still required on the target host.
- No package-manager install step is needed on the target host.
- Build the archive on a machine with the same OS/CPU architecture as the target host.

### Architecture Support (`arm64` / `amd64`)

Yes, `amd64` is supported.

- `arm64` target: build on an `arm64` build environment
- `amd64` target: build on an `amd64` build environment

The standalone archive is not multi-architecture. Build one archive per target architecture.

### Build Example for `amd64`

Native `amd64` builder:

```bash
pnpm pack:standalone
```

From an `arm64` host, build a Linux `amd64` package with Docker:

```bash
docker run --rm \
  --platform linux/amd64 \
  -v "$PWD":/work \
  -w /work \
  node:20-bookworm \
  bash -lc 'corepack enable && pnpm install --frozen-lockfile && CCV_STANDALONE_OUTPUT_DIR=/work/temp-pack/standalone-linux-amd64 pnpm pack:standalone'
```
