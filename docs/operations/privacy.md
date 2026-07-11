# Privacy and data handling

Suggestions are disabled from remote transmission because the integrated CLI
currently executes only the `fake` provider. Remote configuration is validated
for future wiring, but no shipped CLI or demo path sends it to a provider.
Diagnostics display an API-key environment variable name, never its value, and
reduce endpoints to their origin with a redacted path marker.

The context preview is read-only and does not call a provider. It requires
either `--trust-project` for the current invocation or an exact resolved
working-directory entry in `context.trustedProjects`. Context collectors are
bounded independently and as a whole. Deny patterns exclude `.env*`, private
keys, credential-like files, and `.git`; repository paths are checked against
the repository boundary; binary and unsafe content is excluded or redacted.

The draft is carried once in the protocol snapshot. It is not duplicated into
context contributions. Metrics contain names, durations, counts, and byte
buckets only. Raw drafts, suggestions, chat messages, file contents, API keys,
authorization headers, and terminal sessions must not be logged.

Provider output is untrusted insertion-only text. It is bounded and stripped of
ANSI, OSC, and disallowed controls before rendering. Acceptance inserts text but
never sends Enter, submits the prompt, executes a command, or attaches a file.

The PTY fallback captures input only after an exact profile handshake. Hidden
input, cursor movement, completion ownership, paste boundaries, alternate-screen
activity, redraws, resize, unexpected output, or unknown sequences clear and
suspend suggestions.
