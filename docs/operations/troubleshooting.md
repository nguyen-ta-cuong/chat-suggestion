# Troubleshooting and configuration

Configuration is read from `.chat-suggestion.json` in the working directory. Set
`CHAT_SUGGEST_CONFIG` to an absolute file path to override it. A missing default
file selects safe defaults; a missing override is an error.

Supported top-level fields are `enabled`, `provider`, `debounceMs`,
`requestTimeoutMs`, `minimumPrefixCharacters`, `context`, `trustedProjects`,
`hostCommands`, and `experimentalPty`. The debounce range is 100–1,000 ms and
the request timeout must be greater than the debounce. `hostCommands` accepts
executable names without paths. The defaults allow only `codex` and `claude`.

Run these diagnostics after `npm run build`:

    npm run chat-suggest -- status
    npm run chat-suggest -- demo --provider fake
    npm run chat-suggest -- context preview --provider fake --trust-project

Common downgrade reasons:

- `runtime-handshake-required`: status is running outside the Pi TUI editor
  handshake. This is expected and prevents an unsupported native claim.
- `another extension already owns the custom editor`: Pi cannot safely replace
  an existing editor component, so suggestions are disabled for that session.
- `lifecycle-hooks-are-not-editor-access`: Claude hooks do not expose the live
  draft, cursor, decoration, or non-submitting insertion.
- `no exact fixture-tested PTY profile matched`: the wrapper cannot prove the
  executable version and fingerprint are safe, so it does not launch the child.
- `project context is disabled until the project is trusted`: add the exact
  repository path to `trustedProjects`, or use `--trust-project` for one
  preview.

The experimental wrapper requires both opt-ins:

    {
      "experimentalPty": true,
      "hostCommands": ["codex", "claude"]
    }

    npm run chat-suggest -- wrap --experimental-pty -- codex

The current integration release still refuses launch because it packages no
exact executable profile. Do not change that diagnostic into passthrough:
transparent byte forwarding alone is not semantic editor access.

To uninstall a workspace checkout, remove only the checkout and any
`.chat-suggestion.json` file you created. If Pi was pointed at the path printed
by `pi install-path`, remove that explicit Pi package reference using Pi's
documented package mechanism. Do not delete general Pi, Codex, Claude, shell, or
credential configuration.
