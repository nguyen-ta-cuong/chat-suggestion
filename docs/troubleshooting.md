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

Pi's autocomplete has priority. Close the autocomplete menu and wait for a new
suggestion. A resize, cursor move, paste, or newer edit also invalidates the old
candidate by design.

## Suggestions disappear while typing

If typed characters match the visible suffix, the extension retains the
remaining text locally. A mismatch cancels the candidate and debounces a new
request. Slow results from an older revision are discarded.

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

Run `pi update --extensions`, then restart Pi. For a local checkout loaded with
`pi -e`, restart that Pi process after changing extension source.
