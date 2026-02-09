# Privacy and Network Communication

Codex Viewer is designed with privacy in mind:

- **Localhost-Only Communication**: The application runs a web client and API server on localhost, communicating exclusively between your browser and the local server
- **Codex CLI Runtime**: Codex Viewer delegates model/runtime execution to your local `codex` CLI and does not add its own third-party API calls
- **No Tracking or Telemetry**: The application does not collect crash reports, usage statistics, or any other telemetry
- **Network Isolation**: The application functions correctly with localhost-only traffic except where your Codex CLI configuration explicitly requires external access

If you have concerns about network access, you can verify actual traffic from both Codex Viewer and the `codex` process with local network monitoring tools.
