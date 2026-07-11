import { randomUUID } from "node:crypto";

import {
  PROTOCOL_VERSION,
  parsePromptSnapshot,
  parseSuggestionRequest,
  sanitizeSuggestionText,
  sha256Prefix,
  utf8ByteLength,
  validateCandidateForRequest,
  type AdapterCapabilities,
  type ClearReason,
  type PromptSnapshot,
  type SuggestionCandidate,
  type SuggestionRequest,
} from "@chat-suggestion/protocol";

import {
  isEligibleForSuggestion,
  isSafeForManualSuggestion,
} from "./eligibility.js";
import type {
  CoordinatorState,
  SuggestionConfiguration,
  SuggestionCoordinatorDependencies,
  SuggestionInput,
  SuggestionMetric,
  SuggestionScheduler,
  TimerHandle,
} from "./types.js";

const DEFAULT_CONFIGURATION: SuggestionConfiguration = {
  debounceMs: 200,
  requestTimeoutMs: 1_800,
  minimumPrefixCharacters: 3,
};

interface ActiveRequest {
  readonly requestId: string;
  readonly inputKey: string;
  readonly prefixHash: string;
  readonly snapshot: PromptSnapshot;
  readonly controller: AbortController;
  readonly startedAt: number;
  timeout: TimerHandle | undefined;
}

interface VisibleCandidate {
  readonly candidate: SuggestionCandidate;
  readonly inputKey: string;
  readonly prefixHash: string;
}

export class SuggestionCoordinator {
  readonly #dependencies: Required<
    Pick<SuggestionCoordinatorDependencies, "provider" | "context" | "surface">
  >;
  readonly #scheduler: SuggestionScheduler;
  readonly #requestId: () => string;
  readonly #metrics: SuggestionCoordinatorDependencies["metrics"];
  readonly #configuration: SuggestionConfiguration;

  #input: SuggestionInput | undefined;
  #inputKey: string | undefined;
  #debounce: TimerHandle | undefined;
  #active: ActiveRequest | undefined;
  #visible: VisibleCandidate | undefined;
  #dismissedCandidateKey: string | undefined;
  #state: CoordinatorState = { phase: "idle" };
  #disposed = false;

  constructor(dependencies: SuggestionCoordinatorDependencies) {
    this.#dependencies = dependencies;
    this.#scheduler = dependencies.scheduler ?? systemScheduler;
    this.#requestId = dependencies.requestId ?? randomUUID;
    this.#metrics = dependencies.metrics;
    this.#configuration = validateConfiguration(dependencies.configuration);
  }

  update(input: SuggestionInput): void {
    if (this.#disposed) return;

    const snapshotResult = parsePromptSnapshot(input.snapshot);
    if (!snapshotResult.ok) {
      this.#invalidate("unsafe");
      this.#input = undefined;
      this.#inputKey = undefined;
      return;
    }

    const nextInput = freezeInput(input, snapshotResult.value);
    const nextInputKey = createInputKey(nextInput.snapshot);
    const clearReason = reasonForUpdate(this.#input, nextInput);
    this.#invalidate(clearReason);

    if (nextInputKey !== this.#inputKey)
      this.#dismissedCandidateKey = undefined;
    this.#input = nextInput;
    this.#inputKey = nextInputKey;

    if (!isEligibleForSuggestion(nextInput, this.#configuration)) {
      this.#state = stateFor("idle", nextInput.snapshot);
      return;
    }

    this.#schedule(this.#configuration.debounceMs);
  }

  manualTrigger(): boolean {
    if (
      this.#disposed ||
      this.#input === undefined ||
      !isSafeForManualSuggestion(this.#input)
    ) {
      return false;
    }
    this.#invalidate("stale");
    this.#schedule(0);
    return true;
  }

  dismiss(reason: ClearReason = "dismissed"): boolean {
    if (this.#disposed) return false;
    const hadSuggestion = this.#visible !== undefined;
    if (this.#visible !== undefined) {
      this.#dismissedCandidateKey = candidateKey(
        this.#visible.inputKey,
        this.#visible.candidate.edit.text,
      );
    }
    this.#invalidate(reason);
    if (hadSuggestion) this.#record({ name: "suggestion-dismissed", count: 1 });
    return hadSuggestion;
  }

  acceptAll(): boolean {
    if (
      this.#disposed ||
      this.#visible === undefined ||
      this.#input === undefined
    ) {
      return false;
    }
    const visible = this.#visible;
    if (!this.#isCurrentVisible(visible)) {
      this.#invalidate("stale");
      return false;
    }

    this.#visible = undefined;
    this.#state = stateFor("idle", this.#input.snapshot);
    try {
      this.#dependencies.surface.accept(visible.candidate);
      this.#record({ name: "suggestion-accepted", count: 1 });
      return true;
    } catch {
      this.#safeClear("unsafe");
      this.#record({ name: "request-error", count: 1 });
      return false;
    }
  }

  state(): CoordinatorState {
    return Object.freeze({ ...this.#state });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#invalidate("disabled");
    this.#input = undefined;
    this.#inputKey = undefined;
    this.#disposed = true;
    this.#state = Object.freeze({ phase: "disposed" });
  }

  #schedule(delayMs: number): void {
    const input = this.#input;
    if (input === undefined) return;
    this.#state = stateFor("debouncing", input.snapshot);
    this.#debounce = this.#scheduler.setTimeout(() => {
      this.#debounce = undefined;
      void this.#beginRequest();
    }, delayMs);
    this.#record({ name: "request-scheduled", count: 1 });
  }

  async #beginRequest(): Promise<void> {
    const input = this.#input;
    const inputKey = this.#inputKey;
    if (input === undefined || inputKey === undefined || this.#disposed) return;

    const active: ActiveRequest = {
      requestId: this.#requestId(),
      inputKey,
      prefixHash: sha256Prefix(input.snapshot.text, 64),
      snapshot: input.snapshot,
      controller: new AbortController(),
      startedAt: this.#scheduler.now(),
      timeout: undefined,
    };
    this.#active = active;
    active.timeout = this.#scheduler.setTimeout(() => {
      this.#timeOut(active);
    }, this.#configuration.requestTimeoutMs);
    this.#state = stateFor("collecting", active.snapshot, active.requestId);
    this.#record({ name: "collection-started", count: 1 });

    try {
      const context = await this.#dependencies.context(
        active.snapshot,
        active.controller.signal,
      );
      if (!this.#isCurrent(active)) return;

      const request: SuggestionRequest = {
        protocolVersion: PROTOCOL_VERSION,
        requestId: active.requestId,
        revision: active.snapshot.revision,
        snapshot: active.snapshot,
        context,
      };
      if (!parseSuggestionRequest(request).ok) {
        this.#failCurrent(active);
        return;
      }

      this.#state = stateFor("generating", active.snapshot, active.requestId);
      this.#record({ name: "generation-started", count: 1 });
      const candidate = await this.#dependencies.provider.provide(
        request,
        active.controller.signal,
      );
      if (!this.#isCurrent(active)) {
        this.#record({ name: "stale-result", count: 1 });
        return;
      }
      if (candidate === null) {
        this.#finishCurrent(active);
        return;
      }
      this.#showIfCurrent(active, request, candidate);
    } catch {
      if (this.#isCurrent(active)) this.#failCurrent(active);
    }
  }

  #showIfCurrent(
    active: ActiveRequest,
    request: SuggestionRequest,
    candidate: SuggestionCandidate,
  ): void {
    const sanitizedText = sanitizeSuggestionText(candidate.edit.text);
    if (sanitizedText.length === 0) {
      this.#finishCurrent(active);
      return;
    }
    const sanitizedCandidate: SuggestionCandidate = {
      ...candidate,
      edit: { ...candidate.edit, text: sanitizedText },
    };
    if (!validateCandidateForRequest(sanitizedCandidate, request).ok) {
      this.#finishCurrent(active);
      return;
    }
    const key = candidateKey(active.inputKey, sanitizedText);
    if (key === this.#dismissedCandidateKey || !this.#isCurrent(active)) {
      this.#finishCurrent(active);
      return;
    }
    if (
      !sameCapabilities(
        this.#dependencies.surface.capabilities(),
        active.snapshot.capabilities,
      )
    ) {
      this.#finishCurrent(active, "unsafe");
      return;
    }

    this.#clearActiveTimer(active);
    this.#active = undefined;
    this.#visible = {
      candidate: sanitizedCandidate,
      inputKey: active.inputKey,
      prefixHash: active.prefixHash,
    };
    try {
      this.#dependencies.surface.show(sanitizedCandidate);
      this.#state = stateFor("visible", active.snapshot, active.requestId);
      this.#record({
        name: "suggestion-visible",
        durationMs: this.#scheduler.now() - active.startedAt,
        bytes: utf8ByteLength(sanitizedText),
      });
    } catch {
      this.#visible = undefined;
      this.#state = stateFor("idle", active.snapshot);
      this.#safeClear("unsafe");
      this.#record({ name: "request-error", count: 1 });
    }
  }

  #timeOut(active: ActiveRequest): void {
    if (!this.#isCurrent(active)) return;
    active.controller.abort();
    this.#active = undefined;
    this.#state = stateFor("idle", active.snapshot);
    this.#record({ name: "request-timeout", count: 1 });
  }

  #failCurrent(active: ActiveRequest): void {
    this.#finishCurrent(active, "provider-error");
    this.#record({ name: "request-error", count: 1 });
  }

  #finishCurrent(active: ActiveRequest, clearReason?: ClearReason): void {
    if (!this.#isCurrent(active)) return;
    this.#clearActiveTimer(active);
    this.#active = undefined;
    this.#state = stateFor("idle", active.snapshot);
    if (clearReason !== undefined) this.#safeClear(clearReason);
  }

  #invalidate(reason: ClearReason): void {
    if (this.#debounce !== undefined) {
      this.#scheduler.clearTimeout(this.#debounce);
      this.#debounce = undefined;
    }
    if (this.#active !== undefined) {
      this.#active.controller.abort();
      this.#clearActiveTimer(this.#active);
      this.#active = undefined;
    }
    if (this.#visible !== undefined) {
      this.#visible = undefined;
      this.#safeClear(reason);
    }
    if (!this.#disposed) this.#state = stateFor("idle", this.#input?.snapshot);
  }

  #isCurrent(active: ActiveRequest): boolean {
    return (
      !this.#disposed &&
      this.#active === active &&
      !active.controller.signal.aborted &&
      this.#inputKey === active.inputKey &&
      this.#input !== undefined &&
      this.#input.snapshot.revision === active.snapshot.revision &&
      this.#input.snapshot.cursorByte === active.snapshot.cursorByte &&
      this.#input.snapshot.sessionId === active.snapshot.sessionId &&
      sha256Prefix(this.#input.snapshot.text, 64) === active.prefixHash
    );
  }

  #isCurrentVisible(visible: VisibleCandidate): boolean {
    try {
      return (
        this.#inputKey === visible.inputKey &&
        this.#input !== undefined &&
        sha256Prefix(this.#input.snapshot.text, 64) === visible.prefixHash &&
        isSafeForManualSuggestion(this.#input) &&
        sameCapabilities(
          this.#dependencies.surface.capabilities(),
          this.#input.snapshot.capabilities,
        )
      );
    } catch {
      return false;
    }
  }

  #clearActiveTimer(active: ActiveRequest): void {
    if (active.timeout !== undefined) {
      this.#scheduler.clearTimeout(active.timeout);
      active.timeout = undefined;
    }
  }

  #safeClear(reason: ClearReason): void {
    try {
      this.#dependencies.surface.clear(reason);
    } catch {
      this.#record({ name: "request-error", count: 1 });
    }
  }

  #record(metric: SuggestionMetric): void {
    try {
      this.#metrics?.record(Object.freeze({ ...metric }));
    } catch {
      // Metrics are observational and cannot affect editor behavior.
    }
  }
}

const systemScheduler: SuggestionScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function validateConfiguration(
  configuration: Partial<SuggestionConfiguration> | undefined,
): SuggestionConfiguration {
  const merged = { ...DEFAULT_CONFIGURATION, ...configuration };
  if (
    !Number.isFinite(merged.debounceMs) ||
    merged.debounceMs < 100 ||
    merged.debounceMs > 1_000
  ) {
    throw new RangeError(
      "debounceMs must be between 100 and 1000 milliseconds",
    );
  }
  if (
    !Number.isFinite(merged.requestTimeoutMs) ||
    merged.requestTimeoutMs <= 0
  ) {
    throw new RangeError("requestTimeoutMs must be a positive finite number");
  }
  if (
    !Number.isSafeInteger(merged.minimumPrefixCharacters) ||
    merged.minimumPrefixCharacters < 0
  ) {
    throw new RangeError(
      "minimumPrefixCharacters must be a non-negative integer",
    );
  }
  return Object.freeze(merged);
}

function freezeInput(
  input: SuggestionInput,
  snapshot: PromptSnapshot,
): SuggestionInput {
  const frozenSnapshot = Object.freeze({
    ...snapshot,
    host: Object.freeze({ ...snapshot.host }),
    capabilities: Object.freeze({ ...snapshot.capabilities }),
    ...(snapshot.selection === undefined
      ? {}
      : { selection: Object.freeze({ ...snapshot.selection }) }),
  });
  return Object.freeze({ ...input, snapshot: frozenSnapshot });
}

function createInputKey(snapshot: PromptSnapshot): string {
  const capabilities = snapshot.capabilities;
  return JSON.stringify([
    snapshot.revision,
    snapshot.text,
    snapshot.cursorByte,
    snapshot.selection?.startByte,
    snapshot.selection?.endByte,
    snapshot.host.name,
    snapshot.host.version,
    capabilities.transport,
    capabilities.inlineRender,
    capabilities.bufferRead,
    capabilities.cursorRead,
    capabilities.atomicAcceptance,
    capabilities.cancellation,
    capabilities.resizeAwareness,
    capabilities.alternateScreenSafety,
    capabilities.nativeCompletionAwareness,
    capabilities.attachmentReferences,
    snapshot.workingDirectory,
    snapshot.sessionId,
  ]);
}

function candidateKey(inputKey: string, text: string): string {
  return sha256Prefix(`${inputKey}\u0000${text}`, 64);
}

function sameCapabilities(
  left: AdapterCapabilities,
  right: AdapterCapabilities,
): boolean {
  return (
    left.transport === right.transport &&
    left.inlineRender === right.inlineRender &&
    left.bufferRead === right.bufferRead &&
    left.cursorRead === right.cursorRead &&
    left.atomicAcceptance === right.atomicAcceptance &&
    left.cancellation === right.cancellation &&
    left.resizeAwareness === right.resizeAwareness &&
    left.alternateScreenSafety === right.alternateScreenSafety &&
    left.nativeCompletionAwareness === right.nativeCompletionAwareness &&
    left.attachmentReferences === right.attachmentReferences
  );
}

function stateFor(
  phase: CoordinatorState["phase"],
  snapshot?: PromptSnapshot,
  requestId?: string,
): CoordinatorState {
  return Object.freeze({
    phase,
    ...(snapshot === undefined ? {} : { revision: snapshot.revision }),
    ...(requestId === undefined ? {} : { requestId }),
  });
}

function reasonForUpdate(
  previous: SuggestionInput | undefined,
  next: SuggestionInput,
): ClearReason {
  if (previous === undefined) return "edited";
  if (previous.snapshot.sessionId !== next.snapshot.sessionId)
    return "session-changed";
  if (previous.snapshot.cursorByte !== next.snapshot.cursorByte)
    return "cursor-moved";
  if (
    previous.snapshot.selection?.startByte !==
      next.snapshot.selection?.startByte ||
    previous.snapshot.selection?.endByte !== next.snapshot.selection?.endByte
  ) {
    return "selection-changed";
  }
  if (next.nativeCompletionVisible) return "completion-visible";
  if (!next.layoutKnown) return "layout-unknown";
  if (!next.enabled) return "disabled";
  return "edited";
}
