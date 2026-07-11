import type {
  AdapterCapabilities,
  PtyProfileDescriptor,
} from "@chat-suggestion/protocol";

export type ClaudeCapabilityStatus =
  | "unavailable"
  | "present-unsupported"
  | "native-handshake-supported"
  | "pty-profile-supported"
  | "error";

export interface ClaudeNativeEditorEvidence {
  readonly semanticBufferRead: boolean;
  readonly cursorRead: boolean;
  readonly changeEvents: boolean;
  readonly styledDecoration: boolean;
  readonly nonSubmittingInsertion: boolean;
  readonly nativeCompletionAwareness: boolean;
  readonly disposal: boolean;
}

export interface ClaudeNativeEditorHandshake {
  negotiate(signal: AbortSignal): Promise<ClaudeNativeEditorEvidence>;
}

export interface ClaudeCapabilityReport {
  readonly status: ClaudeCapabilityStatus;
  readonly executable?: string;
  readonly version?: string;
  readonly fingerprint?: string;
  readonly capabilities: AdapterCapabilities;
  readonly lifecycleHooksAdvertised: boolean;
  readonly evidence: readonly string[];
  readonly downgradeReasons: readonly string[];
  readonly missingHandshakeDimensions: readonly (keyof ClaudeNativeEditorEvidence)[];
  readonly ptyProfile?: PtyProfileDescriptor;
}

export interface ClaudeProbeOptions {
  readonly executablePath?: string;
  readonly pathEnvironment?: string;
  readonly timeoutMs?: number;
  readonly nativeHandshakeTimeoutMs?: number;
  readonly maximumOutputBytes?: number;
  readonly nativeHandshake?: ClaudeNativeEditorHandshake;
  readonly testedPtyProfiles?: readonly PtyProfileDescriptor[];
}
