# Pi native adapter

This package provides the public-API-only Pi editor adapter for chat suggestions. It was verified against `@earendil-works/pi-coding-agent` 0.80.6 and its bundled `@earendil-works/pi-tui` package.

The native capability is deliberately narrow: `transport: native`, `inlineRender: eol-only`, atomic insertion through `insertTextAtCursor()`, cancellation, resize invalidation, and native autocomplete awareness. The suggestion is rendered from `CustomEditor.render()` output without changing `getText()`. It is limited to one visual line at the logical end of the draft. Any cursor ambiguity, resize, native autocomplete, session change, or unsupported mode clears the decoration. If another extension already owns the custom editor factory, this adapter reports `none` and leaves that editor untouched.

The package lists Pi core modules as `peerDependencies` with the `*` range, as required by Pi's package documentation. Plan 0010 owns application wiring; consumers inject a `SuggestionBridge` into `createPiSuggestionExtension()`.

## Commands

Inside Pi, `/chat-suggest on` enables generation, `/chat-suggest off` disables and clears it, and `/chat-suggest` reports the active capability or downgrade reason. No command logs draft or completion text.

## Offline smoke test

Build the workspace protocol package first, then run this disposable extension from the repository root:

    npm run build --workspace @chat-suggestion/protocol
    PI_CODING_AGENT_DIR=/tmp/chat-suggestion-pi-smoke PI_OFFLINE=1 pi --offline --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-tools -e "$PWD/adapters/pi/smoke/offline-extension.ts"

Type `fix auth` without submitting. After 150 ms, the editor shows ` tests and add a regression test` as dim end-of-line text. Tab inserts it once. Escape dismisses it. The smoke bridge is deterministic, reads no session history or files, has no network path, and cannot start a paid model turn unless the user explicitly submits a prompt after the test.

Exit with Ctrl-D on an empty editor. The isolated configuration is confined to `/tmp/chat-suggestion-pi-smoke`; remove that directory after testing if desired.

## Compatibility notes

The implementation uses only surfaces documented in Pi 0.80.6: `ctx.mode`, `ctx.ui.getEditorComponent()`, `ctx.ui.setEditorComponent()`, `CustomEditor`, injected theme/keybindings, `getText()`, `getCursor()`, `insertTextAtCursor()`, `isShowingAutocomplete()`, `render()`, `CURSOR_MARKER`, `visibleWidth()`, and `truncateToWidth()`. It does not import private renderer modules, inspect binaries, or modify the installed Pi package.
