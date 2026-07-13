# Ghost-text stability and TUI review

## Symptom and root cause

A suggestion could appear as dim ghost text and disappear on the next provider
event even when the user supplied no input. The deterministic sequence was:

1. The model emitted a safe `text_delta`.
2. The bridge published it and the editor rendered it immediately.
3. The terminal `done` message contained a newline or otherwise failed final
   validation, or the stream reported or threw an error.
4. The bridge returned `null`, so the editor removed the candidate for that
   request.

The candidate was already safe, current, and available for Tab acceptance in
step 2. Removing it in step 4 added no safety boundary; it only produced a
visible flash. A regression test now drives the real bridge through a safe
partial followed by an invalid final message.

Native autocomplete opening asynchronously, a terminal width change, loss of a
known cursor layout, a session or model transition, submission, and agent start
remain intentional invalidation paths. These are separate from the provider
stream defect.

## Changes made

- Retain the latest validated streamed candidate when the provider's terminal
  event is unusable, reports an error, or the stream throws. Cancellation still
  returns no fallback.
- Wait 250 ms and require three non-whitespace characters before requesting a
  suggestion. This avoids low-value model calls and between-keystroke flashes.
- Avoid requesting a second TUI render when the current render already removed
  a stale decoration.
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
3. **Expose privacy-safe diagnostics.** A command could report counts by clear
   reason without recording prompts or suggestion text. This would distinguish
   provider fallback, autocomplete, resize, and stale-revision behavior in real
   terminals.
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
