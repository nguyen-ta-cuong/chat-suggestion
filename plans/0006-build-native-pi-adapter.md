# Build the native Pi ghost-text adapter

This ExecPlan is a living document maintained under `PLANS.md`. Run it after plan 0001. It owns `adapters/pi/**` only.

## Purpose / Big Picture

Deliver the first native user experience. In Pi TUI mode, typing at the logical end of a prompt and pausing shows a one-line dim suffix; Tab inserts it exactly once, Escape dismisses it, and ordinary Pi editing/autocomplete/application shortcuts remain unchanged when no current suffix is visible. Unsafe editor composition downgrades instead of silently replacing another extension.

## Progress

- [x] (2026-07-11T13:20:09Z) Fixed the offline smoke bridge so any ordinary
  three-character draft proves native ghost rendering; added direct bridge
  coverage for short and aborted input.
- [ ] Read the installed Pi extension, TUI, keybinding, package docs and linked custom-editor examples completely.
- [ ] Build a public-API-only rendering spike and record feasibility evidence.
- [ ] Implement editor observation, lifecycle, engine bridge, key arbitration, and fallback.
- [ ] Add fake-TUI/editor tests plus a disposable Pi smoke test.
- [ ] Run checks, document packaging, and update living sections.

## Surprises & Discoveries

- Observation: Pi has a custom editor API but no first-class ghost decoration API.
  Evidence: `ctx.ui.setEditorComponent`, `CustomEditor`, and `render()` are documented; inline suggestion decoration is not.
- Observation: The smoke extension reported `eol-only` after a successful editor
  handshake, but silently returned no candidate for every draft except one fixed
  phrase.
  Evidence: `offline-extension.ts` gated its bridge with
  `snapshot.text.endsWith("fix auth")`; a `tes` draft therefore rendered no
  ghost despite the active capability status.

## Decision Log

- Decision: Initial inline rendering is end-of-input and one visual line only.
  Rationale: Arbitrary-cursor multiline rendering depends on private editor layout and risks cursor/IME corruption.
  Date: 2026-07-11
- Decision: Consume injected `tui.input.tab` only for a visible current candidate and delegate every other input to `super.handleInput(data)`.
  Rationale: This preserves user keybindings, native autocomplete, and application behavior.
  Date: 2026-07-11
- Decision: Make the offline smoke bridge produce its fixed safe suffix for any
  three-or-more-character non-whitespace draft.
  Rationale: The smoke workflow should demonstrate the native editor path without
  requiring a hidden magic phrase or implying that it is a real provider.
  Date: 2026-07-11

## Outcomes & Retrospective

Post-implementation maintenance on 2026-07-11 corrected the offline smoke
workflow: a normal three-character draft now proves the native end-of-input
ghost path rather than requiring an undisclosed exact phrase. Adapter tests,
type checking, build, documentation checks, and the full workspace validation
suite passed after the change. This remains an offline rendering and key-handling
probe; a configured remote completion provider is a separate integration
concern. Successful completion requires the native end-of-input inline path to
pass. If only adjacent or disabled mode is feasible through public APIs, mark
this plan blocked, preserve the evidence, and require an explicit PRD/release-
scope decision in plan 0010.

## Context and Orientation

Resolve the installed `@earendil-works/pi-coding-agent` package root through the workspace dependency, `require.resolve`, or `npm root -g`; do not assume one user's NVM path. If the package/docs are unavailable, report a version/environment blocker. Before coding, completely read `docs/extensions.md`, `docs/tui.md`, `docs/keybindings.md`, `docs/packages.md`, their relevant markdown cross-references, and `examples/extensions/modal-editor.ts`, `rainbow-editor.ts`, and autocomplete examples.

Verified public surfaces include `ctx.ui.getEditorComponent()`, `setEditorComponent()`, `CustomEditor`, `getText()`, `getCursor()`, `getExpandedText()`, `insertTextAtCursor()`, `isShowingAutocomplete()`, `render()`, injected theme/keybindings, `ctx.sessionManager`, and independent model APIs. Use only public exports. The adapter receives engine/provider/context abstractions through dependency injection or protocol-compatible test doubles; those packages may still be under parallel development.

## Plan of Work

First create a rendering spike inside adapter tests. Subclass `CustomEditor`, retain the provided TUI/theme/keybindings, call `super.render(width)`, and prove a dim EOL suffix can be inserted without losing the cursor marker, exceeding visible width, or altering the real text. Test narrow width, soft wrap boundary, emoji/CJK/combining marks, resize, and autocomplete visibility. If public APIs cannot satisfy this, record evidence and stop with the plan marked blocked; an adjacent-widget prototype may document graceful degradation but does not satisfy this plan or the MVP release gate. Do not copy private Pi renderer source.

Install only in `ctx.mode === "tui"`. Capture the existing editor factory before setting one. If it is safely composable, wrap it according to public interfaces; if cursor/render semantics are unavailable, report a structured downgrade instead of replacing it. Observe text/cursor changes and emit immutable snapshots. Use adapter-owned `AbortController` for idle generation. Clear on every edit, cursor change, submit, session lifecycle change, model change, agent activity, resize, and disposal.

Arbitrate keys in this order: native autocomplete/reference UI, current ghost acceptance, normal editor handling. Escape dismisses a visible ghost; a later Escape behaves normally. Insert through `insertTextAtCursor`, never `setEditorText` plus submit, paste simulation, or raw terminal bytes. Use theme `dim`/`muted`, width utilities, and preserve `CURSOR_MARKER`/focus behavior.

Expose commands for enable/disable and capability/status. Package using Pi package conventions and peer dependencies, without bundling Pi core packages.

## Concrete Steps

From the root:

    npm test --workspace @chat-suggestion/adapter-pi
    npm run typecheck --workspace @chat-suggestion/adapter-pi
    npm run build --workspace @chat-suggestion/adapter-pi

Then launch a disposable smoke extension with the installed Pi command and fake provider, following current docs. The smoke test must not start a paid model turn or read private session content. Document the exact command in the package README; use `pi -e <built-extension>` when supported.

## Validation and Acceptance

Tests prove text is unchanged by rendering; Tab inserts a suffix once; Tab delegates when no ghost or autocomplete is visible; Escape dismissal does not invoke interrupt on that first press; late provider results cannot show; submit/dispose clear; TUI-only guard works; existing custom editor conflict produces a downgrade; ANSI/control output is rejected; widths and cursor markers remain correct for Unicode and resize.

A human smoke test using the fake provider types a known prefix, sees dim text, accepts it, edits normally, opens autocomplete, and reloads the extension without terminal artifacts.

## Idempotence and Recovery

The extension must unregister/restore state on reload or shutdown where the API permits. Smoke configuration stays local to the command and does not modify the user's global Pi settings. Never edit installed Pi files. Do not update the root lockfile.

## Artifacts and Notes

Record the exact Pi version and docs/API assumptions in `adapters/pi/README.md`. Treat any render post-processing dependency as a compatibility risk and test it.

## Interfaces and Dependencies

Declare Pi core packages as `peerDependencies` with versions consistent with official package guidance. Export an extension factory and a testable `PiSuggestionEditor`. Keep Pi types inside this package. The adapter's public capability must honestly report `eol-only`, `adjacent`, or `none` based on the successful runtime path.

Revision note: Initial native-adapter plan created 2026-07-11 from verified Pi 0.80.6 APIs.
