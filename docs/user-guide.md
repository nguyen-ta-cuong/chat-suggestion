# Chat Suggestion user guide

Chat Suggestion offers a short insertion-only suffix after you pause typing. It
is decoration until you accept it with Tab. Escape dismisses it. It never
submits a prompt, runs a command, or attaches a file. Typing, cursor movement,
completion UI, resize, or session change invalidates a suffix, so an old result
cannot later appear or be accepted.

This release is verified on macOS and Linux with Node 20 or newer. The first
workflow uses the deterministic fake provider, needs no credentials, and makes
no model-provider request. Installing npm dependencies can contact the npm
registry; that is separate from provider transmission.

## Install and verify

Clone the repository, enter its root, run npm install, then build.

<!-- user-guide-command: build -->

    npm run build

<!-- user-guide-command: status -->

    npm run chat-suggest -- status

Status reports redacted configuration and current capability downgrades. With no
.chat-suggestion.json, the provider is fake, debounce is 100 ms, and no project
is trusted. Outside a Pi TUI it correctly says a runtime handshake is required.

## First offline run

<!-- user-guide-command: fake-demo -->

    npm run chat-suggest -- demo --provider fake

The demo accepts one deterministic suffix and reports "submitted": false. It
always constructs the fake provider, even if configuration names a remote
provider.

## Configuration, context, and privacy

Create .chat-suggestion.json only to change a default. CHAT_SUGGEST_CONFIG may
name an absolute configuration file. Unknown fields are rejected. Defaults are
enabled suggestions, a 100 ms debounce, an 1,800 ms general request timeout, an
8,000 ms Codex suggestion timeout, a three-character minimum prefix, and the
fake provider.

Additional context is bounded to 48 KiB; draft to 8 KiB; and a candidate to 160
Unicode characters, one newline, and 1,024 UTF-8 bytes. Per-source limits are
recent chat 12 KiB, Git 20 KiB, project 8 KiB, attachments 4 KiB, and plans 4
KiB. Limits and redaction are defense in depth, not a guarantee that sensitive
content is absent.

Context remains disabled until the repository exactly matches trustedProjects,
or you make a one-time preview with --trust-project. Preview prints a bounded
redacted envelope to your terminal, so treat it as sensitive. It never calls a
provider.

<!-- user-guide-command: context-preview -->

    npm run chat-suggest -- context preview --provider fake --trust-project

Disable individual sources with configuration such as:

    {
      "context": {
        "enabledSources": {
          "recent-chat": true,
          "git": false,
          "project": false,
          "attachment": true,
          "plan": false
        }
      }
    }

See [privacy notes](operations/privacy.md) and
[configuration troubleshooting](operations/troubleshooting.md) for the full
schema and filtering behavior.

## Remote provider: explicit opt-in

Warning: remote transmission begins only after configuration selects an
openai-compatible provider and you set its named environment variable to a real
key. That request can include the bounded draft and only enabled, trusted
context. Never put a key in .chat-suggestion.json. Review
[privacy notes](operations/privacy.md) first.

    {
      "provider": {
        "kind": "openai-compatible",
        "endpoint": "https://provider.example/v1/chat/completions",
        "model": "example-fast-model",
        "apiKeyEnvironmentVariable": "CHAT_SUGGEST_API_KEY",
        "timeoutMs": 10000,
        "maxTokens": 64,
        "requestsPerHour": 60,
        "outputProjection": "suffix"
      }
    }

Status redacts endpoint query strings and never prints a key. Metrics contain
timings, counters, status classes, and bucketed byte sizes only.

## Pi

Pi is the only native adapter exercised by this MVP. In a Pi TUI it can display
one visual line at the logical end of the draft. Native autocomplete has
priority. When a current suggestion is visible, Tab inserts it once and Escape
clears it. Editor conflicts, cursor/layout ambiguity, resize, paste, and session
changes clear the decoration.

The package now has a Pi `pi.extensions` entry and uses the model selected in
Pi. It stays silent when Pi has no selected model or cannot resolve credentials.
The model-backed editor debounces for 100 ms. Matching a visible ghost prefix
keeps its untyped remainder immediately without another provider call; a
mismatch clears it and schedules a new request. Safe text chunks render as they
arrive instead of waiting for the full response. Provider transport reuse is
kept separate from Pi's agent conversation, but cold-request latency still
depends on the selected model and network. After the package and its public
protocol dependency are published, install it with Pi's documented package
manager:

    pi install npm:@chat-suggestion/adapter-pi

The release is not published by this checkout. Until a release is available,
build locally and load the compiled entry with `pi -e`:

    npm run build
    pi -e "$PWD/adapters/pi/dist/production-extension.js"

This is a model-backed path: typing in Pi can send the bounded draft to the
selected provider. Review provider privacy and billing settings first. The
offline smoke extension below remains the credential-free rendering proof and
does not exercise model auth.

You can run the verified disposable offline smoke extension. It uses /tmp, no
provider, tools, saved session, extension discovery, or project-context files.
Type any three non-whitespace characters, such as fix auth, without submitting,
then wait about 150 ms for the deterministic dim end-of-line text. Try Tab and
Escape. This checks editor rendering and key handling only; it does not make a
real completion request. Pi's separate “No models available” warning does not
affect this offline check. Exit with Ctrl-D on an empty editor.

<!-- user-guide-command: pi-smoke -->

    PI_CODING_AGENT_DIR=/tmp/chat-suggestion-pi-smoke PI_OFFLINE=1 pi --offline --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-tools -e "$PWD/adapters/pi/smoke/offline-extension.ts"

This is a manual-host check. Remove /tmp/chat-suggestion-pi-smoke after the
smoke session if desired.

## Codex ghost text

Launching stock `codex` cannot show Chat Suggestion ghost text because that TUI
does not expose a documented live prompt-editor API. Use this repository's App
Server frontend instead:

<!-- user-guide-command: codex-frontend -->

    npm run chat-suggest -- codex

The frontend owns its editor. Type at least three characters and pause. Dim text
appears after the real draft; Tab inserts it without submitting, Escape clears
it, Enter sends only the accepted draft, Ctrl-C clears an unfinished line or
interrupts an active turn, and Ctrl-D exits when the editor is empty. Agent text
streams below the editor and the same coding thread continues after each turn.

This is a remote/model-backed command. When no OpenAI-compatible suggestion
provider is configured, it creates a separate ephemeral, read-only Codex thread
for suggestion generation and uses the installed Codex account and selected
model. Suggestions can consume Codex quota. The coding conversation uses a
different normal thread. App Server approval requests currently fail closed;
tasks requiring an escalation should be continued in stock Codex.

The default Codex suggestion timeout is 8,000 ms, separate from the general
1,800 ms provider timeout. You can select any model exposed by your Codex
installation without hardcoding a local path:

    {
      "codexSuggestionTimeoutMs": 8000,
      "codexSuggestionModel": "your-available-codex-model"
    }

For a rendering-only check, initialize the real App Server but keep suggestion
generation deterministic and offline:

    npm run chat-suggest -- codex --provider fake

Type exactly `fix the failing auth`, do not press Enter, and wait for
` tests and add a regression test`. Tab must insert it without starting a coding
turn. Clear the line with Ctrl-C, then exit with Ctrl-D. `--provider fake`
covers only suggestion generation; pressing Enter still sends the draft to
Codex.

## Claude, companion plugins, and experimental PTY

The repository also includes installable companion plugin directories under
`plugins/codex-chat-suggestion/` and `plugins/claude-chat-suggestion/`. Their
`chat-suggest` skills are manual, post-submit continuations only. The stock
Codex and Claude editors still report `inlineRender: none`; neither plugin can
observe a live draft or paint ghost text.

Executable discovery is not semantic editor access. The stock Codex TUI is not
supported for inline suggestions; the `chat-suggest codex` command above is the
separately owned editor. The stock Claude TUI is not supported either: hooks and
configuration do not expose the live draft, cursor, decoration, and atomic
non-submitting insertion.

Experimental PTY support is adjacent, not inline. It is limited to macOS and
Linux where the optional dependency loads. It suspends on hidden input, cursor
movement, redraw, resize, paste, completion UI, and unknown terminal sequences.
In ambiguous states Tab passes through normally; terminal state is restored on
exit.

Warning: the wrapper needs "experimentalPty": true in configuration, an explicit
acknowledgement, and an allowlisted codex or claude command. No exact
fixture-tested executable profile is packaged, so this release refuses before
child launch with exit status 78.

<!-- user-guide-command: pty-refusal -->

    npm run chat-suggest -- wrap --experimental-pty -- codex

This refusal is expected. See
[compatibility evidence](operations/compatibility.md). It is not the Codex
launch command; use `npm run chat-suggest -- codex`.

## Troubleshooting, disable, and uninstall

If status reports runtime-handshake-required, use the Pi smoke path in a Pi TUI;
the standalone CLI does not own the Pi editor. If another extension owns the
custom editor, leave it in place. If context is not collected, add the exact
project path to trustedProjects or make one preview with --trust-project. The
[troubleshooting guide](operations/troubleshooting.md) lists verified downgrade
reasons.

To disable standalone use, set "enabled": false in .chat-suggestion.json or
remove that file if you created it solely for Chat Suggestion. The smoke
extension is loaded only for its one command and leaves no Pi package
installation to remove. Do not delete general Pi, Codex, Claude, shell, cache,
or credential configuration.

To uninstall a checkout, stop any smoke session, remove only the checkout and
any .chat-suggestion.json you created for it, and revoke any provider credential
you separately created. A future Pi package must use its documented pi remove
command rather than manual settings deletion.

## Evidence and limits

[Command evidence](verification/user-guide-command-evidence.md) records redacted
results and versions. The
[command manifest](test/user-guide-command-manifest.json) drives offline
documentation tests; Pi and PTY remain manual. See
[product requirements](../PRD.md) for the full safety model.
