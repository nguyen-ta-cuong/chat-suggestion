import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  ContextAssembler,
  createCollectors,
  createDefaultContextPolicy,
  type ContextAssemblyInput,
  type ContextCollectionResult,
  type ContextPolicy,
} from "@chat-suggestion/context";
import { SuggestionCoordinator } from "@chat-suggestion/engine";
import {
  PROTOCOL_VERSION,
  utf8ByteLength,
  type AdapterCapabilities,
  type ClearReason,
  type ContextEnvelope,
  type PromptSnapshot,
  type SuggestionCandidate,
  type SuggestionProvider,
  type SuggestionRequest,
  type SuggestionSurface,
} from "@chat-suggestion/protocol";
import {
  FakeSuggestionProvider,
  OpenAICompatibleSuggestionProvider,
} from "@chat-suggestion/provider";

import type { ChatSuggestConfiguration } from "./config.js";

export interface SuggestionService {
  suggest(
    snapshot: PromptSnapshot,
    requestId: string,
    signal: AbortSignal,
  ): Promise<SuggestionCandidate | null>;
  collect(
    input: ContextAssemblyInput,
    signal: AbortSignal,
  ): Promise<ContextCollectionResult>;
}

export interface DemoResult {
  readonly initialDraft: string;
  readonly suggestion: string;
  readonly finalDraft: string;
  readonly acceptedCount: number;
  readonly submitted: false;
  readonly phases: readonly string[];
}

export function createSuggestionService(
  configuration: ChatSuggestConfiguration,
  provider: SuggestionProvider = createConfiguredProvider(configuration),
): SuggestionService {
  const collect = async (
    input: ContextAssemblyInput,
    signal: AbortSignal,
  ): Promise<ContextCollectionResult> => {
    const policy = contextPolicy(
      configuration,
      input.snapshot.workingDirectory,
    );
    const assembler = new ContextAssembler(policy);
    const collectors = createCollectors(input, policy).filter(
      (collector) => configuration.context.enabledSources[collector.kind],
    );
    return await assembler.collect(input, signal, collectors);
  };
  return {
    collect,
    async suggest(snapshot, requestId, signal) {
      const trustedProject = isTrustedProject(
        snapshot.workingDirectory,
        configuration,
      );
      const result = await collect({ snapshot, trustedProject }, signal);
      const context: ContextEnvelope =
        result.status === "collected" ? result.envelope : { contributions: [] };
      const request: SuggestionRequest = {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        revision: snapshot.revision,
        snapshot,
        context,
      };
      return await provider.provide(request, signal);
    },
  };
}

export async function previewProjectContext(
  configuration: ChatSuggestConfiguration,
  cwd: string,
  explicitlyTrusted: boolean,
  signal: AbortSignal = new AbortController().signal,
): Promise<ContextCollectionResult> {
  const workingDirectory = resolve(cwd);
  const trustedProject =
    explicitlyTrusted || isTrustedProject(workingDirectory, configuration);
  if (!trustedProject) {
    throw new Error(
      "project context is disabled until the project is trusted; pass --trust-project for this preview",
    );
  }
  const snapshot = createSnapshot("", workingDirectory, 1);
  return await createSuggestionService(
    configuration,
    new FakeSuggestionProvider(),
  ).collect({ snapshot, trustedProject }, signal);
}

export async function runFakeDemo(
  configuration: ChatSuggestConfiguration,
): Promise<DemoResult> {
  const initialDraft = "fix the failing auth";
  const suffix = " tests and add a regression test";
  const provider = new FakeSuggestionProvider({
    mappings: { [initialDraft]: suffix },
  });
  const service = createSuggestionService(configuration, provider);
  const capabilities = demoCapabilities();
  let finalDraft = initialDraft;
  let acceptedCount = 0;
  const phases: string[] = [];
  let resolveVisible: (candidate: SuggestionCandidate) => void = () =>
    undefined;
  const visible = new Promise<SuggestionCandidate>((resolveCandidate) => {
    resolveVisible = resolveCandidate;
  });
  const surface: SuggestionSurface = {
    capabilities: () => capabilities,
    show(candidate) {
      phases.push("visible");
      resolveVisible(candidate);
    },
    clear(reason: ClearReason) {
      phases.push(`cleared:${reason}`);
    },
    accept(candidate) {
      finalDraft += candidate.edit.text;
      acceptedCount += 1;
      phases.push("accepted");
    },
  };
  const coordinator = new SuggestionCoordinator({
    provider,
    context: async (snapshot, signal) => {
      phases.push("collecting");
      const result = await service.collect(
        { snapshot, trustedProject: false },
        signal,
      );
      phases.push("generating");
      return result.status === "collected"
        ? result.envelope
        : { contributions: [] };
    },
    surface,
    configuration: {
      debounceMs: configuration.debounceMs,
      requestTimeoutMs: configuration.requestTimeoutMs,
      minimumPrefixCharacters: configuration.minimumPrefixCharacters,
    },
    requestId: () => "offline-demo-1",
  });
  const snapshot = createSnapshot(initialDraft, process.cwd(), 1, capabilities);
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
  const candidate = await withTimeout(visible, configuration.requestTimeoutMs);
  if (!coordinator.acceptAll() || coordinator.acceptAll()) {
    coordinator.dispose();
    throw new Error("offline demo acceptance invariant failed");
  }
  coordinator.dispose();
  return {
    initialDraft,
    suggestion: candidate.edit.text,
    finalDraft,
    acceptedCount,
    submitted: false,
    phases,
  };
}

export function createConfiguredProvider(
  configuration: ChatSuggestConfiguration,
): SuggestionProvider {
  if (configuration.provider.kind === "fake") {
    return new FakeSuggestionProvider();
  }
  return new OpenAICompatibleSuggestionProvider(configuration.provider);
}

export function isTrustedProject(
  cwd: string,
  configuration: ChatSuggestConfiguration,
): boolean {
  const project = resolve(cwd);
  return configuration.trustedProjects.some(
    (trusted) => resolve(trusted) === project,
  );
}

export function resolvePiPackagePath(): string {
  const entry = import.meta.resolve("@chat-suggestion/adapter-pi");
  return fileURLToPath(new URL("../", entry));
}

function contextPolicy(
  configuration: ChatSuggestConfiguration,
  repositoryRoot: string,
): ContextPolicy {
  const defaults = createDefaultContextPolicy(repositoryRoot);
  return {
    ...defaults,
    repositoryRoot,
    remoteEnabled: configuration.provider.kind === "openai-compatible",
    sourceByteLimits: configuration.context.sourceByteLimits,
    totalContextBytes: configuration.context.totalBytes,
    draftByteLimit: configuration.context.draftBytes,
    collectorTimeoutMs: configuration.context.collectorTimeoutMs,
  };
}

function createSnapshot(
  text: string,
  workingDirectory: string,
  revision: number,
  capabilities: AdapterCapabilities = demoCapabilities(),
): PromptSnapshot {
  return {
    revision,
    text,
    cursorByte: utf8ByteLength(text),
    host: { name: "chat-suggest-demo", version: "0.1.0" },
    capabilities,
    workingDirectory,
    sessionId: "offline-demo",
  };
}

function demoCapabilities(): AdapterCapabilities {
  return Object.freeze({
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
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("offline demo timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
