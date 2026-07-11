# Codex capability adapter

This package detects documented Codex CLI capabilities without reading user
settings or credentials. `probeCodexCapabilities` resolves a regular executable,
runs bounded version/help/schema probes in an isolated temporary home, and may
perform a no-turn app-server initialization handshake.

The report intentionally separates `stockTui` from `customFrontend`:

- `stockTui.inlineRender` is `none` until a public editor-buffer/render/insert
  handshake exists.
- `customFrontend` may use `app-server` only when schema and runtime negotiation
  pass. The frontend, not the stock TUI, owns the editable prompt.
- PTY selection requires a validated descriptor whose executable name, version,
  and SHA-256 fingerprint exactly match. PTY rendering remains adjacent and
  experimental.

All output and time limits are caller-configurable and default to 64 KiB and two
seconds. Probe results can be held in the bounded, expiring `CodexProbeCache`.
