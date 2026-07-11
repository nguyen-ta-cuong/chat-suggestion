# Chat Suggestion Product Requirements

Status: Draft for implementation

## 1. Product summary

Chat Suggestion adds Cursor-style inline completion to coding-agent prompt editors. After a short typing pause, it builds a small, privacy-filtered snapshot of the unfinished prompt and relevant workspace context, asks a fast model for a short continuation, and displays only the missing suffix as dim ghost text. Tab accepts a current suggestion, Escape dismisses it, and any incompatible edit invalidates it.

The product is a shared suggestion engine with host-specific adapters. A native adapter is the preferred integration because the component that owns the editable prompt also owns cursor layout, key handling, undo, autocomplete, and rendering. Pi is the first supported native host. Codex CLI, Claude Code, and unknown full-screen terminal programs use only capabilities verified at runtime; they must not be advertised as exact inline integrations when no editor API exists.

## 2. Reverse-engineered behavior model

Cursor is proprietary, so this document does not claim knowledge of its private implementation. It reconstructs the minimum mechanism required to reproduce the observable behavior:

1. Every prompt edit creates an immutable snapshot containing text, cursor, selection, host, and a monotonically increasing revision.
2. A debounce waits for a configurable idle interval, initially 150–250 ms.
3. A bounded context assembler collects recent conversation, changed files, selected project snippets or symbols, attachments, and plan context according to explicit privacy policy.
4. A fast completion provider returns an insertion-only suffix for the exact snapshot revision.
5. The coordinator discards late, canceled, unsafe, empty, duplicated, or revision-mismatched results.
6. The host paints the suffix as decoration. Ghost text is never part of the prompt buffer until acceptance.
7. Tab inserts the suffix exactly once through the host editor API. Escape clears it. Typing, moving the cursor, opening completion UI, submitting, resizing into an unsupported state, or changing sessions clears it.

The state machine is:

    idle -> debouncing -> collecting -> generating -> visible
      ^         |             |             |           |
      +---------+-------------+-------------+-----------+
                  edit, cancel, stale result, or dismiss

A visible suggestion is valid only while its request ID, prompt revision, text, cursor, selection, and session identity still match the host snapshot.

## 3. Research findings and feasibility

### Pi

Pi 0.80.6 has a verified native extension path. Its official APIs include `ctx.ui.setEditorComponent`, `ctx.ui.getEditorComponent`, `CustomEditor`, editor text/cursor methods, injected keybindings, theme styling, session access, and independent model calls. Pi does not expose a dedicated inline-decoration primitive. The MVP therefore supports conservative end-of-input, single-line ghost text and uses autocomplete or a below-editor widget when exact inline rendering is unsafe.

### Codex CLI

A locally bundled Codex CLI 0.144.0-alpha.4 exposes plugins, hooks, MCP, and an experimental app-server, but research found no verified per-keystroke prompt editor or decoration API. Submit lifecycle hooks are too late. A custom app-server frontend can own its editor and provide native-quality suggestions, but modifying the existing TUI requires an upstream editor API or a conservative PTY fallback.

### Claude Code

No Claude executable was available locally. Existing configuration proves lifecycle hooks, not editor access. Claude support remains capability-gated until an installed version proves a native editor surface. Otherwise it uses the conservative PTY mode.

### Generic terminal fallback

A pseudoterminal (PTY) wrapper can intercept bytes but does not automatically know the child program's logical prompt buffer. Exact transparent inline rendering across arbitrary full-screen TUIs would require much of a terminal emulator and still cannot recover hidden semantic state. The fallback must track only high-confidence append/backspace input, clear on ambiguity, use adjacent status UI when inline painting is unsafe, and never intercept Tab unless a valid suggestion is visible.

## 4. Goals

The MVP must:

- Provide responsive, safe, insertion-only suggestions for unfinished agent prompts.
- Deliver native end-of-input ghost text in Pi TUI mode.
- Share one host-neutral coordinator, context contract, and provider contract.
- Support deterministic tests without model credentials or paid requests.
- Detect host capabilities at runtime and degrade visibly and safely.
- Preserve native keybindings, autocomplete, undo, paste, IME, and submit behavior whenever the host exposes them.
- Keep unsent prompt and repository content private by default.
- Make adapter packages independently implementable after one small contract/bootstrap plan.

## 5. Non-goals

The MVP does not:

- Claim exact inline support for every CLI.
- Reverse engineer proprietary binaries or depend on undocumented private symbols.
- Replace arbitrary text before the cursor; suggestions are insertion-only at first.
- Execute suggested commands, submit prompts automatically, or silently attach files.
- Train a model or build a language server.
- Guarantee multiline inline rendering in Pi or a PTY.
- Read the entire repository or send context remotely without explicit configuration.
- Reuse an agent CLI's subscription credentials through undocumented mechanisms.

## 6. Users and core scenarios

A developer typing `fix the failing auth` pauses and sees ` tests and add a regression test` in dim text. Pressing Tab inserts only that suffix. Pressing Escape removes it without changing the draft. Continuing to type cancels the old request and prevents its late result from appearing.

A Pi user receives native inline suggestions at the end of a prompt. If another custom editor prevents safe composition, the extension reports a downgrade and uses an adjacent suggestion widget or disables rendering.

A Codex or Claude user launches through the wrapper. If prompt state remains high-confidence, the wrapper may show a suggestion in a reserved adjacent surface. Cursor navigation, full-screen redraw, password input, or unknown terminal sequences immediately suspend capture and rendering.

## 7. Functional requirements

### FR-1 Snapshot and invalidation

Each request includes protocol version, request ID, revision, host capabilities, prompt text, UTF-8-safe cursor position, optional selection, working directory, and session identity. Every edit aborts the previous request. A response for any non-current snapshot is discarded.

### FR-2 Trigger policy

Automatic generation starts only when suggestions are enabled, the host is idle, the prompt meets a configurable minimum length, no hidden-input state is active, and no incompatible completion or dialog is visible. Manual trigger is supported through the host adapter. The default debounce is configurable between 100 and 1,000 ms.

### FR-3 Context assembly

Context sources are independent collectors with byte budgets and timeouts. Initial collectors cover current draft, bounded recent conversation, Git diff/status, explicitly referenced files, configured plan files, and small project snippets. Collection respects trust, ignore rules, binary detection, secret filtering, and an overall budget. Collector failure reduces context rather than blocking suggestions.

### FR-4 Generation

A `SuggestionProvider` receives the bounded request and an `AbortSignal`. The repository ships a deterministic fake provider and one configurable API provider. Output is short, plain text, insertion-only, and contains no ANSI/OSC or disallowed control characters. Provider failures are quiet and rate-limited.

### FR-5 Rendering

Adapters render a suggestion as decoration, not prompt content. Native adapters use host theme colors. The first Pi release renders one line only at logical end-of-input. Unsupported cursor/layout states use adjacent UI or no UI. Rendering must not leave artifacts after clear, resize, submit, or child output.

### FR-6 Acceptance and dismissal

Tab accepts all visible text only when the suggestion is current; otherwise Tab retains native behavior. Escape dismisses a visible suggestion before falling through to the host's normal interrupt behavior. Any accepted suffix is inserted exactly once. Reference attachment is capability-gated: hosts without a documented attachment API insert explicit textual references such as `@path` and never silently attach data.

### FR-7 Capability detection

Adapters report structured capabilities rather than one support boolean: transport, buffer read, cursor read, inline mode (`arbitrary`, `eol-only`, `adjacent`, `none`), atomic acceptance, cancellation, resize safety, and alternate-screen safety. Selection order is native, protocol-owned frontend, conservative PTY, unsupported.

### FR-8 Configuration and observability

Users can enable/disable suggestions, choose provider/model, set debounce and budgets, disable context sources, and inspect the current capability/downgrade reason. Metrics contain timings, counters, and byte sizes only. Raw prompt, completion, file, and chat text is never logged by default.

## 8. Non-functional requirements

### Size and context budgets

- A serialized suggestion request is at most 64 KiB. Reserve 8 KiB for protocol metadata and framing.
- The draft is at most 8 KiB and appears once in the request, not duplicated in the context envelope.
- Additional context is at most 48 KiB: recent chat 12 KiB, tracked Git status/diff 20 KiB, project metadata/explicit snippets 8 KiB, explicit textual attachments 4 KiB, and plan context 4 KiB.
- A candidate is at most 160 Unicode characters, two logical lines (at most one newline), and 1,024 UTF-8 bytes. Adapters apply their own visual-width limit; the Pi MVP renders only one visual line. Provider generation is capped at 64 tokens before these deterministic post-limits.
- When metadata expansion would exceed 64 KiB, lower-priority context is trimmed again; the serialized total is authoritative.

### Performance

- Local input handling and invalidation add less than 8 ms at p95.
- Context collection finishes within 100 ms at p95 on a normal repository; slow collectors are canceled.
- Rendering after a provider result takes less than one frame, targeted at 16 ms.
- The product records request-to-visible latency. Initial target is p50 below 700 ms and p95 below 1,800 ms for a configured remote provider; provider network time is reported separately.
- No more than one generation per adapter is active at a time.

### Reliability

- Late results never render or insert.
- Terminal mode and signal handling are restored after normal exit, crash, Ctrl-C, Ctrl-D, suspend, and child termination.
- Unknown terminal or adapter states fail closed by clearing and suspending suggestions.
- All packages run on supported Node.js LTS and current Node 24 without global dependencies beyond the selected host CLI.

### Privacy and security

- Remote transmission is off until a provider is explicitly configured and acknowledged.
- Project context requires trusted-project status or explicit opt-in.
- Socket files, if introduced, use user-only permissions.
- Context and response sizes are bounded before allocation and parsing.
- Model output is treated as untrusted text, stripped of terminal controls, and never executed.
- PTY capture is restricted to allowlisted agent commands and disabled for hidden/password prompts.
- Repository instructions and file content are treated as prompt-injection-capable data, not authority.

### Accessibility and compatibility

- Dim text must remain readable in light and dark themes; adapters use theme semantics rather than fixed gray when possible.
- Tests cover narrow widths, resizing, tmux, alternate screen, bracketed paste, emoji, combining characters, and CJK width.
- Native IME cursor behavior must remain intact.

## 9. Architecture and contracts

The TypeScript workspace uses Node.js ESM and npm workspaces to minimize tool dependencies.

    packages/protocol       frozen DTOs, capabilities, validation
    packages/engine         debounce/cancel/state coordinator
    packages/context        bounded context collectors and policy
    packages/provider       fake and configurable model providers
    packages/terminal       terminal sanitizing and confidence state
    adapters/pi             native Pi extension
    adapters/pty            generic PTY wrapper and host probes
    apps/chat-suggest       launcher and integration wiring
    fixtures/tui            open conformance fixture

The protocol package defines `PromptSnapshot`, `SuggestionRequest`, `SuggestionEdit`, `AdapterCapabilities`, `SuggestionProvider`, `SuggestionSurface`, `ContextCollector`, `ClearReason`, `Disposable`, and a data-only `PtyProfileDescriptor`. The descriptor carries an exact host/version fingerprint, declared detectors/markers, and downgrade metadata; executable PTY behavior remains in `adapters/pty`. Cursor positions use UTF-8 byte offsets at protocol boundaries and adapters validate code-point boundaries. The MVP accepts only `startByte === endByte === cursorByte`.

Packages communicate through interfaces and dependency injection. No package imports another adapter. Context collection does not render. Providers do not read files. Adapters do not choose model prompts. The integration app owns wiring and configuration.

## 10. Acceptance criteria

The MVP is accepted when all of the following are observable:

1. With the fake provider, typing a configured prefix in the Pi prompt shows the expected dim suffix after the debounce; Tab inserts it once and Escape leaves the draft unchanged.
2. Typing another character before a delayed response prevents that response from rendering.
3. Pi's ordinary Tab autocomplete and application shortcuts still work when no ghost is visible.
4. Context tests prove byte budgets, ignore policy, timeout behavior, and no raw-content logging.
5. The PTY fixture proves transparent byte forwarding, resize/signal propagation, terminal restoration, and automatic downgrade on ambiguous state.
6. Capability output does not claim native ghost text for Codex or Claude without a successful native handshake.
7. Tests pass for multiline drafts, emoji, combining marks, CJK, paste, resize, and canceled requests.
8. A fresh clone can run `npm install`, `npm run build`, `npm test`, and the documented Pi smoke test.
9. The [canonical user guide](docs/user-guide.md) proves a fresh-clone fake-provider workflow, warns before remote transmission and PTY use, explains capability downgrades honestly, links verified troubleshooting, and documents uninstall steps that remove only product-owned artifacts.

## 11. Delivery strategy

Run `plans/0001-bootstrap-and-freeze-contracts.md` first. It establishes the workspace and frozen interfaces. Then run plans 0002 through 0009 in parallel; they have non-overlapping ownership and depend only on plan 0001. Run plan 0010 to wire the packages, perform end-to-end validation, and prepare release artifacts. Run plan 0011 strictly after integration to verify every user-facing command and publish the canonical setup, usage, troubleshooting, privacy, and uninstall guide.

Pi is the first production-quality adapter. PTY support is explicitly experimental and conservative. Codex app-server and future Claude native support can be added as separate adapters after documented editor ownership is available.

## 12. Open product decisions

- Whether Escape should dismiss only, or dismiss and then invoke Pi interrupt on a second press.
- Which remote provider is documented first; the contract must remain provider-neutral.
- Whether a future broker process is useful once multiple adapters are active. The MVP uses in-process interfaces and does not require a daemon.
- Whether to propose a first-class inline-decoration API upstream to Pi after the EOL prototype measures rendering coupling.
