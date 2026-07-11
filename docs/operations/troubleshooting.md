# Troubleshooting and downgrade reasons

Run `npm run chat-suggest -- status` for structured, redacted configuration and
capability evidence. The output is authoritative for the current executable and
environment.

## Common results

- `inlineRender: "none"` for Codex or Claude stock TUI: no verified
  per-keystroke editor/render/insert handshake exists. Hooks and submit events
  do not establish editor access.
- `claude-executable-not-found`: no executable was resolved from the explicit
  path or `PATH`. A settings directory does not count as an installation.
- PTY profile mismatch: executable path, version, or SHA-256 differs from the
  exact tested profile. Re-profiling and fixture evidence are required; do not
  relax the comparison.
- `context preview requires --trust-project`: add the one-shot flag after
  reviewing the repository, or add the exact resolved repository path to
  `context.trustedProjects`.
- optional `node-pty` unavailable: reinstall dependencies on macOS/Linux and
  inspect npm's install-script policy. Keep PTY disabled if the native addon was
  not built.
- Pi custom editor conflict or unknown layout: clear the suggestion and
  downgrade rather than replacing an existing editor silently. Ordinary Tab,
  Escape, autocomplete, paste, IME, and application shortcuts must continue
  through the native editor whenever no current suggestion consumes them.

## Configuration errors

The optional project file is `.chat-suggestion.json`. `CHAT_SUGGEST_CONFIG` may
point to an absolute alternative. Unknown fields, invalid booleans, debounce
outside 100–1,000 ms, budgets above protocol limits, non-HTTPS remote endpoints
(except loopback HTTP), credential-bearing endpoint URLs, and invalid
key-variable names are rejected.

Supported environment overrides are `CHAT_SUGGEST_CONFIG`,
`CHAT_SUGGEST_ENABLED`, `CHAT_SUGGEST_PROVIDER`, `CHAT_SUGGEST_DEBOUNCE_MS`, and
`CHAT_SUGGEST_EXPERIMENTAL_PTY`. Secrets belong only in the environment variable
named by `remote.apiKeyEnvironmentVariable`.

## Cleanup and uninstall boundary

The application creates no daemon, socket, shell startup entry, host setting, or
global installation during its offline commands. Remove only a project-owned
`.chat-suggestion.json` if one was created. Dependency removal is the normal
repository package-manager operation; do not delete Pi, Codex, Claude, their
settings, or shared credential stores.
