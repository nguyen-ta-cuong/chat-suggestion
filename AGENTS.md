# AGENTS.md

## Mission

Build safe, low-latency inline prompt suggestions for coding-agent chat editors. Read `PRD.md`, `PLANS.md`, and the assigned file in `plans/` before changing code. The suggestion is decoration until explicit acceptance; never submit or execute it automatically.

## Repository model

This is a Node.js ESM TypeScript workspace managed with npm workspaces. The intended boundaries are:

- `packages/protocol`: versioned contracts and validators only.
- `packages/engine`: debounce, cancellation, stale-result rejection, state transitions.
- `packages/context`: privacy policy and bounded context collectors.
- `packages/provider`: completion-provider implementations; no filesystem access.
- `packages/terminal`: terminal text sanitizing, width helpers, and confidence state; no agent-specific behavior.
- `adapters/pi`: Pi-only extension and editor integration.
- `adapters/pty`: generic PTY lifecycle and capability probes.
- `apps/chat-suggest`: configuration, adapter selection, and dependency wiring.
- `fixtures/tui`: public terminal conformance fixture.

## Required behavior

- Associate every asynchronous result with an immutable prompt revision and request ID.
- Abort old work on edits and reject stale work again before rendering and acceptance.
- Keep the MVP insertion-only at the cursor. Do not add replacement edits without updating the protocol and PRD.
- Strip ANSI, OSC, C0 controls except permitted newline/tab policy, and unbounded output before rendering.
- Preserve native Tab, Escape, submit, undo, autocomplete, paste, IME, and application shortcuts whenever no valid suggestion consumes the key.
- Fail closed. Clear or downgrade on unknown cursor, layout, terminal, hidden-input, or capability state.
- Never log raw drafts, completions, conversation text, file contents, secrets, API keys, or auth headers.
- Never infer native support from a product name or config directory. Require a runtime capability handshake.
- Do not use undocumented proprietary APIs or binary symbol extraction.

## Parallel execution rules

Plan 0001 runs alone. Plans 0002–0009 may run concurrently after plan 0001. Plan 0010 runs after those plans are integrated. Plan 0011 runs strictly after plan 0010 and owns final end-user onboarding plus the README handoff; it reads but does not edit `docs/operations/**`.

Each implementer owns only the files listed in its ExecPlan, plus its own `plans/<plan-id>-*.md` living document and `artifacts/contract-change-requests/<plan-id>.md`. Do not edit root manifests, shared contracts, or another package to make a local test pass. If a frozen contract is insufficient, record the request in those two owned documentation files and continue with a local test double where possible. Plan 0010 decides shared changes and has conditional ownership of `packages/protocol/**` plus consumer files strictly required for an approved reconciliation; every such edit must be listed in its Decision Log before modification.

Assume other agents are editing other packages in the same working tree. Ignore unrelated changes. Do not reset, stash, clean, checkout, or rewrite other agents' work. Avoid broad formatting commands that touch files outside ownership.

## Development workflow

1. Confirm the assigned plan and owned paths.
2. Read current contracts from `packages/protocol`; do not duplicate public DTOs.
3. Update the plan's `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` as work proceeds.
4. Add tests with behavior, race, error, and cleanup coverage.
5. Run the packet-level checks in the plan.
6. Report exact commands and results, changed files, downgrade behavior, and any contract request.

Use `npm` rather than adding another package manager. Prefer platform APIs and small dependencies. New runtime dependencies require a Decision Log entry explaining why standard Node APIs or an existing dependency are insufficient.

## Validation baseline

After integration, these commands must work from the repository root:

    npm install
    npm run format:check
    npm run lint
    npm run typecheck
    npm run build
    npm test

Package owners should run the narrower workspace command named in their plan. Tests must use the deterministic fake provider and must not require credentials, network access, private sessions, Codex, Claude, or a paid model turn.

## Pi-specific guidance

Use only documented Pi extension/TUI APIs. Guard editor integration with `ctx.mode === "tui"`. Extend `CustomEditor` for the initial native adapter, use the injected `theme` and `KeybindingsManager`, and call `super.handleInput(data)` for every unconsumed key. Consume `tui.input.tab` only while a current suggestion is visible. Preserve `CURSOR_MARKER`, Unicode display width, and IME behavior. If an existing custom editor cannot be safely wrapped, downgrade to adjacent UI or disabled state rather than replacing it silently.

Resolve the installed Pi package root portably with the project dependency, `require.resolve`, or `npm root -g`; on the current development machine it is under `/Users/cuongnguyen/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent`. Before changing Pi integration, read the relevant markdown documents completely and follow their markdown cross-references. In particular consult `docs/extensions.md`, `docs/tui.md`, `docs/keybindings.md`, `docs/packages.md`, and the custom-editor examples. If Pi or its docs cannot be resolved, report a version/environment blocker instead of assuming APIs.

## PTY-specific guidance

A PTY wrapper is an experimental fallback, not proof of semantic editor access. It must forward bytes, signals, resize, exit code, and terminal modes transparently when suggestions are inactive. Track only high-confidence append/backspace input. Clear and suspend on cursor motion, history, completion UI, paste boundaries, alternate-screen ambiguity, redraw, resize, password/hidden input, or unknown sequences. Never paint inline into an unknown full-screen TUI; use adjacent status UI unless a fixture-proven profile establishes safety.

## User documentation rules

User-facing commands, configuration paths, environment variables, supported platforms, capability claims, and uninstall steps require observed, redacted evidence from the completed implementation. Never infer them from a product name, configuration directory, earlier plan, or plausible CLI convention. Offline fake-provider onboarding comes first. Remote-provider and PTY procedures need visible warnings and must not be run automatically by documentation tests. Documentation must not contain real keys, prompts, context, auth headers, private paths, or raw sessions.

The canonical end-user handoff is [`docs/user-guide.md`](docs/user-guide.md).
Update its command manifest, test, and redacted evidence together whenever a
documented command changes.

## Definition of done

A packet is done only when its owned behavior is demonstrable, its required checks pass, the plan is updated as a living document, no raw sensitive content is logged, cancellation and stale-result tests exist, and no files outside ownership were modified.
