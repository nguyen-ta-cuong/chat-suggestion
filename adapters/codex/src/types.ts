import type {
  AdapterCapabilities,
  PtyProfileDescriptor,
} from "@chat-suggestion/protocol";

export type CodexExecutableSource = "explicit" | "path" | "bundle";

export interface CodexResolutionOptions {
  readonly explicitPath?: string;
  readonly pathEnvironment?: string;
  readonly bundlePaths?: readonly string[];
}

export type CodexResolution =
  | {
      readonly available: true;
      readonly executable: string;
      readonly source: CodexExecutableSource;
    }
  | {
      readonly available: false;
      readonly reason: string;
    };

export interface CodexProbeEvidence {
  readonly rootHelp: boolean;
  readonly appServerAdvertised: boolean;
  readonly appServerHelp: boolean;
  readonly schemaGenerationAdvertised: boolean;
  readonly initializeSchemaCompatible: boolean;
  readonly appServerInitialized: boolean;
  readonly unknownMethodRejected: boolean;
  readonly malformedRequestRejected: boolean;
}

export interface CodexCustomFrontendCapability {
  readonly available: boolean;
  readonly capabilities: AdapterCapabilities;
  readonly reason: string;
}

export interface CodexCapabilityReport {
  readonly available: boolean;
  readonly commandName: "codex";
  readonly executable?: string;
  readonly executableSource?: CodexExecutableSource;
  readonly version?: string;
  readonly evidence: CodexProbeEvidence;
  readonly stockTui: AdapterCapabilities;
  readonly customFrontend: CodexCustomFrontendCapability;
  readonly selection: "custom-frontend" | "pty" | "unsupported";
  readonly ptyProfile?: PtyProfileDescriptor;
  readonly downgradeReasons: readonly string[];
}

export interface CodexProbeOptions {
  readonly resolution?: CodexResolutionOptions;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly expectedAppServerVersion?: string;
  readonly ptyProfile?: PtyProfileDescriptor;
  readonly cache?: CodexProbeCacheLike;
}

export interface CodexProbeCacheLike {
  get(key: string): CodexCapabilityReport | undefined;
  set(key: string, report: CodexCapabilityReport): void;
}

export interface CodexAppServerHandshakeResult {
  readonly initialized: boolean;
  readonly unknownMethodRejected: boolean;
  readonly malformedRequestRejected: boolean;
  readonly reason?: string;
}
