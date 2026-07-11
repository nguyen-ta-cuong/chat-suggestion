import type {
  ContextEnvelope,
  ContextSourceKind,
  PromptSnapshot,
} from "@chat-suggestion/protocol";

export interface ContextPolicy {
  readonly repositoryRoot: string;
  readonly requireTrustedProject: boolean;
  readonly remoteEnabled: boolean;
  readonly denyPatterns: readonly string[];
  readonly instructionAllowlist: readonly string[];
  readonly sourceByteLimits: Readonly<Record<ContextSourceKind, number>>;
  readonly totalContextBytes: number;
  readonly draftByteLimit: number;
  readonly collectorTimeoutMs: number;
  readonly cacheTtlMs: number;
  readonly cacheMaxEntries: number;
}

export interface ChatMessage {
  readonly role: string;
  readonly content: string;
}

export interface ExplicitAttachment {
  readonly name: string;
  readonly content?: string;
  readonly explicit: boolean;
  readonly textual: boolean;
}

export interface SelectedSnippet {
  readonly relativePath: string;
  readonly content: string;
  readonly provenance: string;
}

export interface ContextAssemblyInput {
  readonly snapshot: PromptSnapshot;
  readonly trustedProject: boolean;
  readonly recentChat?: readonly ChatMessage[];
  readonly attachments?: readonly ExplicitAttachment[];
  readonly planFiles?: readonly string[];
  readonly referencedFiles?: readonly string[];
  readonly selectedSnippets?: readonly SelectedSnippet[];
}

export interface SourceMetadata {
  readonly sourceId: string;
  readonly kind: ContextSourceKind;
  readonly originalBytes: number;
  readonly includedBytes: number;
  readonly truncated: boolean;
  readonly redactionRuleIds: readonly string[];
  readonly redactionCount: number;
  readonly durationMs: number;
  readonly outcome:
    "included" | "empty" | "denied" | "failed" | "timed-out" | "aborted";
}

export interface ContextCollectionSuccess {
  readonly status: "collected";
  readonly envelope: ContextEnvelope;
  readonly serializedBytes: number;
  readonly sources: readonly SourceMetadata[];
}

export interface ContextCollectionSkipped {
  readonly status: "skipped";
  readonly reason: "draft-too-large" | "aborted";
  readonly draftBytes: number;
  readonly sources: readonly SourceMetadata[];
}

export type ContextCollectionResult =
  ContextCollectionSuccess | ContextCollectionSkipped;

export interface CollectedSource {
  readonly sourceId: string;
  readonly kind: ContextSourceKind;
  readonly content: string;
  readonly originalBytes: number;
  readonly redactionRuleIds: readonly string[];
  readonly redactionCount: number;
  readonly durationMs: number;
}

export interface ContextCollector {
  readonly sourceId: string;
  readonly kind: ContextSourceKind;
  collect(signal: AbortSignal): Promise<CollectedSource | null>;
}
