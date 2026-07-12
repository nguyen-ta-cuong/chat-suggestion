# Chat Suggestion

Chat Suggestion adds short, insertion-only prompt continuations to coding-agent
editors. A suggestion is dim decoration until you accept it with Tab. Escape
dismisses it. Typing, cursor movement, autocomplete, paste, resize, submit, or
session changes invalidate it; suggestions never submit prompts or execute
commands.

The repository is verified on macOS and Linux with Node.js 20+ and npm. Start
with the offline workflow before enabling a provider.

## Quick start (offline and credential-free)

```sh
git clone https://github.com/nguyen-ta-cuong/chat-suggestion.git
cd chat-suggestion
npm install
npm run build
npm run chat-suggest -- status
npm run chat-suggest -- demo --provider fake
```

The fake provider makes no model request and reports `submitted: false`. Status
redacts configuration and reports capability downgrades. Installing npm
dependencies can contact the npm registry; that is separate from provider
transmission.

For the full verified setup, privacy, troubleshooting, and uninstall guide,
see [`docs/user-guide.md`](docs/user-guide.md).

## Pi setup

Pi is the only host with a verified native editor adapter. It renders one
single-line suggestion at the logical end of the prompt and gives native
autocomplete priority. A current suggestion is accepted with Tab and dismissed
with Escape.

The production entry uses Pi's currently selected model and its documented
credential resolver. If Pi has no selected model or cannot resolve credentials,
it fails closed and leaves the editor unchanged. Review provider privacy and
billing settings before trying the model-backed path.

The production editor waits 100 ms after the last keystroke before requesting
a suggestion. It keeps suggestion transport reuse isolated from Pi's agent
conversation. If you type the beginning of a visible ghost, the remaining text
shrinks immediately without another model call; a mismatch clears it and starts
a fresh debounce. The first request and overall speed still depend on the
selected model, provider, and network.

### Local development entry

Build the compiled extension and load it explicitly from Pi:

```sh
npm run build
pi -e "$PWD/adapters/pi/dist/production-extension.js"
```

Typing in this TUI can send the bounded draft to the selected provider. This is
not an offline test and may incur provider charges.

### npm package entry

The package metadata is prepared for publication as
`@chat-suggestion/adapter-pi`, with `@chat-suggestion/protocol` as its public
runtime dependency. The packages are not published by this checkout. After a
release is published, install it through Pi's package manager:

```sh
pi install npm:@chat-suggestion/adapter-pi
```

Do not use the offline bridge as evidence that Pi model authentication works;
it exists only for deterministic rendering tests.

### Offline Pi rendering smoke test

This path never uses a model, saved session, tools, project context, or network:

```sh
PI_CODING_AGENT_DIR=/tmp/chat-suggestion-pi-smoke \
PI_OFFLINE=1 \
pi --offline --no-session --no-extensions --no-skills \
  --no-prompt-templates --no-context-files --no-tools \
  -e "$PWD/adapters/pi/smoke/offline-extension.ts"
```

Type at least three non-whitespace characters, wait about 150 ms, then try Tab
and Escape. Exit with Ctrl-D on an empty editor. Remove
`/tmp/chat-suggestion-pi-smoke` when finished.

## Codex and Claude Code

The repository includes companion plugin directories:

- [`plugins/codex-chat-suggestion`](plugins/codex-chat-suggestion)
- [`plugins/claude-chat-suggestion`](plugins/claude-chat-suggestion)

Their `chat-suggest` skills are manual, post-submit continuations. They do not
observe a live draft, cursor, or editor decoration and do not insert or submit
anything automatically. The stock Codex and Claude TUIs therefore report
`inlineRender: none`; a custom frontend that owns its editor is a separate
integration. Follow each plugin README and the host's documented marketplace
flow for installation.

## Configuration and privacy

Create `.chat-suggestion.json` only when you need to change defaults. The
`CHAT_SUGGEST_CONFIG` environment variable may point to an absolute config
file. Unknown fields are rejected.

Defaults are enabled suggestions, a 200 ms debounce, an 1,800 ms request
timeout, a three-character minimum prefix, and the fake provider. Drafts are
bounded to 8 KiB, context to 48 KiB, and candidates to 160 Unicode characters
and 1,024 UTF-8 bytes. These limits and redaction rules are defense in depth,
not a guarantee that sensitive text is absent.

Context remains disabled until the repository matches `trustedProjects`, or
you explicitly preview it:

```sh
npm run chat-suggest -- context preview --provider fake --trust-project
```

Preview output is bounded but may contain sensitive project text. Never put an
API key in `.chat-suggestion.json`; configure provider credentials through the
named environment variable required by the provider configuration.

## Experimental PTY mode

PTY support is adjacent status UI, not native ghost text. It suspends on hidden
input, cursor motion, redraw, resize, paste, completion UI, or unknown terminal
sequences. Tab passes through when no valid suggestion is visible, and terminal
state is restored on exit. The wrapper requires explicit opt-in and an
allowlisted command; without an exact fixture-tested profile it refuses before
launch:

```sh
npm run chat-suggest -- wrap --experimental-pty -- codex
```

## Disable and uninstall

Set `"enabled": false` in `.chat-suggestion.json`, or remove that file if you
created it only for Chat Suggestion. For a Pi package installation, use Pi's
documented package removal command. Do not delete general Pi, Codex, Claude,
shell, cache, or credential settings. To remove a checkout, stop any running
session, delete only this repository and product-owned config, and revoke any
provider credential you created separately.

## Development checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:package --workspace @chat-suggestion/adapter-pi
```

The package test packs the protocol and Pi artifacts into temporary tarballs,
installs them without workspace links, and verifies the `pi.extensions` entry.

## Further documentation

- [`docs/user-guide.md`](docs/user-guide.md) — verified end-user setup and usage
- [`docs/operations/privacy.md`](docs/operations/privacy.md) — transmission and context policy
- [`docs/operations/troubleshooting.md`](docs/operations/troubleshooting.md) — downgrade reasons
- [`PRD.md`](PRD.md) — product requirements and safety model
- [`AGENTS.md`](AGENTS.md) — implementation boundaries and host rules
- [`PLANS.md`](PLANS.md) — execution plan graph
