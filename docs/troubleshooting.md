# Troubleshooting

## No suggestion appears

Run `/chat-suggest` inside Pi. The command reports the active capability.

- `capability native eol-only` means the editor is active. Confirm a model is
  selected and authenticated, type at the end of the prompt, and wait briefly.
- `another extension already owns the custom editor` means Pi already has a
  custom editor. Disable either extension and restart or reload Pi.
- A non-TUI mode cannot display ghost text. Start Pi interactively.

The model bridge stays silent when Pi has no model or cannot resolve provider
credentials. Verify the selected model works for an ordinary Pi prompt.

## Tab does not accept

Pi's autocomplete has priority. Close the autocomplete menu; a still-current
ghost can reappear after the menu closes. A ghost hidden for lack of room or
focus is not Tab-acceptable until it is visibly rendered again. Cursor movement, paste, or a
newer edit invalidates the old candidate by design.

## Suggestions disappear while typing

If typed characters match the visible suffix, the extension retains the
remaining text locally. A mismatch cancels the candidate and debounces a new
request. Slow results from an older revision are discarded. The 250 ms pause and
three-character minimum keep low-signal requests from flashing between ordinary
keystrokes.

## A suggestion flashes and disappears without input

Version 0.1.2 fixed several provider endings but still had two destructive
boundaries. Raw provider output usage, which can include reasoning tokens, could
produce a non-null candidate rejected by the protocol after its safe partial was
already visible. The editor also removed a valid partial whenever any bridge
later returned `null`, returned invalid metadata, or threw.

Version 0.1.3 validates every bridge candidate and makes a published partial
monotonic for its active request. Provider settlement cannot remove it. Resize,
focus loss, no-room layouts, and visible autocomplete now suppress presentation without
destroying the candidate; mismatching edits, cursor movement, submission,
session/model change, cancellation, disable, and Escape remain explicit
invalidations. Typing a matching prefix retains the remaining suffix locally.

Run `/chat-suggest` after the disappearance. It reports the loaded version and
last privacy-safe clear reason without recording prompt or suggestion text. A
reported clear reason identifies an explicit invalidation. No new clear reason
usually means transient presentation suppression; note whether `/`, `@`, or `#`
opened native autocomplete and whether the terminal or focus changed.

## Local development fails to resolve Pi

Install dependencies from the repository root with `npm install`. Development
dependencies pin Pi 0.80.6 for reproducible types and tests; the published
extension declares Pi's core modules as peer dependencies, as required by Pi's
package format.

Run the full project checks:

```sh
npm run check
```

## The installed package is stale

Run `pi update --extensions`, then use `/reload` or restart Pi. Updating the
installed files does not replace code already loaded in a running process. Run
`/chat-suggest` and confirm it reports version 0.1.3 or newer. For a local
checkout loaded with `pi -e`, restart that Pi process after changing extension
source.
