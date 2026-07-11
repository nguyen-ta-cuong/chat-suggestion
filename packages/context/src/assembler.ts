import {
  CONTEXT_SOURCE_BYTE_LIMITS,
  MAX_CONTEXT_BYTES,
  MAX_DRAFT_BYTES,
  type ContextContribution,
  type ContextEnvelope,
} from "@chat-suggestion/protocol";

import { BoundedMemoryCache } from "./cache.js";
import { byteLength, truncateUtf8 } from "./bytes.js";
import { collectorCacheKey, createCollectors } from "./collectors.js";
import type {
  CollectedSource,
  ContextAssemblyInput,
  ContextCollectionResult,
  ContextCollector,
  ContextPolicy,
  SourceMetadata,
} from "./types.js";

interface CollectorResult {
  readonly source: CollectedSource | null;
  readonly metadata: SourceMetadata;
}

const COLLECTOR_ABORTED = Symbol("collector-aborted");

export const DEFAULT_DENY_PATTERNS = [
  ".env*",
  ".git/**",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.pem",
  "**/credentials*",
] as const;

export const DEFAULT_INSTRUCTION_ALLOWLIST = [
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "PLAN.md",
] as const;

export function createDefaultContextPolicy(
  repositoryRoot: string,
): ContextPolicy {
  return {
    repositoryRoot,
    requireTrustedProject: true,
    remoteEnabled: false,
    denyPatterns: DEFAULT_DENY_PATTERNS,
    instructionAllowlist: DEFAULT_INSTRUCTION_ALLOWLIST,
    sourceByteLimits: CONTEXT_SOURCE_BYTE_LIMITS,
    totalContextBytes: MAX_CONTEXT_BYTES,
    draftByteLimit: MAX_DRAFT_BYTES,
    collectorTimeoutMs: 100,
    cacheTtlMs: 5 * 60_000,
    cacheMaxEntries: 20,
  };
}

export class ContextAssembler {
  readonly #cache: BoundedMemoryCache<CollectedSource>;

  constructor(readonly policy: ContextPolicy) {
    validatePolicy(policy);
    this.#cache = new BoundedMemoryCache(
      policy.cacheMaxEntries,
      policy.cacheTtlMs,
    );
  }

  async collect(
    input: ContextAssemblyInput,
    signal: AbortSignal,
    collectors: readonly ContextCollector[] = createCollectors(
      input,
      this.policy,
    ),
  ): Promise<ContextCollectionResult> {
    const draftBytes = byteLength(input.snapshot.text);
    if (draftBytes > this.policy.draftByteLimit) {
      return {
        status: "skipped",
        reason: "draft-too-large",
        draftBytes,
        sources: [],
      };
    }
    if (signal.aborted) {
      return {
        status: "skipped",
        reason: "aborted",
        draftBytes,
        sources: [],
      };
    }

    const results = await Promise.all(
      collectors.map((collector) =>
        this.#runCollector(collector, input, signal),
      ),
    );
    if (signal.aborted) {
      return {
        status: "skipped",
        reason: "aborted",
        draftBytes,
        sources: results.map(({ metadata }) => metadata),
      };
    }

    return assembleEnvelope(results, this.policy);
  }

  async #runCollector(
    collector: ContextCollector,
    input: ContextAssemblyInput,
    parentSignal: AbortSignal,
  ): Promise<CollectorResult> {
    const cacheKey = collectorCacheKey(collector, input, this.policy);
    const cached = cacheKey === null ? undefined : this.#cache.get(cacheKey);
    if (cached !== undefined) {
      return {
        source: cached,
        metadata: metadataFor(cached, "included", 0),
      };
    }

    const controller = new AbortController();
    const abortFromParent = () => {
      controller.abort(parentSignal.reason);
    };
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(new Error("collector timeout"));
    }, this.policy.collectorTimeoutMs);
    const startedAt = performance.now();

    try {
      const collectorPromise = collector.collect(controller.signal);
      void collectorPromise.catch(() => undefined);
      const abortedPromise = new Promise<typeof COLLECTOR_ABORTED>(
        (resolve) => {
          controller.signal.addEventListener(
            "abort",
            () => {
              resolve(COLLECTOR_ABORTED);
            },
            { once: true },
          );
        },
      );
      const source = await Promise.race([collectorPromise, abortedPromise]);
      if (source === COLLECTOR_ABORTED) {
        throw controller.signal.reason;
      }
      const durationMs = performance.now() - startedAt;
      if (source !== null && cacheKey !== null) {
        this.#cache.set(cacheKey, source);
      }
      return {
        source,
        metadata:
          source === null
            ? emptyMetadata(collector, "empty", durationMs)
            : metadataFor(source, "included", durationMs),
      };
    } catch {
      const durationMs = performance.now() - startedAt;
      const outcome = parentSignal.aborted
        ? "aborted"
        : controller.signal.aborted
          ? "timed-out"
          : "failed";
      return {
        source: null,
        metadata: emptyMetadata(collector, outcome, durationMs),
      };
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    }
  }
}

export async function collectContext(
  input: ContextAssemblyInput,
  policy: ContextPolicy = createDefaultContextPolicy(
    input.snapshot.workingDirectory,
  ),
  signal: AbortSignal = new AbortController().signal,
): Promise<ContextCollectionResult> {
  return new ContextAssembler(policy).collect(input, signal);
}

export async function previewContext(
  input: ContextAssemblyInput,
  policy: ContextPolicy = createDefaultContextPolicy(
    input.snapshot.workingDirectory,
  ),
  signal: AbortSignal = new AbortController().signal,
): Promise<ContextCollectionResult> {
  return collectContext(input, policy, signal);
}

function assembleEnvelope(
  results: readonly CollectorResult[],
  policy: ContextPolicy,
): ContextCollectionResult {
  const contributions: ContextContribution[] = [];
  const includedByKind = new Map<string, number>();
  const metadata: SourceMetadata[] = [];

  for (const result of results) {
    const { source } = result;
    if (source === null) {
      metadata.push(result.metadata);
      continue;
    }
    const sourceLimit = Math.min(
      policy.sourceByteLimits[source.kind],
      CONTEXT_SOURCE_BYTE_LIMITS[source.kind],
    );
    const usedByKind = includedByKind.get(source.kind) ?? 0;
    const availableByKind = Math.max(0, sourceLimit - usedByKind);
    const sourceBounded = truncateUtf8(source.content, availableByKind);
    const fitted = fitContribution(
      contributions,
      { kind: source.kind, content: sourceBounded },
      Math.min(policy.totalContextBytes, MAX_CONTEXT_BYTES),
    );
    const includedBytes = byteLength(fitted);
    if (includedBytes > 0) {
      contributions.push({ kind: source.kind, content: fitted });
      includedByKind.set(source.kind, usedByKind + includedBytes);
    }
    metadata.push({
      ...result.metadata,
      includedBytes,
      truncated: includedBytes < byteLength(source.content),
      outcome: includedBytes > 0 ? "included" : "empty",
    });
  }

  const envelope: ContextEnvelope = { contributions };
  return {
    status: "collected",
    envelope,
    serializedBytes: serializedEnvelopeBytes(envelope),
    sources: metadata,
  };
}

function fitContribution(
  existing: readonly ContextContribution[],
  contribution: ContextContribution,
  maximumBytes: number,
): string {
  if (
    serializedEnvelopeBytes({
      contributions: [...existing, contribution],
    }) <= maximumBytes
  ) {
    return contribution.content;
  }

  const characters = Array.from(contribution.content);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const content = characters.slice(0, midpoint).join("");
    const bytes = serializedEnvelopeBytes({
      contributions: [...existing, { ...contribution, content }],
    });
    if (bytes <= maximumBytes) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  return characters.slice(0, low).join("");
}

function serializedEnvelopeBytes(envelope: ContextEnvelope): number {
  return byteLength(JSON.stringify(envelope));
}

function metadataFor(
  source: CollectedSource,
  outcome: SourceMetadata["outcome"],
  durationMs: number,
): SourceMetadata {
  return {
    sourceId: source.sourceId,
    kind: source.kind,
    originalBytes: source.originalBytes,
    includedBytes: byteLength(source.content),
    truncated: byteLength(source.content) < source.originalBytes,
    redactionRuleIds: source.redactionRuleIds,
    redactionCount: source.redactionCount,
    durationMs,
    outcome,
  };
}

function emptyMetadata(
  collector: ContextCollector,
  outcome: SourceMetadata["outcome"],
  durationMs: number,
): SourceMetadata {
  return {
    sourceId: collector.sourceId,
    kind: collector.kind,
    originalBytes: 0,
    includedBytes: 0,
    truncated: false,
    redactionRuleIds: [],
    redactionCount: 0,
    durationMs,
    outcome,
  };
}

function validatePolicy(policy: ContextPolicy): void {
  const positiveIntegers = [
    policy.totalContextBytes,
    policy.draftByteLimit,
    policy.collectorTimeoutMs,
    policy.cacheTtlMs,
    policy.cacheMaxEntries,
    ...Object.values(policy.sourceByteLimits),
  ];
  if (
    policy.repositoryRoot.length === 0 ||
    policy.totalContextBytes < serializedEnvelopeBytes({ contributions: [] }) ||
    policy.totalContextBytes > MAX_CONTEXT_BYTES ||
    policy.draftByteLimit > MAX_DRAFT_BYTES ||
    Object.entries(policy.sourceByteLimits).some(
      ([kind, value]) =>
        value >
        CONTEXT_SOURCE_BYTE_LIMITS[
          kind as keyof typeof CONTEXT_SOURCE_BYTE_LIMITS
        ],
    ) ||
    positiveIntegers.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new RangeError(
      "context policy limits must be positive integers within protocol bounds",
    );
  }
}
