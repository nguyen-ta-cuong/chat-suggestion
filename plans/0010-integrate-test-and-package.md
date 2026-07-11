# Integrate adapters, run end-to-end tests, and package the MVP

This ExecPlan is a living document maintained under `PLANS.md`. Run it only after plans 0002 through 0009 have finished or explicitly documented blockers. It owns `apps/chat-suggest/**`, `tests/e2e/**`, `docs/operations/**`, root integration files, and the root lockfile. Any README edits made here are provisional implementation-time notes; after this plan completes, plan 0011 becomes the sole owner of final README onboarding and the canonical user guide. For an approved contract reconciliation recorded first in this plan's Decision Log, it conditionally owns `packages/protocol/**` and the exact consumer files across Wave packages required to update that contract atomically.

## Purpose / Big Picture

Turn independently tested packages into a usable MVP. A user can inspect capabilities and context, run a fake-provider demo, install the Pi extension, or launch a supported command through the experimental wrapper. End-to-end tests prove stale suggestions never appear, accepted text is inserted once without submission, unsupported hosts fail closed, and fresh-clone commands work.

## Progress

- [ ] Read every Wave 1 outcome and contract-change request; record integration decisions.
- [ ] Reconcile compatible protocol additions and update all consumers atomically.
- [ ] Implement configuration, dependency wiring, capability selection, status, preview, and launch commands.
- [ ] Add end-to-end Pi/fake/PTY fixture tests and privacy/cleanup gates.
- [ ] Reconcile dependencies/lockfile, run the full matrix, and write operations/release docs.
- [ ] Update living sections with final outcomes and remaining host limitations.

## Surprises & Discoveries

- Observation: None yet. Import all relevant discoveries from completed plans with evidence.

## Decision Log

- Decision: Adapter selection order is verified native, verified protocol-owned frontend, exact fixture-tested PTY profile, then unsupported.
  Rationale: The component owning the semantic editor is the only reliable place for exact ghost text.
  Date: 2026-07-11
- Decision: Pi is the only planned native MVP; Codex/Claude claims remain capability-derived.
  Rationale: Research verified Pi editor APIs but not equivalent stock-TUI APIs in Codex or Claude.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, compare shipped behavior with every acceptance criterion in `PRD.md`, including explicit gaps.

## Context and Orientation

Plan 0001 created the workspace/protocol. Plans 0002–0009 own engine, context, provider, terminal, Pi, PTY, Codex, and Claude behavior. This plan is the only integration wave allowed to edit root manifests/lockfile and reconcile shared contracts. Read `artifacts/contract-change-requests/*.md`; accept only backward-compatible v1 changes or deliberately introduce/version v2 and update all packages.

The CLI application lives in `apps/chat-suggest`. It should be thin wiring, not duplicate engine or adapter logic.

## Plan of Work

Implement a configuration loader with defaults and environment/file overrides for enablement, provider, model/endpoint/key environment variable, debounce, context sources/budgets, trusted projects, rate limits, host command, and experimental PTY opt-in. Validate configuration and redact secrets in diagnostics.

Implement commands resembling `status`, `context preview`, `demo`, `pi install-path` or documented package install, and `wrap -- <agent> [args...]`. `status` prints structured capabilities and downgrade reasons. `context preview` prints exactly redacted bounded content without a provider call and requires trusted-project confirmation. `demo` uses the fake provider. `wrap` requires an allowlisted command and explicit experimental acknowledgment when PTY is selected.

Wire snapshots through context assembly, provider, engine, and surface. Preserve the adapter selection order. Do not make Codex/Claude presence mandatory. Do not introduce a daemon unless package evidence proves it necessary; prefer in-process composition.

Add end-to-end tests with delayed fake provider, Pi fake editor/TUI harness, and every open `fixtures/tui` scenario under the real PTY adapter. This is the cross-package conformance deferred by plans 0005 and 0007. Include a no-content logger that fails on sensitive strings. Add process cleanup and terminal restoration assertions. Add package and operations docs covering install mechanics, configuration schema, privacy, troubleshooting evidence, capabilities, experimental labels, and uninstall mechanics. Keep README notes provisional and record the final public command/configuration facts for plan 0011, which writes and verifies novice-facing onboarding.

Reconcile package dependencies using npm and commit one coherent `package-lock.json` only if commits are requested by the execution environment. Replace placeholders, remove dead exports, and run formatting narrowly before the full suite.

## Concrete Steps

From a clean repository root:

    npm install
    npm run format:check
    npm run lint
    npm run typecheck
    npm run build
    npm test

Run CLI demonstrations with the fake provider and no network:

    npm run chat-suggest -- status
    npm run chat-suggest -- demo --provider fake
    npm run chat-suggest -- context preview --provider fake

Run the documented Pi smoke test using the fake provider and the PTY fixture matrix. Codex and Claude integration tests may skip only when executables are absent; fake capability tests must still pass. Capture exact skip reasons.

## Validation and Acceptance

Verify all eight acceptance criteria in `PRD.md`. In particular, delayed stale responses do not render, Pi end-of-input inline ghost rendering passes as a release gate, Pi Tab accepts once while ordinary autocomplete remains native, Escape dismisses without changing draft, context remains within policy, every TUI fixture passes through PTY with transparent forwarding/restoration, and capability output never calls hook-only Codex/Claude support native. If plan 0006 is blocked on public Pi APIs, stop release integration and record the required PRD scope decision; adjacent or disabled Pi mode does not satisfy the existing MVP.

Test a fresh-clone simulation without existing `node_modules` or global package assumptions. No test requires API credentials, network, real private sessions, or paid turns. Scan generated logs for synthetic secret/draft markers and fail if found.

Human acceptance uses the fake provider first, then an explicitly configured remote provider only with user consent. Record p50/p95 component timings without storing content.

## Idempotence and Recovery

Configuration examples contain placeholders. Preview is read-only. Wrapper cleanup occurs in `finally`. If integration exposes a protocol incompatibility, update protocol and all consumers in one coherent change and rerun every workspace test. Never work around an incompatibility with unsafe casts or duplicated DTOs.

## Artifacts and Notes

Write `docs/operations/compatibility.md` with verified versions and honest capability levels, `privacy.md` with transmission/retention details, and `troubleshooting.md` with downgrade reasons. Preserve package test evidence in plan outcomes, not raw user sessions.

## Interfaces and Dependencies

`apps/chat-suggest` imports package public entry points only. Root scripts must remain the stable CI interface. Configuration and CLI outputs are versioned enough for tests but do not expose provider secrets. The final package should run on macOS and Linux; unsupported platforms receive a clear diagnostic rather than a failed native build.

Revision note: Initial integration plan created 2026-07-11 as the sole merge-dependent final wave.
