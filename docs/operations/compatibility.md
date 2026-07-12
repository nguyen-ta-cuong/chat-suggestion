# Compatibility evidence

Capability output is derived from runtime probes. It does not infer editor
support from a product name, a configuration directory, or lifecycle hooks.

## Pi

The Pi adapter is the native MVP. Its package tests exercise a documented TUI
custom editor, end-of-input one-line decoration, stale-result rejection, Tab
acceptance, Escape dismissal, autocomplete fallthrough, Unicode, paste, resize,
and editor-conflict downgrade behavior. Outside an active Pi TUI handshake,
`status` deliberately reports `inlineRender: none` and
`runtime-handshake-required`. Obtain the package directory with:

    npm run chat-suggest -- pi install-path

Plan 0011 owns the final fresh-user Pi installation and smoke-test guide.

## Codex

The adapter probes the executable, version, documented help surface, app-server
schema, and initialization behavior without a paid model turn. Stock Codex TUI
editor ownership is not established, so stock-TUI inline rendering remains
`none`. `npm run chat-suggest -- codex` is the verified custom frontend: it owns
the prompt buffer, renders a dim insertion suffix, accepts with Tab without
submitting, and sends accepted drafts through the negotiated App Server. The
installed Codex 0.144.1 smoke test exercised fake and live suggestions plus one
harmless streamed coding turn. Approval requests currently fail closed.

## Claude

The adapter probes the executable and help surface without a model turn.
Lifecycle hooks are not editor access. Native rendering remains disabled unless
all semantic buffer, cursor, event, decoration, insertion, completion, and
cleanup handshake dimensions succeed.

## Experimental PTY

The PTY package supports macOS and Linux when optional `node-pty` loads. Its
unit tests cover byte forwarding, resize and signals, exit propagation, and
terminal restoration with deterministic doubles. The fixture package supplies 13
semantic transcripts for ambiguity and downgrade testing.

No exact executable PTY profile is packaged in the integration app. Therefore
the CLI refuses to launch a wrapped child after both opt-ins, with exit code 78
and a `no exact fixture-tested PTY profile matched` diagnostic. Semantic fixture
conformance is not claimed as a real installed-binary PTY release gate.
