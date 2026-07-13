# User guide

## How suggestions behave

Chat Suggestion adds dim text at the logical end of Pi's prompt editor after a
100 ms typing pause. The text is a visual decoration until you explicitly
accept it.

- Press Tab to insert a current suggestion without submitting the prompt.
- Press Escape to dismiss a current suggestion.
- Continue typing to keep a matching remainder or request a new suggestion.
- Move the cursor, paste, resize, open autocomplete, change sessions, submit,
  or start an agent turn to clear the suggestion.

When no suggestion is visible, all keys retain Pi's normal behavior. Native
autocomplete always has priority over suggestion acceptance.

## Requirements

- Pi 0.80.6 or newer.
- A model selected and authenticated in Pi for live suggestions.
- A terminal session running Pi in interactive TUI mode.

The extension does not run in Pi's print, JSON, or RPC modes. It also disables
itself when another extension already owns Pi's custom editor.

## Install from the Pi package gallery

Pi packages execute with your user permissions. Inspect the
[package listing](https://pi.dev/packages/@chat-suggestion/adapter-pi?name=chat-suggestion),
source, and dependencies before installation.

```sh
pi install npm:@chat-suggestion/adapter-pi
```

Restart Pi after installation. Pi records the npm package in its user settings
and loads the extension declared by the package manifest.

To install only for one project, run the command with Pi's local flag from that
project:

```sh
pi install -l npm:@chat-suggestion/adapter-pi
```

Project-local packages load only after Pi trusts the project.

## Try a local checkout

Install dependencies and load the extension for one Pi process:

```sh
npm install
pi -e ./src/production-extension.ts
```

This path is model-backed. Typing a draft can send that draft to the provider
selected in Pi and may consume quota.

## Offline rendering check

The example extension uses a fixed local suffix and never calls a model. It is
useful for checking ghost-text rendering and key handling:

```sh
PI_OFFLINE=1 pi --offline --no-session --no-extensions --no-skills \
  --no-prompt-templates --no-context-files --no-tools \
  -e ./examples/offline-extension.ts
```

Type at least three non-whitespace characters without pressing Enter. After
150 ms, the fixed suffix appears. Test Tab and Escape, then exit Pi from an
empty editor. Do not submit the example prompt if you want the entire check to
remain local.

## Commands

`/chat-suggest` reports whether suggestions are on and whether the native
end-of-line editor is active. `/chat-suggest off` cancels generation and clears
the decoration. `/chat-suggest on` enables generation again.

The enabled state lasts for the current Pi process. Use `pi config` when you
want to disable or enable the installed extension itself.

## Privacy and provider use

For each eligible edit, the model-backed extension sends Pi's active,
compaction-aware conversation followed by the current prompt draft to the model
provider already selected in Pi. It sends one short system instruction and
requests at most 64 output tokens. The active Pi session ID is also forwarded
to providers that support session affinity.

Conversation messages can include earlier tool results, file contents,
attachments, or project instructions already present in Pi's active context.
The extension does not independently scan repository files or Git data, and it
does not log drafts or suggestions. Provider authentication is resolved through
Pi; the extension does not store credentials.

The draft is limited to 8 KiB. Returned suggestions are limited to one line,
160 Unicode code points, and 1 KiB. Terminal control sequences and invalid
results are rejected before rendering.

See [privacy and security](privacy.md) for the complete data flow.

## Compatibility limits

The extension renders only at the logical end of a prompt and only when the
ghost fits safely on the current visual line. It clears on a width change rather
than attempting to reuse stale layout. Multiline prompts are supported only
when the cursor is at the end of the final logical line.

Pi currently exposes one custom editor owner. If another extension already set
one, Chat Suggestion leaves it untouched and reports an editor conflict. Remove
or disable one of the extensions if you want to switch ownership.

## Update and uninstall

Update all installed Pi packages:

```sh
pi update --extensions
```

Remove the global package:

```sh
pi remove npm:@chat-suggestion/adapter-pi
```

For a project-local installation, run the same command with `-l` from that
project. These commands let Pi update its own settings; do not manually delete
unrelated Pi configuration or credentials.

## Troubleshooting

See [troubleshooting.md](troubleshooting.md) for missing suggestions, editor
conflicts, provider failures, and development checks.
