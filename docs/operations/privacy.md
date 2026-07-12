# Privacy and remote transmission

The default provider is `fake`; the offline demo always uses it and performs no
model request regardless of project configuration. An OpenAI-compatible remote
request is possible only when `provider.kind` is `openai-compatible` and the
named API key environment variable is set.

The `chat-suggest codex` command is an explicit exception because it launches a
Codex client. When no OpenAI-compatible suggestion provider is configured, the
frontend sends the bounded unfinished draft through a separate ephemeral,
read-only Codex App Server thread for suggestion generation. This uses the
installed Codex account and can consume quota. The suggestion prompt includes
the draft but does not collect or send project context. Pressing Enter sends the
accepted draft to the separate coding thread. Only an explicitly configured
OpenAI-compatible suggestion provider collects enabled context, and project
context still requires an exact `trustedProjects` match.

`chat-suggest codex --provider fake` keeps suggestion generation deterministic
and makes no suggestion model request. It still initializes the local App
Server, and pressing Enter still starts a real Codex coding turn. For a fully
offline rendering check, type only the documented fake prefix, avoid Enter, then
clear and exit.

Remote configuration has this shape:

    {
      "provider": {
        "kind": "openai-compatible",
        "endpoint": "https://provider.example/v1/chat/completions",
        "model": "example-fast-model",
        "apiKeyEnvironmentVariable": "CHAT_SUGGEST_API_KEY",
        "timeoutMs": 10000,
        "maxTokens": 64,
        "requestsPerHour": 60,
        "outputProjection": "suffix"
      }
    }

This configuration names an environment variable; it does not contain the key.
Endpoints require HTTPS, except loopback HTTP used by deterministic tests.
Credentials in endpoint URLs and unknown fields are rejected. Status output
removes endpoint query strings and fragments and never reads or prints the API
key value.

Project context is off until the repository path exactly matches a
`trustedProjects` entry or the user explicitly confirms a single preview with
`--trust-project`. Context sources can be disabled independently:

    {
      "context": {
        "enabledSources": {
          "recent-chat": true,
          "git": false,
          "project": false,
          "attachment": true,
          "plan": false
        }
      }
    }

Source and total byte limits cannot exceed protocol limits. Secret-like values,
denied paths, binaries, symlink escapes, and invalid UTF-8 are filtered by the
context package. Metrics contain only timings, counters, status classes, and
bucketed byte sizes. Raw drafts, completions, chat, file contents, API keys, and
authorization headers are not telemetry.

`context preview` intentionally prints the bounded, redacted envelope to the
requesting terminal so the user can inspect what would be eligible for a
provider call. It never calls a provider itself. Treat its output as sensitive.
