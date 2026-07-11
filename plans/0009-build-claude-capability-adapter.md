# Build the capability-gated Claude Code adapter

This ExecPlan is a living document maintained under `PLANS.md`. Run it after plan 0001. It owns `adapters/claude/**` and `docs/evidence/claude/**` only.

## Purpose / Big Picture

Add safe discovery and future-proof capability negotiation for Claude Code without assuming that lifecycle hooks provide editor access. On machines without Claude, the adapter reports unavailable. On an installed version, it probes only documented help and exposes native support only after a version-specific prompt-buffer/render/insert handshake succeeds; otherwise it can supply an experimental PTY profile or remain disabled.

## Progress

- [ ] Inspect protocol and define Claude discovery/probe evidence.
- [ ] Implement executable resolution, bounded version/help probes, cache, and diagnostics.
- [ ] Implement explicit native-handshake and PTY-profile contracts with fail-closed defaults.
- [ ] Add fake executable/profile tests and evidence documentation.
- [ ] Run checks and update living sections.

## Surprises & Discoveries

- Observation: No runnable `claude` executable was found locally during research; configuration containing lifecycle hooks is not installation or editor evidence.
  Evidence: Local inventory in `PRD.md` and the research artifact.

## Decision Log

- Decision: Claude lifecycle hooks such as `UserPromptSubmit` are not treated as pre-submit editor APIs.
  Rationale: They occur too late to observe or render an unfinished prompt.
  Date: 2026-07-11
- Decision: Missing or unknown versions return `transport: none` unless an explicit, fixture-tested PTY profile is selected.
  Rationale: Safe degradation is preferable to stolen keys or terminal corruption.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, state which paths were testable locally and preserve explicit unknowns.

## Context and Orientation

A settings directory or JSON schema does not prove a runnable executable or native UI extension. Do not read hook command bodies, credentials, session transcripts, private caches, or proprietary binary internals. Use explicit configured executable and `PATH`; known installation locations may be opt-in. Probe `--version` and documented `--help` only, with time and output bounds.

This package is separate from the PTY implementation. It describes capabilities and emits only the frozen, data-only protocol `PtyProfileDescriptor`, never executable detector callbacks. Future documented native editor support can be added behind a handshake without changing the common engine.

## Plan of Work

Implement resolution and process probing with typed results: unavailable, present-unsupported, native-handshake-supported, PTY-profile-supported, and error. Version parsing must retain unknown versions as unknown rather than guessing ranges. Add a `ClaudeNativeEditorHandshake` interface requiring semantic buffer read, cursor read, change events, styled decoration, non-submitting insertion, native completion awareness, and disposal. All requirements must pass before reporting native support.

Define PTY profile metadata for exact tested version/fingerprint only. The package may classify startup/editor/completion/hidden states from synthetic transcripts, but it does not spawn a PTY. Unknown output or version invalidates the profile. Submit hooks may be reported as lifecycle context capability only and never raise `inlineRender`.

Document what evidence an implementer must add for a future real installation: exact version/help transcript, public API reference, no-cost handshake, fixture transcripts, resize/Unicode/completion/hidden tests, and downgrade behavior.

## Concrete Steps

From the root:

    npm test --workspace @chat-suggestion/adapter-claude
    npm run typecheck --workspace @chat-suggestion/adapter-claude
    npm run build --workspace @chat-suggestion/adapter-claude

Use fake executables for absent, version, timeout, oversized output, malformed output, lifecycle-hooks-only, successful hypothetical public handshake, and exact PTY profile cases. Do not make tests dependent on a real Claude install.

## Validation and Acceptance

The current local environment should report unavailable without error. A fake settings directory alone remains unavailable. A hook-only fake reports no native rendering. Partial handshakes fail closed and list missing dimensions. An exact fixture-tested profile can report experimental adjacent support; any version or fingerprint change disables it. Probe children are killed/reaped on timeout and output is capped.

## Idempotence and Recovery

All tests are offline and use temporary fake executables. Never edit user Claude settings or install Claude automatically. Do not update root lockfiles or files outside ownership.

## Artifacts and Notes

Store only redacted public capability evidence in `docs/evidence/claude/`. Clearly label unverified designs as proposals, not current Claude APIs.

## Interfaces and Dependencies

Export resolver/prober functions, `ClaudeCapabilityReport`, native handshake requirements, and optional protocol `PtyProfileDescriptor` with exact tested fingerprints and named markers. Prefer Node standard APIs and protocol types. Every enabled capability carries evidence and every disabled one carries a downgrade reason.

Revision note: Initial Claude capability plan created 2026-07-11 with the executable unavailable locally.
