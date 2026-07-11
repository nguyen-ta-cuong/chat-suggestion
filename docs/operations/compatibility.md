# Compatibility and capability levels

This document records integration evidence for the 0.1.0 workspace. It is
operational evidence for the later user-guide handoff, not a claim that every
installed agent TUI supports inline suggestions.

## Verified integration environment

- Node.js 24.16.0 and npm 11.16.0 on macOS completed the workspace build and
  deterministic tests on 2026-07-11. The supported floor is Node 22.19.0,
  matching the resolved Pi peer packages.
- The lockfile resolves the documented Pi peer packages at 0.80.6. The Pi
  adapter uses documented custom-editor and TUI APIs. Outside Pi, `status`
  reports `inlineRender: none`; native end-of-input, one-line rendering becomes
  available only after the extension verifies TUI mode and safe custom-editor
  composition at runtime.
- `node-pty` 1.1.0 is optional and supported by the adapter only on macOS and
  Linux. Installation or PTY allocation alone does not establish semantic editor
  access.
- Codex and Claude support is derived from bounded runtime probes. Their stock
  TUIs report no inline rendering unless a future public native editor handshake
  succeeds.

The capability selection order is: verified native adapter, verified
protocol-owned frontend, exact fixture-tested PTY profile, then unsupported. A
custom Codex app-server frontend can own an editor; that does not add decoration
access to the stock Codex TUI.

## Offline evidence commands

After `npm install` and `npm run build`:

```sh
npm run chat-suggest -- status
npm run chat-suggest -- demo --provider fake
npm run chat-suggest -- context preview --provider fake --trust-project
npm run chat-suggest -- pi install-path
```

`demo` always uses the deterministic fake provider. It inserts the suffix once
into an in-memory surface and reports `submitted: false`. It never starts a paid
or remote request.

## Experimental PTY seam

PTY wrapping has two independent consent gates: configuration must set
`host.experimentalPty` to `true`, and invocation must include
`--experimental-pty`. The executable basename must also be in
`host.allowlistedCommands`. The current integration intentionally refuses to
launch when no exact executable/version/SHA-256 profile is configured; a generic
command name is not enough evidence.

```sh
npm run chat-suggest -- wrap --experimental-pty -- codex
```

With the shipped defaults this command fails closed before launching the child.
This is expected until a fixture-tested profile is supplied by a host adapter.
