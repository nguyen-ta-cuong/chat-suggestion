# Chat Suggestion for Pi

Chat Suggestion is a Pi extension that shows a short inline continuation while
you write a prompt. The continuation is dimmed decoration: it does not become
part of the prompt until you press Tab, and it is never submitted or executed
automatically.

This project supports [Pi](https://pi.dev/) only.

## Features

- Native end-of-line ghost text in Pi's terminal editor.
- Streaming suggestions from the model already selected in Pi.
- Active conversation context for more relevant prompt continuations.
- Tab accepts the current suggestion once; Escape dismisses it.
- Matching typed text keeps the remaining suffix; mismatching edits, cursor
  movement, paste, session changes, and stale responses invalidate it.
- Resize, focus loss, and native autocomplete temporarily hide a current ghost
  instead of destroying it; Tab accepts only while a ghost is visibly rendered.
- Model output is bounded and stripped of terminal control sequences.
- No independent repository scanning, prompt logging, or telemetry.
- Suggestions fail closed when Pi cannot provide a safe editor surface.

## Install

Review the source before installing because Pi extensions run with your user
permissions. Review the package in the
[Pi package gallery](https://pi.dev/packages/@chat-suggestion/adapter-pi?name=chat-suggestion),
then install it from npm through Pi:

```sh
pi install npm:@chat-suggestion/adapter-pi
```

Start a new Pi session and type at the end of a prompt. After a short pause, a
dim continuation may appear. The extension uses Pi's selected model and
credentials, so suggestion requests may use provider quota. After an update,
run `/reload` or restart Pi so the running process loads the installed version.

Inside Pi:

```text
/chat-suggest
/chat-suggest off
/chat-suggest on
```

The status command reports the loaded package version, native editor capability,
and last privacy-safe clear reason. Turning the extension off immediately clears
pending and visible suggestions.

To remove the package:

```sh
pi remove npm:@chat-suggestion/adapter-pi
```

See the [user guide](docs/user-guide.md) for local installation, an offline
rendering check, privacy details, behavior, and troubleshooting.

## Development

Requirements are Node.js 20 or newer, npm, and Pi 0.80.6 or newer.

```sh
git clone https://github.com/nguyen-ta-cuong/chat-suggestion.git
cd chat-suggestion
npm install
npm run check
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. The
[architecture guide](docs/architecture.md) explains the safety boundaries and
request lifecycle. The [TUI stability review](docs/flicker-performance-review.md)
documents the ghost-text root cause, implemented optimizations, follow-up priorities,
and the Ralph iteration method used for the fix.

## Project status

The extension intentionally supports one visual line at the logical end of the
prompt. It yields to Pi's native autocomplete and does not replace another
extension's custom editor. These constraints keep acceptance atomic and protect
normal Pi keybindings.

## License

[MIT](LICENSE)
