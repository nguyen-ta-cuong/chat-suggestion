# Integrate adapters, run end-to-end tests, and package the MVP

This ExecPlan is a living document maintained under `PLANS.md`. Run it only after plans 0002 through 0009 have finished or explicitly documented blockers. It owns `apps/chat-suggest/**`, `tests/e2e/**`, `docs/operations/**`, root integration files, and the root lockfile. Any README edits made here are provisional implementation-time notes; after this plan completes, plan 0011 becomes the sole owner of final README onboarding and the canonical user guide. For an approved contract reconciliation recorded first in this plan's Decision Log, it conditionally owns `packages/protocol/**` and the exact consumer files across Wave packages required to update that contract atomically.

## Purpose / Big Picture

Turn independently tested packages into a usable MVP. A user can inspect capabilities and context, run a fake-provider demo, install the Pi extension, or launch a supported command through the experimental wrapper. End-to-end tests prove stale suggestions never appear, accepted text is inserted once without submission, unsupported hosts fail closed, and fresh-clone commands work.

## Progress

- [x] (2026-07-11T12:29:00Z) Read every Wave 1 plan outcome and checked for contract-change requests; no request artifacts existed.
- [x] (2026-07-11T12:29:00Z) Confirmed the public v1 exports compose without a protocol reconciliation.
- [x] (2026-07-11T12:36:00Z) Implemented validated/redacted configuration, public-export-only dependency wiring, capability status, trusted context preview, offline demo, Pi package discovery, and an explicit fail-closed experimental wrapper seam.
- [x] (2026-07-11T12:38:00Z) Added cross-package fake acceptance, delayed-stale, privacy/trust, disabled-source, capability, wrapper, and semantic PTY suspension tests. Existing packet tests remain the Pi editor and PTY runner lifecycle gates.
- [x] (2026-07-11T12:44:00Z) Reconciled dependencies/lockfile, wrote operations docs, fixed clean-checkout build ordering, and passed a clean-copy install/format/lint/typecheck/build/test matrix.
- [x] (2026-07-11T12:45:00Z) Updated living sections with observed command evidence and remaining host limitations.
- [ ] Run every fixture through a real installed `node-pty` child. Blocked because the npm 1.1.0 macOS prebuilt `spawn-helper` files install without execute permission; semantic fixture tests and packet-local runner lifecycle tests pass, but they are not a substitute for this release gate.

## Surprises & Discoveries

- Observation: The Wave 1 code and tests were present, but plans 0002 through 0009 still had unchecked progress and `Not started` outcomes; no `artifacts/contract-change-requests` directory existed.
  Evidence: Read all eight living plans and checked the artifact directory before integration on 2026-07-11.
- Observation: Dependency and provider-fixture commands did not complete in the managed sandbox, while the same offline test matrix completed with loopback permission.
  Evidence: the sandboxed provider run was stopped after more than 90 seconds without progress; the approved run completed all 41 provider tests in 206 ms and the full suite in 19 seconds.
- Observation: The installed `node-pty` 1.1.0 prebuilt spawn helpers are not executable, so a real `PtyRunner` matrix cannot run from the fresh installed artifact without mutating dependency permissions.
  Evidence: `stat -f '%Sp %Lp %N' node_modules/node-pty/prebuilds/darwin-{arm64,x64}/spawn-helper` returned `-rw-r--r-- 644` for both helpers. The integration test is therefore named semantic PTY profile conformance, not real PTY conformance.
- Observation: Runtime capability status must not claim Pi native rendering outside Pi even though the adapter package exports its post-handshake capabilities.
  Evidence: status now reports `runtime-handshake-required`, `inlineRender: none`, and the TUI/custom-editor downgrade reason; the e2e regression test enforces it.
- Observation: Existing `dist` directories hid a fresh-checkout build-order defect.
  Evidence: the first clean-copy `npm run build` visited `packages/context` before `packages/protocol` and could not resolve protocol declarations. Root build, lint, and typecheck orchestration now bootstraps protocol declarations first; the second clean-copy matrix passed.
- Observation: The complete test matrix is healthy when the provider fixture is allowed to bind an ephemeral loopback listener.
  Evidence: the approved root run passed 173 workspace tests and 9 cross-package tests; the clean-copy run independently passed install, format, lint, typecheck, build, 173 workspace tests, and the then-current 8 cross-package tests.

## Decision Log

- Decision: Adapter selection order is verified native, verified protocol-owned frontend, exact fixture-tested PTY profile, then unsupported.
  Rationale: The component owning the semantic editor is the only reliable place for exact ghost text.
  Date: 2026-07-11
- Decision: Pi is the only planned native MVP; Codex/Claude claims remain capability-derived.
  Rationale: Research verified Pi editor APIs but not equivalent stock-TUI APIs in Codex or Claude.
  Date: 2026-07-11
- Decision: `runFakeDemo` always constructs `FakeSuggestionProvider`, regardless of project provider configuration.
  Rationale: An API named and documented as an offline demo must be incapable of remote transmission, not merely made offline by CLI argument rewriting.
  Date: 2026-07-11
- Decision: The experimental wrapper requires both configuration opt-in and a command-line acknowledgment, then refuses to launch until an exact fixture-tested executable profile exists.
  Rationale: An allowlisted product name is not semantic editor evidence, and passthrough launch would imply a level of PTY support the integrated artifact has not proven.
  Date: 2026-07-11
- Decision: Project configuration is optional `.chat-suggestion.json` with an absolute `CHAT_SUGGEST_CONFIG` override; trust entries resolve to exact repository paths.
  Rationale: Strict unknown-field validation and exact trust matching keep diagnostics predictable and prevent a broad path prefix from granting context access.
  Date: 2026-07-11
- Decision: Root lint and typecheck bootstrap workspace builds, and root build emits protocol declarations before visiting the remaining workspaces.
  Rationale: Workspace packages resolve public declaration exports from `dist`; without this ordering, existing build artifacts masked a clean-checkout failure.
  Date: 2026-07-11

## Outcomes & Retrospective

The thin application now composes package public exports into structured status, a deterministic offline demo, trusted bounded context preview, Pi install-path discovery, and an explicitly experimental PTY seam. Configuration rejects unknown fields, unsafe endpoints, invalid budget/debounce values, and missing remote settings; diagnostics retain only the API-key environment variable name and redact endpoint query data.

Observed commands after a workspace build:

- `npm run chat-suggest -- status`: exit 0; fake provider default; Pi `inlineRender: none` pending runtime handshake; installed Codex selected a custom app-server frontend while its stock TUI remains unsupported; Claude was unavailable.
- `npm run chat-suggest -- demo --provider fake`: exit 0; suggested ` tests and add a regression test`, accepted it once, and reported `submitted: false`.
- `npm run chat-suggest -- context preview --provider fake --trust-project`: exit 0; collected 6 source records with an 8,985-byte serialized envelope in this checkout and made no provider call.
- `npm run chat-suggest -- pi install-path`: exit 0 and returned the workspace Pi adapter package path.
- `wrap --experimental-pty -- codex` with both opt-ins: exit 78 before child launch because no exact fixture-tested executable profile was configured.

Final validation evidence at 2026-07-11T12:45Z: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, and the complete loopback-enabled `npm test` passed. The root run contained 173 workspace tests and 9 cross-package tests, including delayed stale rejection, offline-under-remote-config, trust/privacy, disabled-source non-collection, fail-closed host capabilities, wrapper refusal before launch, and conservative suspension over all 13 semantic TUI transcripts. A separate copy without `node_modules` or `dist` passed `npm ci --ignore-scripts`, format, lint, typecheck, build, 173 workspace tests, and the then-current 8 cross-package tests. `npm audit --omit=dev` reported zero vulnerabilities.

Acceptance gaps remain explicit. The real `fixtures/tui` matrix has not executed through `PtyRunner`/`node-pty` because the installed 1.1.0 spawn helper lacks execute permission; semantic profile conformance and packet-local runner doubles pass, but this does not satisfy the full real-PTY release gate. Pi's packet tests cover native rendering and key arbitration, while the final end-user smoke workflow and README/user guide belong to plan 0011.

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

Verify all nine acceptance criteria in `PRD.md`. In particular, delayed stale responses do not render, Pi end-of-input inline ghost rendering passes as a release gate, Pi Tab accepts once while ordinary autocomplete remains native, Escape dismisses without changing draft, context remains within policy, every TUI fixture passes through PTY with transparent forwarding/restoration, and capability output never calls hook-only Codex/Claude support native. If plan 0006 is blocked on public Pi APIs, stop release integration and record the required PRD scope decision; adjacent or disabled Pi mode does not satisfy the existing MVP.

Test a fresh-clone simulation without existing `node_modules` or global package assumptions. No test requires API credentials, network, real private sessions, or paid turns. Scan generated logs for synthetic secret/draft markers and fail if found.

Human acceptance uses the fake provider first, then an explicitly configured remote provider only with user consent. Record p50/p95 component timings without storing content.

## Idempotence and Recovery

Configuration examples contain placeholders. Preview is read-only. Wrapper cleanup occurs in `finally`. If integration exposes a protocol incompatibility, update protocol and all consumers in one coherent change and rerun every workspace test. Never work around an incompatibility with unsafe casts or duplicated DTOs.

## Artifacts and Notes

Write `docs/operations/compatibility.md` with verified versions and honest capability levels, `privacy.md` with transmission/retention details, and `troubleshooting.md` with downgrade reasons. Preserve package test evidence in plan outcomes, not raw user sessions.

## Interfaces and Dependencies

`apps/chat-suggest` imports package public entry points only. Root scripts must remain the stable CI interface. Configuration and CLI outputs are versioned enough for tests but do not expose provider secrets. The final package should run on macOS and Linux; unsupported platforms receive a clear diagnostic rather than a failed native build.

Revision note: Initial integration plan created 2026-07-11 as the sole merge-dependent final wave.

Revision note (2026-07-11T12:45Z): Reconciled the pre-populated completion notes with observed implementation evidence, corrected test counts, recorded the clean-checkout build-order fix and passing matrix, added wrapper coverage, and kept the real-node-pty fixture gate explicitly incomplete.
