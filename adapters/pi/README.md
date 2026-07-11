# Pi native adapter

This package provides the public-API-only Pi editor adapter for chat suggestions. It was verified against `@earendil-works/pi-coding-agent` 0.80.6 and its bundled `@earendil-works/pi-tui` package.

The native capability is deliberately narrow: `transport: native`, `inlineRender: eol-only`, atomic insertion through `insertTextAtCursor()`, cancellation, resize invalidation, and native autocomplete awareness. The suggestion is rendered from `CustomEditor.render()` output without changing `getText()`. It is limited to one visual line at the logical end of the draft. Any cursor ambiguity, resize, native autocomplete, session change, or unsupported mode clears the decoration. If another extension already owns the custom editor factory, this adapter reports `none` and leaves that editor untouched.

The package lists Pi core modules and `@earendil-works/pi-ai` as `peerDependencies` with the `*` range, as required by Pi's package documentation. The default `pi.extensions` entry is model-backed and uses the model and credentials selected inside Pi. If no model or credentials resolve, it stays silent and leaves the editor unchanged. The deterministic smoke bridge remains under `adapters/pi/smoke/` and is not reachable from the published entry point.

After the package and its public protocol dependency are published, install it
with Pi's package manager:

    pi install npm:@chat-suggestion/adapter-pi

For a local, credential-free load check, build first and point Pi at the
compiled production entry. This does not make a provider request until you
type in a TUI with a selected model:

    npm run build
    pi -e "$PWD/adapters/pi/dist/production-extension.js"

The model-backed path sends the bounded draft to Pi's selected provider. Review
that provider's privacy and billing settings before trying it. Do not use the
offline smoke extension as evidence that model auth is configured.

## Commands

Inside Pi, `/chat-suggest on` enables generation, `/chat-suggest off` disables and clears it, and `/chat-suggest` reports the active capability or downgrade reason. No command logs draft or completion text.

## Offline smoke test

Build the workspace protocol package first, then run this disposable extension from the repository root:

    npm run build --workspace @chat-suggestion/protocol
    PI_CODING_AGENT_DIR=/tmp/chat-suggestion-pi-smoke PI_OFFLINE=1 pi --offline --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-tools -e "$PWD/adapters/pi/smoke/offline-extension.ts"

Type any three non-whitespace characters, such as `fix auth`, without submitting. After 150 ms, the editor shows ` tests and add a regression test` as dim end-of-line text. Tab inserts it once. Escape dismisses it. The smoke bridge is deterministic, reads no session history or files, has no network path, and cannot start a paid model turn unless the user explicitly submits a prompt after the test. Pi's separate “No models available” warning does not affect this offline check.

Exit with Ctrl-D on an empty editor. The isolated configuration is confined to `/tmp/chat-suggestion-pi-smoke`; remove that directory after testing if desired.

## Compatibility notes

The implementation uses only surfaces documented in Pi 0.80.6: `ctx.mode`, `ctx.ui.getEditorComponent()`, `ctx.ui.setEditorComponent()`, `CustomEditor`, injected theme/keybindings, `getText()`, `getCursor()`, `insertTextAtCursor()`, `isShowingAutocomplete()`, `render()`, `CURSOR_MARKER`, `visibleWidth()`, and `truncateToWidth()`. It does not import private renderer modules, inspect binaries, or modify the installed Pi package.
