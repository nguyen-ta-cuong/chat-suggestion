# User-guide command evidence

This is short, redacted evidence for the commands published in
[`docs/user-guide.md`](../user-guide.md). It deliberately omits workspace paths,
drafts, context previews, credentials, and raw terminal recordings.

Recorded 2026-07-11 on macOS 15 (Darwin 25.5.0, arm64) with Node 24.16.0, npm
11.16.0, and Pi 0.80.6.

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
- `pi-install-path`: `npm run chat-suggest -- pi install-path` exited 0 and
  returned the local adapter package directory; the path is omitted here.
- `pi-smoke`: the documented explicit-extension smoke command is a manual Pi TUI
  check. It uses `PI_OFFLINE=1`, no tools, no session, no extension discovery,
  and the deterministic fake bridge.
- `pty-refusal`: with both required opt-ins, the wrapper exited 78 before child
  launch and reported that no exact fixture-tested PTY profile matched.

The Pi local-package installer itself was also tested. It accepted the package
directory, but Pi could not load that directory as an extension at startup. See
[`artifacts/contract-change-requests/0011.md`](../../artifacts/contract-change-requests/0011.md);
the guide does not advertise that installation as working.
