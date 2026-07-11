# Build the capability-gated Codex adapter

This ExecPlan is a living document maintained under `PLANS.md`. Run it after plan 0001. It owns `adapters/codex/**` and `docs/evidence/codex/**` only.

## Purpose / Big Picture

Detect what an installed Codex CLI actually supports without inventing a prompt-editor API. The adapter will resolve and fingerprint Codex, probe documented help and experimental app-server capabilities, expose a structured capability result, and prepare a protocol-owned frontend seam. Existing Codex TUI ghost text remains disabled unless a future public editor handshake proves it.

## Progress

- [ ] Inspect protocol capabilities and current local Codex help/schema commands.
- [ ] Implement executable resolution, version/help probes, cache, and typed evidence.
- [ ] Implement app-server initialization/schema compatibility tests without paid turns.
- [ ] Implement honest native/app-server/PTY/unsupported selection and docs.
- [ ] Run package checks and update living sections.

## Surprises & Discoveries

- Observation: Local research found `/Applications/ChatGPT.app/Contents/Resources/codex` version `0.144.0-alpha.4`, but no verified per-keystroke editor decoration API.
  Evidence: `codex --help`, plugin/hooks/app-server probes summarized in `PRD.md`.

## Decision Log

- Decision: `UserPromptSubmit`, plugins, hooks, and MCP do not count as native inline support without editor buffer/render/insert access.
  Rationale: They cannot observe and decorate an unsent draft safely.
  Date: 2026-07-11
- Decision: App-server support represents a custom frontend transport, not modification of the existing Codex TUI.
  Rationale: A frontend that owns its editor can render ghost text; the stock TUI still owns its separate buffer.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, record tested versions/commands and the exact capability result without copying private data.

## Context and Orientation

Codex may exist on `PATH` or inside a configured/application-bundle location. Cached version files and config directories are not executable evidence. Only run documented version/help/schema/app-server initialization operations. Do not disassemble binaries, extract symbols, inspect private ChatGPT frameworks, read credentials, or start a paid model turn.

This package does not implement the generic PTY runner. It returns the frozen, data-only protocol `PtyProfileDescriptor` and a capability report that plan 0010 can hand to PTY or a future custom frontend; it never exports detector callbacks.

## Plan of Work

Implement executable resolution in this order: explicit configured path, `PATH`, then known opt-in bundle locations. Validate a regular executable file and run `--version` with timeout/output cap. Probe documented `--help`, `app-server --help`, and schema/binding generation commands only when advertised. Store normalized command name, semantic-ish version string, capability booleans, and downgrade reasons; never store config or auth data.

If app-server is present, launch an ephemeral stdio instance and perform only initialization, malformed/unknown-method, version mismatch, and shutdown tests according to generated public schema for that binary. Generate schema into a temporary directory during tests, not checked-in vendor snapshots unless license and stability are clear. No conversation or model request is sent.

Report `transport: app-server` only for a custom-frontend seam that successfully initializes. Report the stock TUI's `inlineRender: none` absent a documented native editor handshake. If a compatible PTY profile is later supplied, label it experimental/adjacent and preserve its downgrade reasons.

## Concrete Steps

From the root:

    npm test --workspace @chat-suggestion/adapter-codex
    npm run typecheck --workspace @chat-suggestion/adapter-codex
    npm run build --workspace @chat-suggestion/adapter-codex

Tests use fake executables for absent, timeout, malformed version, version mismatch, unsupported help, and app-server negotiation. Local installed-Codex probes are optional integration tests with explicit skips and no paid turn.

## Validation and Acceptance

A config directory without a binary reports unavailable. An executable with only submit hooks reports no native inline capability. A fake app-server successful handshake reports custom-frontend capability but not stock-TUI decoration. Unknown alpha/version output fails closed. Probe output is bounded and timeouts kill/reap children. No test reads Codex credentials or starts a model request.

## Idempotence and Recovery

Temporary schema/process files are removed in `finally`. Probing is read-only. Never edit user Codex settings, plugin marketplaces, ChatGPT.app, or root lockfile.

## Artifacts and Notes

Write redacted, reproducible command/evidence notes under `docs/evidence/codex/`; include versions and public method names, not tokens, paths containing private project data, or raw sessions.

## Interfaces and Dependencies

Export resolver/prober functions, `CodexCapabilityReport`, custom-frontend handshake interface, and optional protocol `PtyProfileDescriptor` with exact tested fingerprints and named markers. Depend only on protocol and Node child-process/filesystem APIs where possible. The report must explain why each capability is enabled or disabled.

Revision note: Initial Codex capability plan created 2026-07-11 from local 0.144.0-alpha.4 evidence.
