# Context assembly

`@chat-suggestion/context` builds a deterministic, byte-bounded protocol context envelope. Repository-derived context is collected only for a trusted project. The package never reads proprietary chat storage: chat, selected snippets, attachments, references, and plan paths must be supplied by the host.

The default instruction allowlist is `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and `PLAN.md`. Explicit plan paths must match that allowlist. The built-in deny policy excludes `.git`, `.env*`, private-key and certificate extensions, credential stores, configured deny patterns, binary files, devices, and paths whose real target leaves the repository. Git status and diffs use tracked files only; untracked file bodies are never read.

Secret scanning is defense in depth, not a guarantee. Recognized values are replaced with stable markers such as `[REDACTED:github-token]`. Only redacted, bounded contributions enter the in-memory cache, which defaults to twenty entries and a five-minute lifetime. Diagnostics expose source kind, source identifier, byte counts, timing, and rule identifiers, never raw content or absolute paths.

`previewContext` delegates to the same assembly path as `collectContext`, so equal input and policy produce the same envelope. Slow or failed collectors are omitted. An oversized draft or caller abort returns a typed skip result.
