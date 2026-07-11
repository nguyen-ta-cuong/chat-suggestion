# Implement deterministic and configurable suggestion providers

This ExecPlan is a living document maintained under `PLANS.md`. Run it after plan 0001. It owns `packages/provider/**` only.

## Purpose / Big Picture

Provide short, cancellable completion candidates without coupling model access to editors or files. The package will ship a deterministic fake provider for all tests and one configurable OpenAI-compatible HTTP provider. Users can prove formatting, cancellation, rate limits, and sanitization without credentials or paid calls.

## Progress

- [ ] Inspect protocol limits and provider interface.
- [ ] Implement fake, HTTP, prompt formatting, response parsing, and configuration.
- [ ] Implement abort, timeout, rate limit, cooldown, and no-content telemetry.
- [ ] Add local fake-server contract tests and package documentation.
- [ ] Run required checks and update living sections.

## Surprises & Discoveries

- Observation: None yet.
  Evidence: Update during implementation.

## Decision Log

- Decision: The first remote provider is OpenAI-compatible but uses user-supplied endpoint, model, and API key environment variable.
  Rationale: This proves a remote path without binding the core contract to one vendor or undocumented CLI credentials.
  Date: 2026-07-11
- Decision: Providers return text only and never terminal keys, tool calls, attachments, or commands to execute.
  Rationale: Acceptance remains an explicit local editor action.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, state supported response shapes, timeout behavior, and what was intentionally left to the engine.

## Context and Orientation

The provider receives a fully bounded `SuggestionRequest`; it must not access the filesystem, Git, host sessions, or terminal. The engine owns final stale-result validation, while this package owns transport, provider-specific parsing, output extraction, and transport-level limits. Do not reuse Codex, Claude, or Pi credentials through private files or undocumented APIs.

## Plan of Work

Implement `FakeSuggestionProvider` with configurable deterministic mappings and optional deferred/latency behavior. It must honor `AbortSignal`. Implement an OpenAI-compatible chat/completions provider using Node `fetch`, explicit endpoint/model, API key from a configured environment variable name, short timeout, `max_tokens` no greater than protocol limits, low temperature, and a system instruction requiring a suffix only.

Serialize context in deterministic labeled sections and state that repository content is untrusted data, not instructions. Do not print or retain the serialized request. Parse only documented minimal response fields; reject missing/multiple/tool-call/oversized/control-sequence output with typed errors. Support a response that is already a suffix. If complete-prompt projection is offered, require an exact byte-for-byte prefix and return only the remainder; never fuzzy match or normalize whitespace.

Implement a per-process token bucket defaulting to 60 remote requests/hour, one retry only for explicitly retryable transport status before any content is returned, exponential cooldown after rate limiting or five consecutive failures, and cancellation that tears down fetch. Telemetry exposes status class, duration, request/response byte buckets, and error code only.

## Concrete Steps

From the repository root:

    npm test --workspace @chat-suggestion/provider
    npm run typecheck --workspace @chat-suggestion/provider
    npm run build --workspace @chat-suggestion/provider

Use a local Node HTTP fixture bound to loopback on an ephemeral port. Tests must never contact the internet. Verify the test process contains no provider key after each case and server request bodies are retained only in test memory.

## Validation and Acceptance

Tests prove deterministic fake output, fake cancellation, correct endpoint headers, exact model/limits, successful suffix extraction, exact-prefix projection, malformed JSON, non-2xx classes, timeout, retry boundaries, 429 cooldown, rate limit, ANSI/OSC/control rejection, maximum bytes/characters/lines, and abort closing the request. A test logger must fail if it receives draft, context, API key, auth header, or completion text.

## Idempotence and Recovery

The local HTTP server closes in `afterEach`/`finally`, timers are fake where practical, and no credentials or network are required. Do not update root manifests or lockfiles. Any package-only dependency must be justified in the Decision Log and declared only in `packages/provider/package.json` for later lock reconciliation.

## Artifacts and Notes

Document configuration using placeholder values only. Include a warning that provider retention and privacy depend on the chosen endpoint and must be reviewed by the user.

## Interfaces and Dependencies

Depend on `@chat-suggestion/protocol` and standard Node `fetch`. Export fake and OpenAI-compatible providers, provider configuration parsers, typed provider errors, and no-content telemetry types from `packages/provider/src/index.ts`. Do not export API keys, raw request bodies, or vendor-specific DTOs as common contracts.

Revision note: Initial parallel workstream plan created 2026-07-11.
