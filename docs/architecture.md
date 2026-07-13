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
the latest validated streamed candidate as a fallback when a terminal provider
event is invalid, reports an error, or the stream throws. This prevents an
already-actionable ghost from flashing and disappearing; the same candidate was
safe to accept while the
stream was active. The editor repeats freshness checks immediately before
rendering and immediately before Tab acceptance, so a late result cannot become
visible or enter a newer draft.

The accepted edit is insertion-only at the current cursor. Replacement edits
are not supported.

## Rendering boundary

The editor extends Pi's documented `CustomEditor` and delegates every key it
does not consume to `super.handleInput`. Ghost text is added only to the array
returned by `render`; it is never added to `getText()`.

Rendering fails closed when the cursor marker is unknown, autocomplete is open,
the cursor is not at the logical end, the terminal width changed, or the suffix
does not fit. A render-time invalidation updates state without requesting a
redundant second render. A custom editor already installed by another extension
is never replaced silently.

## Model boundary

The model bridge uses Pi's selected model and credential resolver. It converts
Pi's active, compaction-aware session entries through Pi's own LLM-message
conversion, then appends the unsent draft as the final user message. The active
session ID is forwarded for providers that support session affinity. The
extension does not independently read repository files or project context.

Output is treated as untrusted: ANSI/OSC sequences, control characters,
multiline text, oversized text, stale identity, and non-insertion edits are
rejected.

## Testing

Unit tests use deterministic bridges and synthetic editor state. They cover
streaming, cancellation, stale work, Tab/Escape arbitration, autocomplete,
paste, Unicode width, resize, extension lifecycle, provider failures, and
package contents. Tests do not require credentials or model requests.
