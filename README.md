# Chat Suggestion

Cursor-style inline prompt suggestions for coding-agent chat editors.

## Get started

Start with the deterministic offline provider in the [user guide](docs/user-guide.md).
Suggestions stay decoration until accepted with Tab; they never submit prompts or
execute commands. Pi is the only native adapter exercised by this MVP, but its
durable installation artifact is not yet available. Codex and Claude stock TUIs
remain capability-gated, and PTY support is experimental and fails closed.

## Documentation

- [Product requirements and architecture](PRD.md)
- [Verified end-user guide](docs/user-guide.md)
- [Agent implementation rules](AGENTS.md)
- [Execution-plan graph](PLANS.md)
- [Executable implementation plans](plans/)

## Implementation order

1. Run `plans/0001-bootstrap-and-freeze-contracts.md` alone.
2. Run plans 0002–0009 in parallel with their non-overlapping file ownership.
3. Run `plans/0010-integrate-test-and-package.md` after the parallel wave.
4. Run `plans/0011-write-end-user-setup-and-usage-guide.md` after integration to verify and publish the final setup and usage guide.

The suggestion is always decoration until explicit acceptance. Implementations must reject stale results, preserve native key behavior, avoid logging unsent prompt/context content, and fail closed when host or terminal state is ambiguous.
