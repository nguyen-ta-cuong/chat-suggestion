# Execution Plan Rules

Every file under `plans/` is a self-contained living implementation plan. An implementer must be able to start with only the repository and its assigned plan. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current at every stopping point.

## Execution graph

Run the plans in these waves:

    Wave 0: 0001
                  ┌─ 0002 engine
                  ├─ 0003 context
                  ├─ 0004 provider
                  ├─ 0005 terminal + fixture
    Wave 1:       ├─ 0006 Pi adapter
                  ├─ 0007 PTY adapter
                  ├─ 0008 Codex adapter
                  └─ 0009 Claude adapter
Wave 2: 0010 integration and release
Wave 3: 0011 verified user setup and usage guide ([canonical guide](docs/user-guide.md))

Wave 1 plans intentionally own disjoint paths and depend only on the protocol and workspace created by plan 0001. Their package-level tests use protocol fixtures or local doubles; cross-package fixture conformance belongs to plan 0010. Do not run multiple plans in one package. Every implementer also owns its own living plan file and matching contract-request note. Plan 0010 is the only plan permitted to reconcile contract requests and change integration/root wiring after bootstrap, including conditional edits to protocol and affected consumers recorded in its Decision Log. Plan 0011 then owns the final `README.md` handoff and `docs/user-guide.md` plus its documentation tests/evidence; it must verify final commands and must not edit `docs/operations/**` or runtime code.

## Required plan maintenance

Use UTC timestamps in `Progress`. Record surprising behavior with short command output or test evidence. Record every scope, dependency, API, or security decision in `Decision Log`. At completion, summarize observed user-visible behavior and remaining gaps in `Outcomes & Retrospective`.

Do not silently widen scope. If a shared contract is insufficient during Wave 1, create `artifacts/contract-change-requests/<plan-id>.md` and use a local test double where possible. Do not edit `packages/protocol` or root files from a Wave 1 plan.

## Commit and ownership policy

Commit frequently only when the execution environment and user request commits. Planning authors do not commit plan files. Parallel implementers must not reset, stash, clean, or overwrite unrelated work. Each plan lists owned paths; those boundaries are mandatory.

## Quality bar

A plan must deliver observable working behavior, not merely compile. Tests must be deterministic, offline by default, and cover cancellation, stale results, invalid input, cleanup, and privacy where relevant. Commands must be run from the repository root unless the plan explicitly says otherwise. Report exact results instead of claiming checks passed without evidence.
