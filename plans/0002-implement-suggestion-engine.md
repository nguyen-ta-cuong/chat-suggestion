# Implement the cancellation-safe suggestion engine

This ExecPlan is a living document maintained under `PLANS.md`. Run it only after plan 0001. It owns `packages/engine/**` and no other files.

## Purpose / Big Picture

Implement the host-neutral state machine that turns prompt snapshots into current, safe suggestions. A fake surface and provider will demonstrate that a pause triggers one request, typing cancels it, late results never render, Escape dismisses, and acceptance occurs exactly once.

## Progress

- [ ] Inspect protocol v1 and record the start time.
- [ ] Implement eligibility, debounce, request lifecycle, and state transitions.
- [ ] Implement cancellation, stale-result validation, deduplication, and acceptance guards.
- [ ] Add deterministic race, timer, Unicode, and error tests.
- [ ] Run package checks and update all living sections.

## Surprises & Discoveries

- Observation: None yet.
  Evidence: Update during implementation.

## Decision Log

- Decision: The engine performs no filesystem, terminal, Pi, or network work.
  Rationale: Inputs are contracts and injected interfaces, keeping every adapter independently testable.
  Date: 2026-07-11
- Decision: Validate currency both when a provider resolves and immediately before show or accept.
  Rationale: Cancellation is advisory; providers can resolve after abort.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, report observed state transitions, timing evidence, and unresolved contract requests.

## Context and Orientation

Plan 0001 created `@chat-suggestion/protocol`. `packages/engine` is the only owned package. Do not edit protocol or root files. If a contract is insufficient, create `artifacts/contract-change-requests/0002.md` and use an internal adapter until plan 0010.

The engine owns policy for idle debounce, minimum meaningful prefix, one in-flight generation, immutable revisions, request IDs, exact prefix hashes, dismissals, and atomic acceptance. It consumes bounded context and a `SuggestionProvider`; it does not build either.

## Plan of Work

Implement `SuggestionCoordinator` with an injected clock/timer, provider, context callback, surface, metrics sink, and configuration. Expose `update(snapshot)`, `dismiss(reason)`, `manualTrigger()`, `acceptAll()`, `state()`, and `dispose()` or equivalent explicit methods. Keep synchronous input handling small: update revision, clear visible decoration, abort prior work, and schedule a timer.

Eligibility requires focus, idle host, no IME composition, no native completion UI, no selection, cursor at end, and the configured minimum non-whitespace length. When the timer fires, collect context with the same abort signal, construct one versioned request, and invoke the provider. On resolution validate adapter/session identity, revision, exact prefix hash, cursor, request ID, insertion-only range, and output policy before showing.

Use dependency-injected timers and IDs so tests do not sleep. Keep transition logic explicit and observable. Metrics may include event names, durations, counts, and byte sizes only, never prompt or completion content.

## Concrete Steps

From the repository root:

    npm test --workspace @chat-suggestion/engine
    npm run typecheck --workspace @chat-suggestion/engine
    npm run build --workspace @chat-suggestion/engine

Add tests that use deferred promises to force out-of-order provider results. Add fake timers for debounce and timeout. Run the package tests repeatedly to detect timer leaks:

    for i in 1 2 3 4 5; do npm test --workspace @chat-suggestion/engine || exit 1; done

## Validation and Acceptance

Demonstrate these behaviors in tests: ten edits inside one debounce issue one request for the final revision; a provider that ignores abort cannot render late; changing only cursor or session invalidates; Escape clears without modifying text; accepting a current candidate invokes the surface once; a second accept is a no-op; native completion prevents eligibility and receives Tab through the adapter; dispose aborts and leaves no timers; collector/provider errors return to idle without content logging.

Measure synchronous `update()` over a deterministic loop and record p95, targeting below 5 ms in the package benchmark. The benchmark is informational in CI unless the environment is controlled.

## Idempotence and Recovery

Tests use fake providers, clocks, and surfaces and require no network or credentials. Re-running is safe. Do not regenerate the root lockfile. If a package dependency is unavoidable, edit only `packages/engine/package.json`, install with lockfile updates disabled for local checking, and record it for plan 0010.

## Artifacts and Notes

Store package-owned fixtures under `packages/engine/test/fixtures`. Never store real draft text or session content.

## Interfaces and Dependencies

Depend only on `@chat-suggestion/protocol` and Node standard APIs. Export the coordinator, configuration type, state snapshot type, eligibility function, and a no-content metrics interface from `packages/engine/src/index.ts`. Consumers must not inspect private timers or mutable state.

Revision note: Initial parallel workstream plan created 2026-07-11.
