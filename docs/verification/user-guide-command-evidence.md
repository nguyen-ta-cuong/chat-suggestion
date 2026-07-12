# User-guide command evidence

This is short, redacted evidence for the commands published in
[`docs/user-guide.md`](../user-guide.md). It deliberately omits workspace paths,
drafts, context previews, credentials, and raw terminal recordings.

Recorded 2026-07-11 through 2026-07-12 on macOS 15 (Darwin 25.5.0, arm64) with
Node 24.16.0, npm 11.16.0, Pi 0.80.6, and Codex CLI 0.144.1.

- `build`: `npm run build` exited 0 and compiled all eleven workspaces.
- `status`: `npm run chat-suggest -- status` exited 0 with the fake provider by
  default. Pi reported `runtime-handshake-required`; Codex stock TUI reported
  `inlineRender: none`; Claude was unavailable on this machine.
- `fake-demo`: `npm run chat-suggest -- demo --provider fake` exited 0, accepted
  one deterministic suffix, and reported `submitted: false`.
- `context-preview`:
  `npm run chat-suggest -- context preview --provider fake --trust-project`
  exited 0 and made no provider call. Its envelope content is intentionally not
  reproduced here because preview output is sensitive.
- `pi-package`: `npm run test:package --workspace @chat-suggestion/adapter-pi`
  exited 0 after packing the protocol and Pi artifacts into temporary tarballs,
  installing them without workspace links, and verifying the `pi.extensions`
  production entry. No package was published.
- `pi-smoke`: the documented explicit-extension smoke command is a manual Pi TUI
  check. It uses `PI_OFFLINE=1`, no tools, no session, no extension discovery,
  and the deterministic fake bridge.
- `pty-refusal`: with both required opt-ins, the wrapper exited 78 before child
  launch and reported that no exact fixture-tested PTY profile matched.
- `codex-frontend`: `npm run chat-suggest -- codex --provider fake` initialized
  the installed App Server, displayed the documented deterministic suffix as dim
  end-of-line decoration, accepted it with Tab without starting a coding turn,
  and restored the terminal on Ctrl-D. No suggestion model request was made.
- `codex-frontend-live`: `npm run chat-suggest -- codex` used a separate
  ephemeral Codex suggestion thread and rendered a suffix for a synthetic draft.
  The original 1,800 ms timeout canceled before output; the new 8,000 ms
  Codex-specific default rendered successfully. Tab accepted without submission.
  A separate harmless coding-turn smoke streamed `OK`, restored the empty
  editor, and exited cleanly. Raw session content, credentials, and private
  project text are intentionally omitted; live checks may consume Codex quota.

- `pi-model-smoke`: after explicit user authorization, the production extension
  was run with Pi's selected `openai-codex/gpt-5.4-mini` model and a synthetic
  draft. Pi rendered a dim, single-line suffix and Tab inserted it without
  submitting. A metadata-only repeat measured 1,652 ms for the model call. The
  initial request failure was traced to the bridge forcing an unsupported
  `temperature` parameter; the successful check omitted it. No raw provider
  credentials or private prompt content were recorded.
- `pi-latency-smoke`: a metadata-only synthetic benchmark measured 2,729 ms
  without a provider session, 2,399 ms for the first dedicated-session call, and
  1,043 ms after connection reuse. Streaming first text arrived at 962 ms and
  completed at 1,074 ms. The production TUI then preserved the untyped remainder
  immediately when one typed character matched the visible ghost; Tab accepted
  it without submission. Timings are observations, not guarantees.
- `pi-progressive-smoke`: on a warm reusable connection, the selected model's
  first text arrived in 821–872 ms and completed in 1,009–1,023 ms. SSE was
  slower at 925 ms to first text, and explicit minimal reasoning was much slower
  at 3,413 ms while emitting 75 reasoning deltas. The production bridge kept the
  faster auto transport with omitted reasoning and rendered validated text
  deltas immediately. A real Pi TUI repeat preserved matching type-through and
  non-submitting Tab acceptance. Timings are observations, not guarantees.

The offline Pi smoke path remains the credential-free rendering proof. The
model-backed smoke may use provider quota or incur provider charges.
