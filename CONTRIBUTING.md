# Contributing

Thank you for helping improve Chat Suggestion for Pi.

## Before you start

- Search existing issues and Discussions before opening something new.
- Keep the project Pi-only and use documented public Pi APIs.
- For behavior changes, describe the user-visible problem and safety impact.
- Do not include private prompts, sessions, credentials, or repository content
  in issues, tests, screenshots, or logs.

Choose the channel that best fits your contribution:

- Ask usage questions and explore early ideas in
  [GitHub Discussions](https://github.com/nguyen-ta-cuong/chat-suggestion/discussions).
- Report a reproducible defect with the bug-report issue form.
- Submit a concrete improvement with the feature-request issue form.
- Follow [SECURITY.md](SECURITY.md) for vulnerabilities; do not disclose them in
  public issues or Discussions.

Blank issues are disabled so reports arrive with enough context to act on.
Small fixes can go directly to a pull request. Discuss large UI, keybinding,
provider, or safety changes before implementation so maintainers and
contributors can agree on scope.

## Development setup

Install Node.js 22.19.0 or newer and npm, then run:

```sh
git clone https://github.com/nguyen-ta-cuong/chat-suggestion.git
cd chat-suggestion
npm install
npm run check
```

The test suite is deterministic and must not require credentials, network
access, a private Pi session, or a paid model request.

## Design rules

- Suggestions remain decoration until explicit Tab acceptance.
- Never submit or execute a suggestion automatically.
- Associate asynchronous work with a prompt revision and request ID.
- Abort superseded work and reject it again before render and acceptance.
- Keep edits insertion-only at the cursor.
- Delegate every unconsumed key to Pi's native editor.
- Fail closed on unknown cursor, layout, autocomplete, mode, or editor state:
  hide the ghost and disable acceptance without treating a transient
  presentation condition as a permanent candidate invalidation.
- Treat model output as untrusted terminal text and enforce size limits.
- Never log raw drafts, suggestions, credentials, headers, or file content.

See [docs/architecture.md](docs/architecture.md) before changing the editor or
model bridge.

## Pull requests

Keep commits focused and use clear imperative messages. A pull request should
include:

- what changed and why;
- tests added or updated;
- exact validation commands and results;
- any compatibility, privacy, keybinding, or downgrade impact.

Run `npm run check` before requesting review. Update public documentation when a
command, requirement, privacy behavior, or user-visible capability changes.
