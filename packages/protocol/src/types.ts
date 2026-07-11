export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export type Transport = "native" | "app-server" | "pty" | "none";
export type InlineRender = "arbitrary" | "eol-only" | "adjacent" | "none";

export interface AdapterCapabilities {
  readonly transport: Transport;
  readonly inlineRender: InlineRender;
  readonly bufferRead: boolean;
  readonly cursorRead: boolean;
  readonly atomicAcceptance: boolean;
  readonly cancellation: boolean;
  readonly resizeAwareness: boolean;
  readonly alternateScreenSafety: boolean;
  readonly nativeCompletionAwareness: boolean;
  readonly attachmentReferences: boolean;
}

export interface HostIdentity {
  readonly name: string;
  readonly version: string;
}

export interface ByteRange {
  readonly startByte: number;
  readonly endByte: number;
}

export interface PromptSnapshot {
  readonly revision: number;
  readonly text: string;
  readonly cursorByte: number;
  readonly selection?: ByteRange;
  readonly host: HostIdentity;
  readonly capabilities: AdapterCapabilities;
  readonly workingDirectory: string;
  readonly sessionId: string;
}

export type ContextSourceKind =
  "recent-chat" | "git" | "project" | "attachment" | "plan";

export interface ContextContribution {
  readonly kind: ContextSourceKind;
  readonly content: string;
}

export interface ContextEnvelope {
  readonly contributions: readonly ContextContribution[];
}

export interface SuggestionRequest {
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: string;
  readonly revision: number;
  readonly snapshot: PromptSnapshot;
  readonly context: ContextEnvelope;
}

export interface SuggestionEdit extends ByteRange {
  readonly text: string;
}

export interface SuggestionCandidate {
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: string;
  readonly revision: number;
  readonly edit: SuggestionEdit;
  readonly tokenCount: number;
}

export type ClearReason =
  | "accepted"
  | "dismissed"
  | "edited"
  | "cursor-moved"
  | "selection-changed"
  | "submitted"
  | "stale"
  | "unsafe"
  | "completion-visible"
  | "layout-unknown"
  | "resized"
  | "session-changed"
  | "disabled"
  | "provider-error";

export interface Disposable {
  dispose(): void;
}

export interface SuggestionProvider {
  provide(
    request: SuggestionRequest,
    signal: AbortSignal,
  ): Promise<SuggestionCandidate | null>;
}

export interface SuggestionSurface {
  capabilities(): AdapterCapabilities;
  show(candidate: SuggestionCandidate): void;
  clear(reason: ClearReason): void;
  accept(candidate: SuggestionCandidate): void;
}

export interface ContextCollectionInput {
  readonly snapshot: PromptSnapshot;
  readonly remainingBytes: number;
  readonly trustedProject: boolean;
}

export interface ContextCollector {
  collect(
    input: ContextCollectionInput,
    signal: AbortSignal,
  ): Promise<ContextContribution | null>;
}

export type PtyDetectorName =
  | "alternate-screen"
  | "bracketed-paste"
  | "completion-ui"
  | "cursor-motion"
  | "hidden-input"
  | "output-mode"
  | "redraw";

export type PtyMarkerName =
  "prompt-start" | "prompt-end" | "hidden-input-start" | "hidden-input-end";

export interface PtyHostFingerprint {
  readonly executable: string;
  readonly version: string;
  readonly sha256: string;
}

export interface DowngradeMetadata {
  readonly code: string;
  readonly message: string;
}

export interface PtyProfileDescriptor {
  readonly protocolVersion: ProtocolVersion;
  readonly host: PtyHostFingerprint;
  readonly detectors: readonly PtyDetectorName[];
  readonly markers: readonly PtyMarkerName[];
  readonly capabilities: AdapterCapabilities;
  readonly downgrade?: DowngradeMetadata;
}

export type ValidationErrorCode =
  | "invalid-type"
  | "invalid-value"
  | "unknown-field"
  | "unsupported-version"
  | "size-limit"
  | "invalid-utf8"
  | "invalid-offset"
  | "unsafe-text"
  | "stale-result"
  | "invalid-json";

export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ValidationError };
