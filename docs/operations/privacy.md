# Privacy and remote transmission

The default provider is `fake`; it performs no network request. The offline demo
always uses that provider regardless of project configuration. A remote request
is possible only when `provider.kind` is `openai-compatible` and the named API
key environment variable is set.

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
