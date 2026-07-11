# Codex capability probe evidence

Date: 2026-07-11

## Scope and safety

The probe used only the installed executable's public `--version`, `--help`,
`app-server --help`, `app-server generate-json-schema --out <temporary-dir>`,
and ephemeral `app-server --stdio` initialization surfaces. The process ran with
fresh temporary `HOME` and `CODEX_HOME` directories. It did not read user
configuration or credentials, send a prompt, start a thread/turn, or make a
model request. Generated schema and temporary homes were removed afterward.

## Reproducible commands

The locally installed binary reported:

    codex --version
    codex-cli 0.144.0-alpha.4

Public help advertised `app-server` and `generate-json-schema`. The generated
schema contained `v1/InitializeParams.json` with required `clientInfo`, plus the
public `initialize` request and `initialized` notification.

The bounded stdio compatibility exchange performed only:

1. `initialize` with client name/version and no experimental API opt-in.
2. `initialized` notification.
3. An unknown method, rejected by this build with error `-32600`.
4. A malformed `initialize` missing required `clientInfo`, rejected with error
   `-32600`.
5. Stream close, `SIGTERM`, bounded `SIGKILL` fallback, and child reaping.

No public shutdown request exists in the generated schema for this build, so the
adapter does not invent one.

## Observed capability result

For Codex CLI `0.144.0-alpha.4`, version/help/schema/initialization and both
negative protocol checks passed. This proves an app-server transport suitable
for a custom frontend that owns its own editor. It does not prove access to the
stock Codex TUI prompt editor.

The stock TUI result remains:

    transport: none
    inlineRender: none
    bufferRead: false
    cursorRead: false
    atomicAcceptance: false

The custom-frontend seam reports `transport: app-server` only after all checks
pass. A PTY profile is accepted only when its protocol shape, version,
executable name, and SHA-256 fingerprint exactly match; it remains an
experimental adjacent-render fallback.

## Deterministic validation

    npm test --workspace @chat-suggestion/adapter-codex
    Test Files  1 passed (1)
    Tests       12 passed (12)

    npm run typecheck --workspace @chat-suggestion/adapter-codex
    exited 0

    npm run build --workspace @chat-suggestion/adapter-codex
    exited 0

Fake executable coverage includes absent/config-directory-only resolution,
malformed versions, submit-hook-only help, successful negotiation, version
mismatch, early process exit, timeout, output overflow, cache reuse, exact PTY
fingerprint matching, and 50 concurrent unavailable probes.
