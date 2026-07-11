# Suggestion providers

`@chat-suggestion/provider` supplies a deterministic fake provider and an
OpenAI-compatible HTTP provider. Providers only return insertion text. They do
not read files, inspect credentials belonging to other tools, execute model
output, or accept tool calls.

The fake provider maps exact drafts to fixed suffixes and is the default choice
for offline tests. The remote provider requires an explicit HTTPS endpoint,
model, and the name of an environment variable containing its API key. HTTP is
accepted only for loopback test servers. For example, configure
`apiKeyEnvironmentVariable: "EXAMPLE_PROVIDER_KEY"`; never put the key itself in
configuration.

Review the chosen endpoint's privacy and retention terms before enabling remote
transmission. Draft and context text are sent to that endpoint. Telemetry emits
only timing, status class, byte-size buckets, and error codes; it never includes
request bodies, response text, API keys, or authorization headers.

Remote output is rejected if it contains terminal controls, tool calls,
multiple choices, more than two lines, more than 160 Unicode characters, or
more than 1,024 UTF-8 bytes. Requests time out, honor caller cancellation, use a
per-process token bucket, retry one explicitly retryable transport response,
and cool down after rate limiting or repeated failures.
