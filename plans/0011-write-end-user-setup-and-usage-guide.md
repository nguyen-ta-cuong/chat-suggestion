# Write the verified end-user setup and usage guide

This ExecPlan is a living document. Maintain it according to `PLANS.md`, especially `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`. Run it strictly after plan 0010.

## Purpose / Big Picture

After this work, a novice can install Chat Suggestion from a fresh clone, start with the offline deterministic fake provider, understand when remote content transmission begins, install and use the Pi integration, interpret Codex/Claude/PTY capability downgrades, troubleshoot safely, and uninstall only product-owned artifacts. Every published command and capability claim must be demonstrated against the completed MVP rather than inferred from earlier plans.

## Ownership and Dependency

This is Wave 3 and depends on plan 0010. It owns `plans/0011-write-end-user-setup-and-usage-guide.md`, `README.md`, documentation-only navigation/acceptance edits in `PRD.md`, `AGENTS.md`, and `PLANS.md`, `docs/user-guide.md`, `docs/test/**`, `docs/verification/user-guide-command-evidence.md`, and `artifacts/contract-change-requests/0011.md` if needed. It does not own `docs/operations/**`, runtime source, package manifests, lockfiles, adapters, or `tests/e2e/**`. Plan 0010's README changes are provisional; this plan becomes the sole README owner after plan 0010 finishes.

## Progress

- [x] (2026-07-11T12:55:17Z) Read Plan 0010's completed outcome, package READMEs, CLI/configuration source, Pi help, and every `docs/operations/**` document.
- [x] (2026-07-11T12:55:17Z) Verified build, status, fake demo, trusted context preview, Pi install-path, host versions, and Pi local-package behavior without provider credentials.
- [x] (2026-07-11T12:55:17Z) Wrote the canonical fake-provider-first setup and usage guide, including explicit remote, PTY, and unavailable-artifact warnings.
- [x] (2026-07-11T12:55:17Z) Added an offline command manifest, documentation tests, and redacted evidence.
- [x] (2026-07-11T13:09:00Z) Updated README, PRD, AGENTS, and PLANS navigation; recorded the Pi artifact contract request.
- [x] (2026-07-11T13:09:00Z) Passed the documentation test, format check, lint, typecheck, and full workspace/e2e test suite.

## Surprises & Discoveries

- Observation: Earlier plans describe commands as candidates; their exact final spelling is not evidence.
  Evidence: Plan 0010 says commands “resembling” `status`, `context preview`, `demo`, and `wrap`.
- Observation: Codex and Claude remain runtime capability-gated, not promised native stock-TUI integrations.
  Evidence: `PRD.md` and plans 0008–0009 require a verified editor handshake.
- Observation: Pi 0.80.6 accepts `pi install` for the adapter directory but cannot load the directory as an extension at startup.
  Evidence: the isolated local-package experiment ended with `Failed to load extension` and `Cannot find module`; the created `.pi/settings.json` was removed.

## Decision Log

- Decision: Publish one canonical guide at `docs/user-guide.md` and keep `README.md` short.
  Rationale: One source of truth reduces contradictory setup and privacy instructions.
  Date: 2026-07-11
- Decision: The first runnable workflow uses the deterministic fake provider.
  Rationale: It proves installation without credentials, network, paid requests, or content transmission.
  Date: 2026-07-11
- Decision: Unverified commands and configuration details are release blockers, not placeholders to guess.
  Rationale: Installation, privacy, and uninstall instructions are safety-critical.
  Date: 2026-07-11
- Decision: PTY guidance is visibly experimental, opt-in, allowlist-restricted, and never evidence of semantic editor access.
  Rationale: A PTY sees terminal bytes, not a reliable logical prompt buffer.
  Date: 2026-07-11
- Decision: Treat durable Pi installation as unavailable and publish only the disposable explicit-extension smoke path.
  Rationale: The package has no loadable entry point that wires the required suggestion bridge; a Pi install command that succeeds initially but fails on startup is unsafe onboarding.
  Date: 2026-07-11
- Decision: Exclude the Node documentation test from the workspace's typed TypeScript ESLint configuration.
  Rationale: The required `.mjs` test is not part of a TypeScript project and strict typed rules fail before its file-level disable directive can apply; it is still run directly by Node's test runner.
  Date: 2026-07-11

## Outcomes & Retrospective

The canonical guide, command manifest, Node test, and redacted evidence are now
complete. The local workflow was verified on macOS 15 arm64 with Node 24.16.0,
npm 11.16.0, and Pi 0.80.6. The fake demo does not submit or use a remote
provider; status, trusted preview, and the Pi package-path probe all exit 0.
Pi's disposable explicit-extension smoke path remains manual and offline.

The guide accurately reports that Pi native rendering requires the active TUI
handshake, Codex and Claude stock TUIs are unsupported, and the PTY wrapper
refuses before child launch because there is no exact profile. A Pi local package
installation was not advertised because its startup failed; the exact artifact
gap is recorded in `artifacts/contract-change-requests/0011.md`. This is a
release blocker for durable Pi installation, not for the offline CLI and smoke
documentation.

## Context and Orientation

Chat Suggestion generates insertion-only suffixes that remain decoration until explicit acceptance. Remote generation is disabled until configured and acknowledged; project context also requires trust or opt-in. Pi is the required native MVP and plan 0010 must have passed its end-of-input, one-visual-line release gate. If it did not, this documentation plan must describe the release as blocked unless the PRD was explicitly revised; it must not silently present adjacent/disabled mode as satisfying native Pi support.

Codex and Claude adapters report capabilities at runtime. Executable presence, configuration, hooks, plugins, or an app-server do not prove stock-TUI inline support. The generic PTY path is an experimental adjacent fallback that suspends on ambiguous or hidden input.

Plan 0010 owns detailed operations evidence under `docs/operations/**`. This plan reads and links those files without duplicating or editing them.

## Plan of Work

Inspect final root scripts, `apps/chat-suggest` public commands, package metadata, adapter READMEs, operations documents, capability output, configuration schema, and every completed plan outcome. Determine the actual configuration precedence/location, provider acknowledgment, Pi install artifact, PTY opt-in, supported platforms, disable path, and uninstall path.

Create `docs/verification/user-guide-command-evidence.md`. For each candidate command, record date, platform, tool versions, exact redacted command, exit code, short redacted output, and safety class. Never record private project paths, drafts, context previews, keys, authorization headers, endpoints containing credentials, or raw terminal sessions.

Investigate these candidate commands, but publish only the forms that succeed against the final implementation:

    npm install
    npm run chat-suggest -- --help
    npm run chat-suggest -- status
    npm run chat-suggest -- demo --provider fake
    npm run chat-suggest -- context preview --provider fake
    npm run chat-suggest -- wrap --help
    pi --version
    pi --help

Write `docs/user-guide.md` with these sections: product behavior and safety levels; verified prerequisites; install and status verification; first offline run with fake provider; configuration; separately warned remote-provider opt-in; trusted project/context/privacy behavior; Pi installation and usage; Codex/Claude capability interpretation; experimental PTY setup; troubleshooting; disable; and uninstall.

The guide must explain Tab acceptance, Escape dismissal, stale invalidation, and that suggestions never submit or execute. It must state the exact candidate/context budgets, explain that redaction is defense in depth rather than a guarantee, and warn before content preview, remote transmission, configuration mutation, or PTY wrapping. Use fake credentials only.

Pi instructions must use the final verified package/load command, explain TUI-only EOL/one-visual-line behavior, native autocomplete precedence, editor-composition limits, and fake-provider smoke testing. Codex/Claude instructions must separate custom-frontend capability from stock TUI. PTY instructions must name the exact opt-in/allowlist mechanism, adjacent rendering, supported OSes, hidden-input suspension, ambiguous-state Tab pass-through, and terminal restoration.

Uninstall instructions distinguish disabling suggestions, removing project configuration, unloading/removing the Pi extension, removing wrapper setup, and revoking/removing provider credentials. Never suggest deleting global configuration, caches, credential stores, or arbitrary directories unless the completed installer created and exclusively owns them.

Create `docs/test/user-guide-command-manifest.json`. Every executable guide command receives a stable ID, command, working directory, safety class (`offline`, `manual-host`, or `remote-opt-in`), expected exit status, and redacted output pattern. Create `docs/test/user-guide.test.mjs` with Node's test runner to map command blocks to manifest entries, execute only offline commands in temporary environments without provider credentials, require evidence for manual/remote commands without executing them, validate local links, require safety warnings, reject unqualified native Codex/Claude claims, and reject likely secrets/private paths.

If the final integration lacks a status command, offline fake-provider path, safe disable mechanism, Pi artifact, or evidence for an advertised host, write `artifacts/contract-change-requests/0011.md`, mark the affected section unavailable, and report a release blocker rather than inventing syntax.

## Concrete Steps

From a clean fresh-clone test directory, run the final verified project gates:

    npm install
    npm run format:check
    npm run lint
    npm run typecheck
    npm run build
    npm test
    node --test docs/test/user-guide.test.mjs

Run the documentation test after each command-manifest change. Perform a manual novice walkthrough of the fake-provider path in a fresh temporary clone. Manual Pi or remote-provider commands require redacted evidence but must never be run automatically by documentation tests.

## Validation and Acceptance

A fresh clone must complete the documented fake-provider workflow without credentials, network access, paid model turns, Pi/Codex/Claude, or private sessions. Every offline command is executed by the docs test; every manual or remote command has redacted evidence and a visible warning.

The guide must accurately state Pi's verified release behavior, never promise native stock-TUI ghost text for Codex or Claude without a current successful handshake, and label PTY as experimental and fail-closed. Troubleshooting maps failures to verified remedies or operations links. Uninstall removes only product-owned artifacts. No prompt, context, key, auth header, realistic secret, private path, or raw session appears in docs or evidence. Root documents link consistently to the canonical guide and plan 0011.

## Idempotence and Recovery

Documentation tests use temporary directories and no real provider credentials. Re-running is safe. Test uninstall only in an isolated environment. If a command fails, remove or correct the documented command; never weaken validation or substitute plausible syntax. Preserve evidence as short redacted text, not terminal recordings.

## Artifacts and Notes

The command manifest is documentation test data, not runtime configuration. Keep `README.md` to orientation, one verified quick-start link, and plan navigation. Link to `docs/operations/**` for detailed compatibility/privacy/troubleshooting evidence rather than copying it.

## Interfaces and Dependencies

This plan consumes completed public behavior from `apps/chat-suggest`, the Pi package, capability adapters, and `docs/operations/**`. It introduces no runtime dependency. `docs/test/user-guide.test.mjs` uses Node standard modules and completed local CLI artifacts only.

Revision note: Initial post-integration user-documentation plan created 2026-07-11 using GPT-5.6 Terra. It resolves the missing evidence-gated setup, usage, troubleshooting, and uninstall workstream.

Revision note (2026-07-11T13:09:00Z): Published the verified guide and its
offline command test, redacted evidence, and unavailable-Pi-artifact request.
The documentation test executes only offline commands without provider
credentials; Pi and PTY remain manual evidence-gated paths.
