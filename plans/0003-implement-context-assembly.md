# Implement bounded and private context assembly

This ExecPlan is a living document maintained under `PLANS.md`. Run it after plan 0001. It owns `packages/context/**` only.

## Purpose / Big Picture

Build useful suggestion context without crawling or leaking a repository. After this plan, callers can assemble or preview the exact same bounded envelope from a draft, trusted project, Git changes, recent chat supplied by a host, allowlisted instruction/plan files, and explicit attachment metadata. Failures and slow collectors reduce context rather than blocking typing.

## Progress

- [ ] Inspect protocol and define collector inputs/policy.
- [ ] Implement repository boundary, trust, ignore, redaction, and budget utilities.
- [ ] Implement independent prompt, Git, project metadata, chat, plan, and attachment collectors.
- [ ] Implement deterministic trimming, timeout, cache, provenance, and preview.
- [ ] Add adversarial temporary-repository tests and run checks.

## Surprises & Discoveries

- Observation: None yet.
  Evidence: Update during implementation.

## Decision Log

- Decision: MVP source bodies are limited to allowlisted instruction/plan files, explicitly referenced files, host-supplied selected snippets, and explicitly attached text; arbitrary crawling and untracked bodies are excluded.
  Rationale: Explicit user/host selection provides useful symbols and code while avoiding broad repository exfiltration.
  Date: 2026-07-11
- Decision: Serialized UTF-8 bytes, not characters or estimated tokens, enforce the hard request budget.
  Rationale: It is deterministic and protects transport allocation.
  Date: 2026-07-11

## Outcomes & Retrospective

Not started. At completion, summarize included sources, measured timings, and all excluded secret/symlink cases.

## Context and Orientation

This package receives host-supplied chat and attachments; it never reaches into proprietary session storage. It may invoke Git with fixed argument arrays and tight timeouts. `PRD.md` defines the 64 KiB total request and source budgets. The provider and renderer are out of scope.

Do not edit shared contracts. If provenance or redaction data does not fit protocol v1, write `artifacts/contract-change-requests/0003.md`, retain richer details internally, and expose the compatible subset.

## Plan of Work

Define a `ContextPolicy` with trusted-project requirement, repository root, deny globs, allowlisted instruction names, per-source byte caps, total cap, collector timeout, cache TTL, and remote-enabled state. Resolve every path with `realpath` and verify it remains inside the repository. Exclude symlinks escaping the root, binary files, devices, `.env*`, credential/key stores, `.git`, and configured deny patterns.

Implement collectors that return text, source kind, original/included bytes, truncation, redaction count, and duration. Git collection covers tracked status plus staged and unstaged diff with fixed commands; it excludes untracked contents. Project metadata includes bounded relative names and language indicators. Add trust-gated collectors for explicitly referenced repository files and host-supplied selected symbol/code snippets; verify reference paths remain in-root and require snippet provenance, but do not discover arbitrary source bodies. Instruction and plan collection is explicit allowlist only. Attachments include bodies only when the caller marked them explicit, textual, in-policy, and bounded.

Implement defense-in-depth secret redaction with stable rule IDs and replacement markers. Never claim the scanner guarantees absence of secrets. Allocate bytes deterministically: current prompt first, then newest explicit attachment/plan, recent chat newest-first, diff, and project metadata; trim older/lower priority input. `previewContext` must call the same assembly function and make no provider call.

Use abortable collectors and individual timeouts. Cache only redacted bounded contributions in memory, at most twenty entries and five minutes. Logs and errors contain source kind and byte/timing metadata, not content or raw absolute paths.

## Concrete Steps

From the root run:

    npm test --workspace @chat-suggestion/context
    npm run typecheck --workspace @chat-suggestion/context
    npm run build --workspace @chat-suggestion/context

Tests must create disposable repositories with `git init`, local test identity, committed files, staged/unstaged changes, untracked secrets, symlinks, binary files, large Unicode data, nested repositories, and fake keys. Do not inspect the developer's actual repository contents in assertions.

Add a benchmark fixture representing 10,000 file names and record warm and cold p95 without making CI flaky.

## Validation and Acceptance

Assert the final serialized envelope never exceeds policy; the draft is retained unless it alone exceeds its cap, in which case collection returns a typed skip result. Assert explicit in-root references and selected snippets appear only when trusted and within policy. Assert `.env`, private keys, fake tokens, untracked bodies, binary bytes, and out-of-root symlink targets never appear. Assert collector timeout still returns remaining sources. Assert preview and generation assembly are byte-for-byte equal for equal inputs. Assert aborted work stops Git child processes.

## Idempotence and Recovery

Temporary repositories are created under the test runner temp directory and removed in `finally`. Git commands are read-only except inside those fixtures. Tests need no network. Do not update the root lockfile or files outside ownership.

## Artifacts and Notes

Keep fake secrets unmistakably synthetic. Document the exact allowlist and deny rules in the package README without promising perfect secret detection.

## Interfaces and Dependencies

Depend only on `@chat-suggestion/protocol` and Node APIs unless a narrowly scoped glob library is justified. Export `collectContext`, `previewContext`, `ContextPolicy`, collector interfaces, source/provenance metadata, and typed skip/error results. Shell execution must use argument arrays, never interpolate repository text into a shell command.

Revision note: Initial parallel workstream plan created 2026-07-11.
