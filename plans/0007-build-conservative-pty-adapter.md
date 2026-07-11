# Build the conservative PTY fallback

This ExecPlan is a living document maintained under `PLANS.md`. Run it after plan 0001. It owns `adapters/pty/**` only.

## Purpose / Big Picture

Provide an experimental wrapper for agent CLIs without native editor APIs while remaining transparent and fail-closed. The wrapper must preserve bytes, signals, resize, exit status, and terminal settings. It may show adjacent suggestions only while an explicit profile reports high-confidence end-of-input state; ambiguity immediately clears and suspends interception.

## Progress

- [ ] Prove the selected PTY dependency in an isolated fixture test.
- [ ] Implement child lifecycle, raw-mode restoration, signal/resize forwarding, and byte passthrough.
- [ ] Implement capability/profile handshake, confidence downgrade, adjacent rendering, and acceptance injection.
- [ ] Run fixture conformance and fault-injection tests.
- [ ] Document experimental limits and update living sections.

## Surprises & Discoveries

- Observation: A PTY can intercept bytes but cannot recover an arbitrary TUI's semantic editor state.
  Evidence: Terminal ownership analysis in `PRD.md`; lifecycle hooks occur after submission and screen cells do not expose logical buffers.

## Decision Log

- Decision: Unknown programs and versions never receive transparent inline painting.
  Rationale: Direct ANSI overlays can corrupt full-screen TUIs and steal Tab from native completion.
  Date: 2026-07-11
- Decision: The MVP fallback uses adjacent status UI and an explicit profile/acceptance handshake.
  Rationale: It remains honest and can clear safely on child output or ambiguous input.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, report transparency tests, supported platforms, and every situation that forces downgrade.

## Context and Orientation

The adapter wraps a configured executable in a pseudoterminal. It consumes protocol contracts and uses package-local doubles while plan 0005 is parallel. It does not contain Codex- or Claude-specific probes; those packages emit the frozen data-only `PtyProfileDescriptor`, which this package compiles into its own executable detectors. It must never capture arbitrary shell/password input and must require allowlisted agent commands.

A full VT emulator is not required. If reliable adjacent composition still requires one, stop at a status-only or disabled result and record evidence rather than implementing unsafe cursor-save/restore guesses.

## Plan of Work

Select and prove a maintained Node PTY library on macOS and Linux. Spawn without a shell using executable plus argument array. Forward stdin bytes unchanged except when a current suggestion and explicit acceptance chord are both active. Forward stdout/stderr terminal bytes, dimensions, SIGWINCH, interrupt, suspend/resume, termination, and child exit code. Save terminal settings and restore them in `finally`, uncaught error, rejection, signal, and child-exit paths.

Consume protocol `PtyProfileDescriptor` with exact executable fingerprint, supported version, named prompt/completion/hidden/output markers, and capability result. Implement package-owned compiled detector behavior as `PtyProfile`; do not accept executable callbacks from host adapters. Profiles begin untrusted and must handshake. Track only printable append and backspace while known at EOL. Cursor/history keys, paste, mouse, alternate-screen transitions, unknown escape sequences, redraw, resize, completion UI, hidden input, or unexpected output clear the draft and suggestion and move to a structured suspended state.

Render only in an adapter-owned adjacent surface proven by fixture tests. Do not write model text directly into the child's screen model. On acceptance, sanitize again and inject only suffix bytes, never Enter. When inactive, wrapper input and output must be byte-transparent.

## Concrete Steps

From the root:

    npm test --workspace @chat-suggestion/adapter-pty
    npm run typecheck --workspace @chat-suggestion/adapter-pty
    npm run build --workspace @chat-suggestion/adapter-pty

Run package-local synthetic child fixtures covering line/raw/alternate/hidden modes; these fixtures must conform to the scenario/event names frozen by plan 0001 but do not import plan 0005 output. Add fault injection for child crash, wrapper exception, SIGINT, SIGTERM, SIGTSTP/SIGCONT where supported, resize storms, split escape sequences, and PTY allocation failure. Verify terminal attributes before and after in an isolated parent PTY. Full execution against `fixtures/tui` is intentionally deferred to plan 0010 so this plan remains parallel with plan 0005.

## Validation and Acceptance

When suggestions are inactive, package-local synthetic fixture input/output bytes and exit codes match direct execution. Acceptance adds exactly the suffix bytes and no Enter. Tab passes through whenever suggestion currency or completion ownership is uncertain. Hidden mode generates no snapshot/provider request. Every unknown sequence/output/resize clears. Terminal state is restored after all tested exits. Unknown executable/version reports `inlineRender: none` and a downgrade reason.

## Idempotence and Recovery

Tests create isolated PTYs and child processes and kill/reap them in `finally`. Never run hidden-input tests against a real credential prompt. Do not modify shell startup files, terminal emulator settings, root lockfile, or global packages.

## Artifacts and Notes

Store synthetic terminal transcripts under `adapters/pty/test/fixtures`; never record a user's real CLI session.

## Interfaces and Dependencies

Export `PtyRunner`, the package-owned compiled `PtyProfile`, a compiler/validator from protocol `PtyProfileDescriptor`, capability/downgrade results, and lifecycle hooks from this package. Use protocol types at boundaries. Any native PTY dependency belongs only in this package manifest and must be optional or produce a clear unsupported-platform diagnostic. No adapter may claim semantic buffer access solely because PTY allocation succeeded.

Revision note: Initial experimental fallback plan created 2026-07-11.
