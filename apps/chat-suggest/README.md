# Chat Suggest integration app

This workspace application wires the public protocol, context, engine, provider,
and adapter packages. Build the workspace before invoking the CLI:

    npm run build
    npm run chat-suggest -- status
    npm run chat-suggest -- demo --provider fake
    npm run chat-suggest -- context preview --provider fake --trust-project
    npm run chat-suggest -- pi install-path
    npm run chat-suggest -- codex

The demo always constructs the deterministic fake provider, even when project
configuration names a remote provider. It does not submit the resulting draft.
Context preview is read-only, performs no provider call, and requires either an
exact trusted-project entry or the one-command `--trust-project` confirmation.

Configuration is optional at `.chat-suggestion.json`. An absolute path in
`CHAT_SUGGEST_CONFIG` overrides that location. Unknown fields are rejected.
The complete operational schema and safety constraints are documented in
`docs/operations/privacy.md` and `docs/operations/troubleshooting.md`.

The `codex` command launches this repository's prompt editor and connects it to
the installed Codex App Server. It is the supported Codex ghost-text surface;
the stock Codex TUI remains unchanged. Use `--provider fake`, type exactly
`fix the failing auth`, avoid Enter, and use Ctrl-C then Ctrl-D for a
rendering-only check. Without that flag, suggestion drafts may be sent through a
dedicated ephemeral Codex thread and consume quota. Enter always starts a real
Codex coding turn.

The PTY command is experimental. It requires both `experimentalPty: true` in
configuration and the `--experimental-pty` command-line acknowledgment. This
release has no packaged exact executable profile, so it refuses to launch the
child. A product name or executable presence is never treated as proof of safe
editor access.
