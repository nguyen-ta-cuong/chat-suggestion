# Privacy and security

## Data sent for a suggestion

For each eligible edit, the production extension sends the following through
Pi's selected model provider:

- a fixed instruction asking for a short insertion-only continuation;
- Pi's active, compaction-aware conversation messages;
- the current unsent prompt draft, limited to 8 KiB.

It also forwards Pi's active session ID for providers that support session
affinity and requests at most 64 output tokens. Provider policies, retention,
billing, and network routing are determined by the model and credentials
selected in Pi.

## Data not collected

The extension does not independently scan repository files or Git state.
However, active conversation messages can contain prior tool results, file
contents, attachments, or project instructions, and those are part of the
context sent for a suggestion. The extension does not write telemetry or log
prompt or completion text. Credentials are requested from Pi's model registry
for the active request and are not persisted by this extension.

The offline example never calls the model bridge. Avoid pressing Enter during
that check, because submitting is normal Pi behavior outside this extension.

## Untrusted output

Model output is never executed or submitted. Before rendering, the extension:

- removes terminal escape sequences and control characters, and rejects
  malformed Unicode;
- limits output to one line, 160 Unicode code points, and 1 KiB;
- requires a current request ID and prompt revision;
- requires an insertion at the current UTF-8 cursor offset.

Unknown prompt or cursor identity clears the suggestion. A transient layout,
focus, no-room layout, or autocomplete state suppresses rendering and Tab acceptance
without making stale text actionable. `/chat-suggest` reports only version,
capability, and a clear-reason label; it never includes prompt or completion
text.

## Reporting a vulnerability

Follow [SECURITY.md](../SECURITY.md). Do not include real prompts, credentials,
provider headers, or private repository content in a public report.
