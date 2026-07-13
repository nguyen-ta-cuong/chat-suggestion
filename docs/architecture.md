# Architecture

Chat Suggestion is one Pi extension with four focused layers.

1. `src/production-extension.ts` connects the extension to Pi's selected model.
2. `src/pi-extension.ts` owns Pi lifecycle events, commands, and custom-editor
   installation.
3. `src/pi-suggestion-editor.ts` owns debounce, cancellation, prompt revisions,
   key arbitration, stale-result rejection, and atomic acceptance.
4. `src/pi-model-bridge.ts` requests and sanitizes short model continuations;
   `src/render-ghost.ts` decorates Pi's rendered line without changing the
   editor buffer.

`src/suggestion.ts` contains the small data contract and validation limits used
at the bridge/editor boundary.

## Request lifecycle

Every text edit increments an immutable prompt revision. Eligible drafts contain
at least three non-whitespace characters and settle for 250 ms before the editor
creates a request ID and an `AbortController`. A later edit cancels that
controller before starting new work.

Streamed and final candidates must match the current request ID, revision,
draft text, cursor byte offset, and insertion position. The model bridge retains
the latest protocol-valid streamed candidate as a fallback when a terminal
provider event is invalid, reports an error, or the stream throws. The editor is
the final last-known-good authority: once it publishes a current partial,
provider settlement cannot remove that partial. Only an explicit editor
invalidation or cancellation can revoke it.

The editor repeats freshness checks immediately before rendering and immediately
before Tab acceptance, so a late result cannot become visible or enter a newer
draft.

The accepted edit is insertion-only at the current cursor. Replacement edits
are not supported.

## Rendering boundary

The editor extends Pi's documented `CustomEditor` and delegates every key it
does not consume to `super.handleInput`. Ghost text is added only to the array
returned by `render`; it is never added to `getText()`.

Candidate validity and candidate visibility are separate state. Resize, focus
loss, visible autocomplete, or a line with no room for a ghost can suppress one render without
destroying a current candidate. The editor recomputes decoration against each
render width, and Tab acceptance is enabled only after that render visibly
placed ghost text. Stale text/cursor identity remains a permanent invalidation.
A custom editor already installed by another extension is never replaced
silently.

## Model boundary

The model bridge uses Pi's selected model and credential resolver. It converts
Pi's active, compaction-aware session entries through Pi's own LLM-message
conversion, then appends the unsent draft as the final user message. The active
session ID is forwarded for providers that support session affinity. The
extension does not independently read repository files or project context.

Output is treated as untrusted: ANSI/OSC sequences, control characters,
malformed Unicode, multiline text, oversized text, stale identity, and
non-insertion edits are rejected. Every constructed bridge candidate passes the
same runtime protocol validator used by the editor. Provider output usage is
normalized to visible tokens by subtracting reported reasoning tokens, then
bounded to the protocol limit; provider billing metadata cannot invalidate safe
visible text.

## Testing

Unit tests use deterministic bridges and synthetic editor state. They cover
streaming settlement, invalid final metadata, cancellation, stale work,
Tab/Escape arbitration, autocomplete and focus suppression, malformed Unicode,
Unicode width, resize, extension lifecycle diagnostics, provider failures, and
package contents. Tests do not require credentials or model requests.
