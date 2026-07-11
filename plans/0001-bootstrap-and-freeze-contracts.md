# Bootstrap the workspace and freeze protocol version 1

This ExecPlan is a living document. Maintain it according to `PLANS.md`,
especially `Progress`, `Surprises & Discoveries`, `Decision Log`, and
`Outcomes & Retrospective`.

## Purpose / Big Picture

Create the small common foundation that lets all other implementers work
concurrently. After this plan, a fresh clone has a strict TypeScript npm
workspace, every Wave 1 package has an isolated manifest, and
`@chat-suggestion/protocol` provides runtime-validated, versioned contracts plus
deterministic fixtures. Running the protocol tests proves malformed, oversized,
unsafe, and stale messages cannot cross the boundary.

## Progress

- [x] (2026-07-11 08:25Z) Recorded the baseline on Node 24.16.0 and npm 11.16.0;
      the repository contained product documents but no application workspace.
- [x] (2026-07-11 08:27Z) Created root npm, strict TypeScript, ESLint, Prettier,
      EditorConfig, and generated-output ignore configuration.
- [x] (2026-07-11 08:29Z) Created isolated manifests, strict TypeScript configs,
      and compiling placeholders for every Wave 1 package and integration
      workspace.
- [x] (2026-07-11 08:32Z) Implemented protocol v1 DTOs, explicit validators,
      UTF-8 offsets, strict budgets, terminal-text safety, bounded NDJSON
      framing, SHA-256 prefix hashing, and deterministic fixtures.
- [x] (2026-07-11 08:36Z) Added 16 protocol contract tests and passed install,
      formatting, lint, typecheck, build, protocol, and full-workspace checks.
- [x] (2026-07-11 08:38Z) Froze protocol v1, documented its exact public API and
      evidence, and confirmed Wave 1 packages can start without shared-file
      edits.

## Surprises & Discoveries

- Observation: The planning documents predate the workspace formatter and are
  outside Plan 0001 ownership, so a root-wide Prettier gate would require
  rewriting other plans before their implementers start. Evidence: The initial
  `npm run format:check` reported all product and plan Markdown files alongside
  the new workspace files.
- Observation: npm 11 reported unapproved install scripts for optional tooling
  packages, but the installed toolchain remained functional without approving or
  executing project runtime scripts. Evidence: Vitest executed all 16 protocol
  tests, and the build, lint, and typecheck gates passed.

## Decision Log

- Decision: Use Node.js ESM, strict TypeScript, npm workspaces, and Vitest.
  Rationale: Pi extensions are TypeScript and npm is already present; this
  avoids another package manager and lets packages test independently. Date:
  2026-07-11
- Decision: Use in-process interfaces and newline-delimited JSON fixtures, not a
  daemon, in v1. Rationale: Process separation is not needed to validate the
  product and would add lifecycle and socket-security coupling. Date: 2026-07-11
- Decision: Protocol cursor offsets are UTF-8 byte offsets and v1 edits are
  insertion-only at the cursor. Rationale: Byte offsets are unambiguous across
  process boundaries, while insertion-only behavior makes stale and unsafe edits
  easier to reject. Date: 2026-07-11
- Decision: Keep protocol runtime validation dependency-free and install lint,
  formatting, compilation, and test tools only at the workspace root. Rationale:
  Small explicit validators make the frozen wire rules auditable and avoid
  imposing a schema library on every Wave 1 package. Date: 2026-07-11 08:31Z
- Decision: Exclude pre-existing product documents and non-owned living plans
  from the bootstrap Prettier gate while continuing to format this plan.
  Rationale: Plan 0001 must not rewrite documents owned by other packets merely
  to establish a green root formatting command. Date: 2026-07-11 08:34Z
- Decision: Declare `@chat-suggestion/protocol` version 0.1.0 as a workspace
  dependency of every non-protocol package during bootstrap. Rationale: Parallel
  package implementers can consume the frozen foundation without changing root
  dependency wiring or the lockfile. Date: 2026-07-11 08:37Z

## Outcomes & Retrospective

Protocol version 1 and the npm workspace foundation are complete. Every Wave 1
package has an isolated manifest, placeholder source, strict TypeScript build,
and package-local test command. Each non-protocol workspace declares only the
frozen protocol foundation, so plans 0002 through 0009 can now branch from this
state and work without shared-file edits. The protocol rejects malformed,
oversized, unsafe, non-insertion, invalid-offset, and stale data before it can
be rendered or accepted. No contract-change request or deferred protocol
question remains from Plan 0001.

## Context and Orientation

The repository currently contains product documents but no application code.
`PRD.md` defines the feature and `AGENTS.md` defines boundaries. This plan owns
root workspace files, `packages/protocol/**`, and the initial
manifests/placeholders for every package. Later plans may replace placeholders
only inside their owned package. Do not implement engine, collector, provider,
terminal, or adapter behavior here.

Protocol v1 must export these public concepts: `PromptSnapshot`,
`SuggestionRequest`, `SuggestionCandidate`, `SuggestionEdit`, `ContextEnvelope`,
`AdapterCapabilities`, `PtyProfileDescriptor`, `ClearReason`, `Disposable`,
`SuggestionProvider`, `SuggestionSurface`, and `ContextCollector`.
`PtyProfileDescriptor` is serializable data containing an exact host/version
fingerprint, named detector/marker capabilities, and downgrade metadata;
executable callbacks remain in `adapters/pty`. Include a structured `Result` or
typed validation error so consumers never depend on thrown string messages.

## Plan of Work

Create root `package.json` with private npm workspaces for `packages/*`,
`adapters/*`, `apps/*`, and `fixtures/*`. Add Node/TypeScript configuration,
`.editorconfig`, Prettier configuration, and scripts named `format:check`,
`lint`, `typecheck`, `build`, and `test`. Configure each script to run workspace
scripts when present. Generate and retain `package-lock.json` in this plan.

Create minimal manifests and `tsconfig.json` files with these exact names:
`packages/protocol` as `@chat-suggestion/protocol`, `packages/engine` as
`@chat-suggestion/engine`, `packages/context` as `@chat-suggestion/context`,
`packages/provider` as `@chat-suggestion/provider`, `packages/terminal` as
`@chat-suggestion/terminal`, `adapters/pi` as `@chat-suggestion/adapter-pi`,
`adapters/pty` as `@chat-suggestion/adapter-pty`, `adapters/codex` as
`@chat-suggestion/adapter-codex`, `adapters/claude` as
`@chat-suggestion/adapter-claude`, `apps/chat-suggest` as
`@chat-suggestion/app`, and `fixtures/tui` as `@chat-suggestion/tui-fixture`.
Each gets a compiling `src/index.ts` placeholder and package-local scripts, but
no feature behavior. This is the only deliberate cross-package scaffolding step.

Under `packages/protocol/src`, define immutable TypeScript types, constants, and
explicit runtime parsers. Avoid a schema dependency unless it materially
improves diagnostics; if one is added, record it in the Decision Log. Export
hard limits matching `PRD.md`: 65,536 serialized request bytes, 8,192 draft
bytes, 49,152 additional-context bytes with per-source caps of chat 12,288, Git
20,480, project/explicit snippets 8,192, attachments 4,096, and plan 4,096;
candidate limits are 1,024 UTF-8 bytes, 160 Unicode characters, two logical
lines (at most one newline), and 64 provider tokens. Validate insertion-only
ranges, request/revision matching, and valid UTF-8 boundaries. Reject NUL,
escape, carriage return, and terminal control sequences in candidates.

Add SHA-256 prefix hashing using `node:crypto`, deterministic byte measurement
with `Buffer.byteLength`, and an NDJSON decoder that handles split chunks,
multiple frames, final partial frames, and a bounded input buffer. Add fake
request/candidate fixtures. Do not include real prompts, paths, secrets, or
external API calls.

## Milestones

The first milestone establishes the workspace boundary. After `npm install`,
`npm ls --workspaces --depth=0` must list all eleven named packages, and
`npm run build` must compile each package from its own configuration. That is
the evidence that Wave 1 branches can work independently.

The second milestone freezes protocol version 1. The protocol test suite must
round-trip split NDJSON, reject unsupported versions and oversized frames,
enforce UTF-8-safe insertion offsets and all byte budgets, reject terminal
controls and stale candidates, and validate data-only PTY profiles. The root
formatting, lint, typecheck, build, and test commands must then pass together.

## Concrete Steps

From the repository root, first capture the baseline:

    git status --short
    node --version
    npm --version

Create the workspace and install only the shared development dependencies. Then
run:

    npm install
    npm run format:check
    npm run lint
    npm run typecheck
    npm run build
    npm test --workspace @chat-suggestion/protocol

The protocol test output must show passing cases for round-trip parsing, unknown
version rejection, oversized frame rejection, Unicode offset validation, unsafe
output sanitization/rejection, and stale request/revision mismatch. Finally run
`git status --short` and verify changes are limited to this plan's ownership.

## Validation and Acceptance

A small test must serialize a known request, feed it through arbitrarily split
NDJSON chunks, and parse exactly one equivalent request. A deterministic fake
candidate for that request must contain suffix ` tests`. Changing the candidate
revision or request ID must make validation fail. A cursor byte offset inside a
multibyte code point must fail. A candidate containing `\u001b]52;...` must
never reach a renderable result.

A fresh `npm install` followed by the root commands must work without global
TypeScript, Vitest, or Prettier. Every Wave 1 package must be addressable with
`npm test --workspace <name>` even while its placeholder has no tests.

## Idempotence and Recovery

All generated output belongs under ignored `dist`, `coverage`, or `node_modules`
paths. Re-running install and checks is safe. If dependency installation fails,
do not hand-edit the lockfile; restore consistency with `npm install`. Never
delete unrelated files or use `git clean`.

## Artifacts and Notes

The final protocol check produced this concise evidence:

    RUN  v3.2.7 packages/protocol
    ✓ test/protocol.test.ts (16 tests)
    Test Files  1 passed (1)
    Tests       16 passed (16)

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`,
and `npm test` all exited zero. The full test command addressed every workspace;
placeholder packages reported no tests and exited zero, while the protocol ran
the 16 deterministic tests. Loading the built public entry point validated the
fake candidate and printed suffix ` tests`.

The exact public type exports are `ProtocolVersion`, `Transport`,
`InlineRender`, `AdapterCapabilities`, `HostIdentity`, `ByteRange`,
`PromptSnapshot`, `ContextSourceKind`, `ContextContribution`, `ContextEnvelope`,
`SuggestionRequest`, `SuggestionEdit`, `SuggestionCandidate`, `ClearReason`,
`Disposable`, `SuggestionProvider`, `SuggestionSurface`,
`ContextCollectionInput`, `ContextCollector`, `PtyDetectorName`,
`PtyMarkerName`, `PtyHostFingerprint`, `DowngradeMetadata`,
`PtyProfileDescriptor`, `ValidationErrorCode`, `ValidationError`, and
`ValidationResult`.

The exact runtime exports are `PROTOCOL_VERSION`, all `MAX_*` constants,
`CONTEXT_SOURCE_BYTE_LIMITS`, `FAKE_CAPABILITIES`, `FAKE_REQUEST`,
`FAKE_CANDIDATE`, `createFakeSuggestionRequest`,
`createFakeSuggestionCandidate`, `NdjsonDecoder`, `encodeNdjson`,
`parseAdapterCapabilities`, `parsePromptSnapshot`, `parseContextEnvelope`,
`parseSuggestionRequest`, `parseSuggestionCandidate`,
`validateCandidateForRequest`, `parsePtyProfileDescriptor`,
`containsUnsafeTerminalText`, `sanitizeSuggestionText`, `sha256Prefix`,
`utf8ByteLength`, `isWellFormedUnicode`, and `isUtf8Boundary`.

## Interfaces and Dependencies

`packages/protocol/src/index.ts` is the only public entry point. Public DTOs
must be readonly where practical. Define interfaces with these semantics:

    SuggestionProvider.provide(request, signal) -> Promise<SuggestionCandidate | null>
    SuggestionSurface.capabilities() -> AdapterCapabilities
    SuggestionSurface.show(candidate) / clear(reason) / accept(candidate)
    ContextCollector.collect(input, signal) -> Promise<bounded contribution>

`AdapterCapabilities` must express transport and rendering level rather than a
single boolean. Include `transport: native | app-server | pty | none`,
`inlineRender: arbitrary | eol-only | adjacent | none`, and booleans for
buffer/cursor read, atomic acceptance, cancellation, resize awareness,
alternate-screen safety, native completion awareness, and attachment references.
Define and validate the data-only `PtyProfileDescriptor` so plans 0007, 0008,
and 0009 share one compile-time and runtime boundary without importing each
other.

Revision note: Initial plan created 2026-07-11 to establish the single
prerequisite for parallel implementation.

Revision note (2026-07-11 08:27Z): Recorded the observed baseline and root
tooling decision as implementation began.

Revision note (2026-07-11 08:32Z): Recorded completion of workspace scaffolding
and the first protocol implementation; validation remains pending.

Revision note (2026-07-11 08:34Z): Documented the formatting ownership boundary
discovered during the first validation pass.

Revision note (2026-07-11 08:38Z): Completed the living plan with final API,
validation evidence, milestone outcomes, and the Wave 1 readiness decision.
