import { resolve } from "node:path";

import {
  probeClaude,
  type ClaudeCapabilityReport,
} from "@chat-suggestion/adapter-claude";
import {
  probeCodexCapabilities,
  type CodexCapabilityReport,
} from "@chat-suggestion/adapter-codex";
import {
  ContextAssembler,
  createCollectors,
  createDefaultContextPolicy,
  type ContextCollectionResult,
} from "@chat-suggestion/context";
import { SuggestionCoordinator } from "@chat-suggestion/engine";
import {
  PROTOCOL_VERSION,
  utf8ByteLength,
  type AdapterCapabilities,
  type PromptSnapshot,
  type SuggestionCandidate,
  type SuggestionSurface,
} from "@chat-suggestion/protocol";
import {
  FakeSuggestionProvider,
  type FakeSuggestionProviderOptions,
} from "@chat-suggestion/provider";

import type { AppConfiguration } from "./config.js";

export interface CapabilityStatus {
  readonly selectionOrder: readonly [
    "native",
    "protocol-owned-frontend",
    "exact-profile-pty",
    "unsupported",
  ];
  readonly pi: {
    readonly support: "runtime-handshake-required";
    readonly inlineRender: "none";
    readonly availableAfterHandshake: "eol-only";
    readonly downgradeReason: string;
  };
  readonly codex: CodexCapabilityReport;
  readonly claude: ClaudeCapabilityReport;
}

export interface DemoResult {
  readonly draft: string;
  readonly suggestion: string;
  readonly acceptedDraft: string;
  readonly submitted: false;
  readonly contextSources: number;
  readonly metrics: readonly {
    readonly name: string;
    readonly durationMs?: number;
    readonly bytes?: number;
  }[];
}

const DEMO_CAPABILITIES: AdapterCapabilities = {
  transport: "native",
  inlineRender: "eol-only",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: true,
  nativeCompletionAwareness: true,
  attachmentReferences: false,
};

export async function inspectCapabilities(): Promise<CapabilityStatus> {
  const [codex, claude] = await Promise.all([
    probeCodexCapabilities(),
    probeClaude(),
  ]);
  return {
    selectionOrder: [
      "native",
      "protocol-owned-frontend",
      "exact-profile-pty",
      "unsupported",
    ],
    pi: {
      support: "runtime-handshake-required",
      inlineRender: "none",
      availableAfterHandshake: "eol-only",
      downgradeReason:
        "status runs outside Pi and cannot verify TUI mode or custom-editor composition",
    },
    codex,
    claude,
  };
}

export async function previewConfiguredContext(
  configuration: AppConfiguration,
  cwd: string,
  trustedByFlag: boolean,
  draft = "preview draft",
): Promise<ContextCollectionResult> {
  const repositoryRoot = resolve(cwd);
  const trusted =
    trustedByFlag ||
    configuration.context.trustedProjects.includes(repositoryRoot);
  if (!trusted)
    throw new Error(
      "context preview requires --trust-project or an exact trustedProjects entry",
    );
  const snapshot = createSnapshot(draft, repositoryRoot, 1);
  const policy = {
    ...createDefaultContextPolicy(repositoryRoot),
    sourceByteLimits: configuration.context.sourceByteLimits,
    totalContextBytes: configuration.context.totalBytes,
    draftByteLimit: configuration.context.draftBytes,
    remoteEnabled: configuration.provider === "openai-compatible",
  };
  const enabled = new Set(configuration.context.enabledSources);
  const input = { snapshot, trustedProject: true };
  const collectors = createCollectors(input, policy).filter(({ kind }) =>
    enabled.has(kind),
  );
  return await new ContextAssembler(policy).collect(
    input,
    new AbortController().signal,
    collectors,
  );
}

export async function runFakeDemo(
  configuration: AppConfiguration,
  cwd: string,
  options: FakeSuggestionProviderOptions = {},
): Promise<DemoResult> {
  const draft = "fix the failing auth";
  const suffix = " tests and add a regression test";
  const surface = new DemoSurface();
  const metrics: { name: string; durationMs?: number; bytes?: number }[] = [];
  const assembler = new ContextAssembler({
    ...createDefaultContextPolicy(resolve(cwd)),
    sourceByteLimits: configuration.context.sourceByteLimits,
    totalContextBytes: configuration.context.totalBytes,
    draftByteLimit: configuration.context.draftBytes,
  });
  let contextSources = 0;
  const provider = new FakeSuggestionProvider({
    mappings: { [draft]: suffix },
    ...options,
  });
  const coordinator = new SuggestionCoordinator({
    provider,
    context: async (snapshot, signal) => {
      const input = { snapshot, trustedProject: true };
      const enabled = new Set(configuration.context.enabledSources);
      const result = await assembler.collect(
        input,
        signal,
        createCollectors(input, assembler.policy).filter(({ kind }) =>
          enabled.has(kind),
        ),
      );
      if (result.status !== "collected") return { contributions: [] };
      contextSources = result.envelope.contributions.length;
      return result.envelope;
    },
    surface,
    metrics: {
      record(metric) {
        metrics.push(metric);
      },
    },
    configuration: {
      debounceMs: configuration.debounceMs,
      requestTimeoutMs: configuration.requestTimeoutMs,
    },
  });
  const snapshot = createSnapshot(draft, resolve(cwd), 1);
  coordinator.update({
    snapshot,
    enabled: configuration.enabled,
    focused: true,
    hostIdle: true,
    imeComposing: false,
    nativeCompletionVisible: false,
    hiddenInput: false,
    layoutKnown: true,
  });
  coordinator.manualTrigger();
  await waitUntil(
    () => surface.visible !== undefined || coordinator.state().phase === "idle",
    configuration.requestTimeoutMs + 100,
  );
  if (!coordinator.acceptAll() || surface.accepted === undefined) {
    coordinator.dispose();
    throw new Error("fake demo did not produce an acceptable suggestion");
  }
  const acceptedDraft = draft + surface.accepted.edit.text;
  coordinator.dispose();
  return {
    draft,
    suggestion: surface.accepted.edit.text,
    acceptedDraft,
    submitted: false,
    contextSources,
    metrics,
  };
}

export function createSnapshot(
  text: string,
  workingDirectory: string,
  revision: number,
): PromptSnapshot {
  return {
    revision,
    text,
    cursorByte: utf8ByteLength(text),
    host: { name: "chat-suggest-demo", version: String(PROTOCOL_VERSION) },
    capabilities: DEMO_CAPABILITIES,
    workingDirectory,
    sessionId: "offline-demo",
  };
}

class DemoSurface implements SuggestionSurface {
  visible: SuggestionCandidate | undefined;
  accepted: SuggestionCandidate | undefined;
  capabilities(): AdapterCapabilities {
    return DEMO_CAPABILITIES;
  }
  show(candidate: SuggestionCandidate): void {
    this.visible = candidate;
  }
  clear(): void {
    this.visible = undefined;
  }
  accept(candidate: SuggestionCandidate): void {
    this.visible = undefined;
    this.accepted = candidate;
  }
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("operation timed out");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}
