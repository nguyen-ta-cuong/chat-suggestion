# Ghost-text stability and TUI review

## Symptom and root cause

A suggestion could appear as dim ghost text and disappear on a later provider or
render event even when the user supplied no input. Version 0.1.2 retained a safe
partial for known `null` and error endings, but two destructive boundaries
remained:

1. The model emitted a safe `text_delta`, which the editor rendered.
2. A non-null final candidate copied raw `usage.output`. Pi includes reported
   reasoning tokens in this value, so it could exceed the 64-token candidate
   protocol even when the visible text was short.
3. The bridge preferred that non-null but protocol-invalid final candidate over
   its valid partial.
4. The editor rejected the final candidate and removed the already-visible
   partial. The editor also removed the partial when any bridge returned `null`
   or threw.

A direct 0.1.2 reproduction showed the ghost visible during streaming and gone
after a same-text final candidate with `tokenCount: 65`. Removing a previously
validated partial added no safety boundary; it only produced the flash.

Rendering also conflated candidate validity with presentation. Async native
autocomplete, focus loss, no-room layouts, or terminal width changes could
permanently clear current state during a non-input render.

## Changes made

- Make published partials monotonic for an active request. `null`, invalid final
  metadata, and non-abort failures retain the last-known-good partial; explicit
  cancellation and editor invalidation still clear it.
- Validate every bridge candidate with the shared runtime protocol before
  publishing or returning it, and drop malformed Unicode.
- Normalize provider usage to visible output tokens by subtracting valid
  reasoning usage and bounding the result to the protocol maximum.
- Separate validity from presentation. Resize reflows against the new width;
  autocomplete, focus loss, and no-room layouts temporarily suppress the ghost. Tab
  accepts only a candidate visibly placed by the latest render.
- Wait 250 ms and require three non-whitespace characters before requesting a
  suggestion, avoiding low-value calls and between-keystroke flashes.
- Report the loaded package version and last privacy-safe clear reason through
  `/chat-suggest`; no prompt or suggestion content is recorded.
- Show `Tab accept` and `Esc dismiss` in the active footer status so the controls
  are discoverable without opening the user guide.

The safety invariants are unchanged: candidates remain insertion-only visual
decoration, must match the current request/revision/text/cursor, never contain
terminal controls or multiple lines, and are revalidated before render and Tab
acceptance.

## Performance and UI/UX follow-ups

The following points are ordered by expected value and should be measured before
implementation:

1. **Coalesce partial paint updates.** Fast providers may emit many deltas. Track
   rendered frames and consider publishing at a short frame interval if Pi's
   render scheduler does not already coalesce them.
2. **Cache conversation conversion per session leaf.** The active conversation
   is unchanged across edits to one draft. Reusing the converted LLM messages
   can reduce CPU and allocation work, but cache invalidation must use a public
   Pi session identity API.
3. **Add public pending-autocomplete awareness.** Pi currently exposes whether
   autocomplete is visible, not whether an async completion request is pending.
   A lifecycle API would let the extension avoid painting immediately before a
   slow native menu appears.
4. **Make pacing adaptive only with evidence.** The 250 ms default is a balanced
   baseline. Faster or slower delays should follow measured typing cadence,
   provider latency, and request cancellation rates rather than adding an
   animation or timer that creates more flicker.
5. **Improve custom-editor composition.** Pi currently has one custom-editor
   surface. The extension correctly fails closed on a conflict; a future public
   composition contract could avoid forcing users to choose between extensions.

## Method and references

This change used the
[Ralph Wiggum technique](https://ghuntley.com/ralph/): search before assuming a
missing implementation, choose one highest-value item per iteration, run the
smallest relevant test as backpressure, and then run the full validation suite.
The regression test was written to fail before the production fix and to pass
after it.

Implementation decisions also follow Pi's documented public APIs and TUI rules:

- [Project architecture](architecture.md)
- [Pi extensions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi TUI components](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/tui.md)
- [Pi keybindings](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md)
