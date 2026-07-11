# Build terminal safety primitives and the conformance fixture

This ExecPlan is a living document maintained under `PLANS.md`. Run it after plan 0001. It owns `packages/terminal/**` and `fixtures/tui/**` only.

## Purpose / Big Picture

Create shared, agent-neutral terminal safety code and an open fixture program that adapters can test without Codex, Claude, or private internals. After this plan, tests can prove control-sequence sanitizing, Unicode display width, conservative input confidence, virtual terminal scenarios, resize behavior, and exact byte forwarding.

## Progress

- [ ] Inspect protocol terminal capabilities and define confidence states.
- [ ] Implement output sanitizing, grapheme/width helpers, and safe dim rendering primitives.
- [ ] Implement conservative append/backspace input tracking and downgrade reasons.
- [ ] Build the fixture TUI scenarios and transcript runner.
- [ ] Add conformance tests, run checks, and update living sections.

## Surprises & Discoveries

- Observation: None yet.
  Evidence: Update during implementation.

## Decision Log

- Decision: Terminal state is a confidence state machine, not a best-guess boolean.
  Rationale: Unknown input or output must produce a traceable downgrade and prevent interception.
  Date: 2026-07-11
- Decision: The fixture, not proprietary CLI snapshots, is the normative PTY test target.
  Rationale: Tests remain reproducible and legal while exercising the same terminal protocols.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, list supported sequences, downgrade triggers, and transcript evidence.

## Context and Orientation

`packages/terminal` contains pure or stream-oriented utilities; it does not spawn an agent. `fixtures/tui` is a tiny executable used by PTY and adapter tests. Agent-specific prompt detectors belong in their adapter packages. A full terminal emulator is not an MVP requirement, and unsafe inline compositing must not be implied.

## Plan of Work

Implement sanitization that removes ANSI CSI, OSC (including clipboard), DCS, NUL, carriage return, and disallowed C0 controls from model text while enforcing bytes, characters, and line limits. Implement grapheme iteration and terminal cell-width handling for ASCII, combining marks, emoji, and CJK using a justified small dependency only if standard APIs are insufficient.

Implement `InputConfidenceTracker` with states such as `known-eol`, `ambiguous`, `hidden`, `suspended`, and structured reasons. It may track printable append, configured backspace, and bracketed paste boundaries. Cursor motion, history keys, unknown escape sequences, mouse, resize, alternate-screen transition, password markers, full redraw, and completion/menu markers must clear and downgrade. It must never classify arbitrary child output as trusted prompt semantics.

Build `fixtures/tui` with command-line scenarios for line input, raw mode, alternate screen, cursor-addressed repaint, asynchronous output, bracketed paste, hidden input, Unicode/wrapping, completion menu, malformed/unknown ANSI, resize reporting, and signal/exit-code handling. Provide deterministic transcript mode and an interactive mode. The fixture must restore terminal state in `finally` and on common signals.

## Concrete Steps

From the root:

    npm test --workspace @chat-suggestion/terminal
    npm test --workspace @chat-suggestion/tui-fixture
    npm run typecheck --workspace @chat-suggestion/terminal
    npm run typecheck --workspace @chat-suggestion/tui-fixture
    npm run build --workspace @chat-suggestion/terminal
    npm run build --workspace @chat-suggestion/tui-fixture

Run noninteractive fixture scenarios and capture bounded golden semantic events rather than terminal-dependent screenshots. If a pseudo-terminal is necessary, skip with an explicit reason on unsupported CI instead of silently passing.

## Validation and Acceptance

Tests prove dangerous OSC clipboard text cannot survive sanitization; grapheme truncation never splits a code point or ANSI sequence; known append/backspace can remain high-confidence; every ambiguous key/output/resize clears; hidden mode produces no captured draft; no suggestion ANSI is emitted when confidence is not `known-eol`; fixture raw/alternate modes restore terminal settings after success, thrown error, SIGINT, and child exit.

The fixture must expose scenarios used later by PTY tests without importing PTY adapter code.

## Idempotence and Recovery

Golden files are deterministic and package-owned. Tests restore `stdin`/`stdout` state and signal handlers in `finally`. Never run terminal-control tests directly against the user's active terminal without an isolated PTY. Do not update the root lockfile.

## Artifacts and Notes

Store golden event streams under `fixtures/tui/test/fixtures`, not raw user terminal captures.

## Interfaces and Dependencies

Export sanitizer, width helpers, `InputConfidenceTracker`, states/reasons, and semantic terminal events from `packages/terminal/src/index.ts`. Do not export agent names or profile selectors. The fixture is an executable package with documented scenario flags and deterministic exit codes.

Revision note: Initial parallel workstream plan created 2026-07-11.
