import { performance } from "node:perf_hooks";

import {
  FAKE_CAPABILITIES,
  PROTOCOL_VERSION,
  utf8ByteLength,
  type AdapterCapabilities,
  type ClearReason,
  type ContextEnvelope,
  type PromptSnapshot,
  type SuggestionCandidate,
  type SuggestionProvider,
} from "@chat-suggestion/protocol";
import { describe, expect, it } from "vitest";

import {
  SuggestionCoordinator,
  isEligibleForSuggestion,
  type SuggestionInput,
  type SuggestionMetric,
  type SuggestionScheduler,
  type TimerHandle,
} from "../src/index.js";

const EMPTY_CONTEXT: ContextEnvelope = { contributions: [] };

describe("SuggestionCoordinator", () => {
  it("debounces ten edits into one request for the final immutable revision", async () => {
    const harness = createHarness();

    for (let revision = 1; revision <= 10; revision += 1) {
      harness.coordinator.update(createInput(revision, `draft ${revision}`));
    }

    expect(harness.scheduler.pendingCount()).toBe(1);
    harness.scheduler.advanceBy(199);
    expect(harness.requests).toHaveLength(0);
    harness.scheduler.advanceBy(1);
    await flushPromises();

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.revision).toBe(10);
    expect(harness.surface.shown).toHaveLength(1);
    expect(harness.coordinator.state()).toMatchObject({
      phase: "visible",
      revision: 10,
    });
  });

  it("rejects a provider result that arrives after edit cancellation", async () => {
    const delayed = deferred<SuggestionCandidate | null>();
    const harness = createHarness({ providerResult: delayed.promise });
    harness.coordinator.update(createInput(1, "first draft"));
    harness.scheduler.advanceBy(200);
    await flushPromises();
    expect(harness.requests).toHaveLength(1);

    harness.coordinator.update(createInput(2, "second draft"));
    expect(harness.signals[0]?.aborted).toBe(true);
    delayed.resolve(candidateFor(harness.requests[0]!, " ignored late"));
    await flushPromises();

    expect(harness.surface.shown).toHaveLength(0);
    expect(harness.coordinator.state()).toMatchObject({
      phase: "debouncing",
      revision: 2,
    });
  });

  it("keeps the newer result when abort-ignoring providers resolve out of order", async () => {
    const first = deferred<SuggestionCandidate | null>();
    const second = deferred<SuggestionCandidate | null>();
    const scheduler = new FakeScheduler();
    const surface = new FakeSurface();
    const requests: SuggestionRequestLike[] = [];
    const provider: SuggestionProvider = {
      provide: (request) => {
        requests.push(request);
        return requests.length === 1 ? first.promise : second.promise;
      },
    };
    const coordinator = new SuggestionCoordinator({
      provider,
      context: async () => EMPTY_CONTEXT,
      surface,
      scheduler,
      requestId: (() => {
        let sequence = 0;
        return () => `out-of-order-${++sequence}`;
      })(),
    });

    coordinator.update(createInput(1, "older draft"));
    scheduler.advanceBy(200);
    await flushPromises();
    coordinator.update(createInput(2, "newer draft"));
    scheduler.advanceBy(200);
    await flushPromises();

    second.resolve(candidateFor(requests[1]!, " newer result"));
    await flushPromises();
    first.resolve(candidateFor(requests[0]!, " older result"));
    await flushPromises();

    expect(surface.shown.map((candidate) => candidate.edit.text)).toEqual([
      " newer result",
    ]);
    expect(coordinator.state()).toMatchObject({
      phase: "visible",
      revision: 2,
    });
  });

  it.each([
    [
      "cursor",
      (input: SuggestionInput) =>
        createInput(1, input.snapshot.text, {
          snapshot: { cursorByte: 1 },
        }),
    ],
    [
      "session",
      (input: SuggestionInput) =>
        createInput(1, input.snapshot.text, {
          snapshot: { sessionId: "other-session" },
        }),
    ],
  ])("invalidates when only %s changes", async (_name, changeInput) => {
    const delayed = deferred<SuggestionCandidate | null>();
    const harness = createHarness({ providerResult: delayed.promise });
    const original = createInput(1, "stable draft");
    harness.coordinator.update(original);
    harness.scheduler.advanceBy(200);
    await flushPromises();

    harness.coordinator.update(changeInput(original));
    delayed.resolve(candidateFor(harness.requests[0]!, " stale"));
    await flushPromises();

    expect(harness.surface.shown).toHaveLength(0);
    expect(harness.signals[0]?.aborted).toBe(true);
  });

  it("dismisses visible decoration without accepting or modifying text", async () => {
    const harness = createHarness();
    harness.coordinator.update(createInput(1, "keep this draft"));
    harness.scheduler.advanceBy(200);
    await flushPromises();

    expect(harness.coordinator.dismiss()).toBe(true);
    expect(harness.surface.cleared).toEqual(["dismissed"]);
    expect(harness.surface.accepted).toHaveLength(0);
    expect(harness.requests[0]?.snapshot.text).toBe("keep this draft");
    expect(harness.coordinator.dismiss()).toBe(false);
  });

  it("accepts a current candidate exactly once", async () => {
    const harness = createHarness();
    harness.coordinator.update(createInput(1, "accept this"));
    harness.scheduler.advanceBy(200);
    await flushPromises();

    expect(harness.coordinator.acceptAll()).toBe(true);
    expect(harness.coordinator.acceptAll()).toBe(false);
    expect(harness.surface.accepted).toHaveLength(1);
    expect(harness.coordinator.state().phase).toBe("idle");
  });

  it("leaves native completion and Tab behavior unconsumed", () => {
    const harness = createHarness();
    const input = createInput(1, "native completion", {
      nativeCompletionVisible: true,
    });

    harness.coordinator.update(input);

    expect(isEligibleForSuggestion(input, { minimumPrefixCharacters: 3 })).toBe(
      false,
    );
    expect(harness.scheduler.pendingCount()).toBe(0);
    expect(harness.coordinator.acceptAll()).toBe(false);
  });

  it("aborts collection and removes every timer on dispose", async () => {
    const context = deferred<ContextEnvelope>();
    const harness = createHarness({ contextResult: context.promise });
    harness.coordinator.update(createInput(1, "dispose pending"));
    harness.scheduler.advanceBy(200);
    await flushPromises();

    expect(harness.scheduler.pendingCount()).toBe(1);
    harness.coordinator.dispose();

    expect(harness.signals[0]?.aborted).toBe(true);
    expect(harness.scheduler.pendingCount()).toBe(0);
    expect(harness.coordinator.state()).toEqual({ phase: "disposed" });
  });

  it.each(["collector", "provider"])(
    "returns to idle after a %s error without recording content",
    async (failurePoint) => {
      const secret = "raw-private-draft-DO-NOT-LOG";
      const harness = createHarness({
        contextResult:
          failurePoint === "collector"
            ? Promise.reject(new Error(secret))
            : EMPTY_CONTEXT,
        ...(failurePoint === "provider"
          ? { providerResult: Promise.reject(new Error(secret)) }
          : {}),
      });
      harness.coordinator.update(createInput(1, secret));
      harness.scheduler.advanceBy(200);
      await flushPromises();

      expect(harness.coordinator.state().phase).toBe("idle");
      expect(JSON.stringify(harness.metrics)).not.toContain(secret);
      expect(harness.metrics).toContainEqual({
        name: "request-error",
        count: 1,
      });
    },
  );

  it("times out collection, aborts it, and ignores its later completion", async () => {
    const context = deferred<ContextEnvelope>();
    const harness = createHarness({ contextResult: context.promise });
    harness.coordinator.update(createInput(1, "timeout draft"));
    harness.scheduler.advanceBy(200);
    await flushPromises();

    harness.scheduler.advanceBy(1_800);
    expect(harness.signals[0]?.aborted).toBe(true);
    expect(harness.coordinator.state().phase).toBe("idle");
    context.resolve(EMPTY_CONTEXT);
    await flushPromises();
    expect(harness.requests).toHaveLength(0);
    expect(harness.scheduler.pendingCount()).toBe(0);
  });

  it("uses UTF-8 cursor offsets and strips terminal controls before rendering", async () => {
    const text = "fix 👩🏽‍💻 e\u0301 漢字";
    const harness = createHarness({ suffix: "\u001b[31m safe 漢字\u001b[0m" });
    harness.coordinator.update(createInput(1, text));
    harness.scheduler.advanceBy(200);
    await flushPromises();

    expect(harness.requests[0]?.snapshot.cursorByte).toBe(utf8ByteLength(text));
    expect(harness.surface.shown[0]?.edit).toEqual({
      startByte: utf8ByteLength(text),
      endByte: utf8ByteLength(text),
      text: " safe 漢字",
    });
  });

  it("rejects replacement edits and empty sanitized candidates", async () => {
    const requests: SuggestionRequestLike[] = [];
    const scheduler = new FakeScheduler();
    const surface = new FakeSurface();
    const provider: SuggestionProvider = {
      provide: async (request) => {
        requests.push(request);
        return {
          ...candidateFor(request, "\u001b]0;unsafe\u0007"),
          edit: {
            startByte: 0,
            endByte: request.snapshot.cursorByte,
            text: "bad",
          },
        };
      },
    };
    const coordinator = new SuggestionCoordinator({
      provider,
      context: async () => EMPTY_CONTEXT,
      surface,
      scheduler,
      requestId: () => "request-invalid",
    });
    coordinator.update(createInput(1, "do not replace"));
    scheduler.advanceBy(200);
    await flushPromises();

    expect(surface.shown).toHaveLength(0);
    expect(coordinator.state().phase).toBe("idle");
  });

  it("suppresses a dismissed duplicate for the unchanged snapshot", async () => {
    const harness = createHarness();
    harness.coordinator.update(createInput(1, "same snapshot"));
    harness.scheduler.advanceBy(200);
    await flushPromises();
    expect(harness.coordinator.dismiss()).toBe(true);

    expect(harness.coordinator.manualTrigger()).toBe(true);
    harness.scheduler.advanceBy(0);
    await flushPromises();

    expect(harness.requests).toHaveLength(2);
    expect(harness.surface.shown).toHaveLength(1);
    expect(harness.coordinator.state().phase).toBe("idle");
  });

  it("rejects unsafe readiness states and non-end cursors", () => {
    const base = createInput(1, "meaningful");
    const unsafeInputs: InputOverride[] = [
      { focused: false },
      { hostIdle: false },
      { imeComposing: true },
      { hiddenInput: true },
      { layoutKnown: false },
      { enabled: false },
      { snapshot: { cursorByte: 0 } },
      { snapshot: { selection: { startByte: 0, endByte: 1 } } },
    ];

    for (const override of unsafeInputs) {
      expect(
        isEligibleForSuggestion(overrideInput(base, override), {
          minimumPrefixCharacters: 3,
        }),
      ).toBe(false);
    }
  });

  it("keeps synchronous update p95 below 5 ms in a deterministic loop", () => {
    const harness = createHarness();
    const durations: number[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      const startedAt = performance.now();
      harness.coordinator.update(
        createInput(index, `benchmark draft ${index}`),
      );
      durations.push(performance.now() - startedAt);
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;

    expect(p95).toBeLessThan(5);
    expect(harness.scheduler.pendingCount()).toBe(1);
  });
});

interface HarnessOptions {
  readonly contextResult?: ContextEnvelope | Promise<ContextEnvelope>;
  readonly providerResult?:
    Promise<SuggestionCandidate | null> | SuggestionCandidate | null;
  readonly suffix?: string;
}

type SuggestionRequestLike = Parameters<SuggestionProvider["provide"]>[0];

function createHarness(options: HarnessOptions = {}) {
  const scheduler = new FakeScheduler();
  const surface = new FakeSurface();
  const requests: SuggestionRequestLike[] = [];
  const signals: AbortSignal[] = [];
  const metrics: SuggestionMetric[] = [];
  let requestSequence = 0;
  const provider: SuggestionProvider = {
    provide: async (request, signal) => {
      requests.push(request);
      signals.push(signal);
      if (options.providerResult !== undefined) return options.providerResult;
      return candidateFor(request, options.suffix ?? " suggestion");
    },
  };
  const coordinator = new SuggestionCoordinator({
    provider,
    context: async (_snapshot, signal) => {
      signals.push(signal);
      return options.contextResult ?? EMPTY_CONTEXT;
    },
    surface,
    scheduler,
    requestId: () => `request-${++requestSequence}`,
    metrics: { record: (metric) => metrics.push(metric) },
  });
  return { coordinator, scheduler, surface, requests, signals, metrics };
}

function createInput(
  revision: number,
  text: string,
  override: InputOverride = {},
): SuggestionInput {
  const { snapshot: snapshotOverride, ...inputOverride } = override;
  const snapshot: PromptSnapshot = {
    revision,
    text,
    cursorByte: utf8ByteLength(text),
    host: { name: "test-host", version: "1.0.0" },
    capabilities: { ...FAKE_CAPABILITIES },
    workingDirectory: ".",
    sessionId: "test-session",
    ...snapshotOverride,
  };
  return {
    enabled: true,
    focused: true,
    hostIdle: true,
    imeComposing: false,
    nativeCompletionVisible: false,
    hiddenInput: false,
    layoutKnown: true,
    ...inputOverride,
    snapshot,
  };
}

function overrideInput(
  input: SuggestionInput,
  override: InputOverride,
): SuggestionInput {
  return {
    ...input,
    ...override,
    snapshot: { ...input.snapshot, ...override.snapshot },
  };
}

type InputOverride = Omit<Partial<SuggestionInput>, "snapshot"> & {
  readonly snapshot?: Partial<PromptSnapshot>;
};

function candidateFor(
  request: SuggestionRequestLike,
  text: string,
): SuggestionCandidate {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    revision: request.revision,
    edit: {
      startByte: request.snapshot.cursorByte,
      endByte: request.snapshot.cursorByte,
      text,
    },
    tokenCount: 1,
  };
}

class FakeSurface {
  readonly shown: SuggestionCandidate[] = [];
  readonly cleared: ClearReason[] = [];
  readonly accepted: SuggestionCandidate[] = [];
  currentCapabilities: AdapterCapabilities = { ...FAKE_CAPABILITIES };

  capabilities(): AdapterCapabilities {
    return this.currentCapabilities;
  }

  show(candidate: SuggestionCandidate): void {
    this.shown.push(candidate);
  }

  clear(reason: ClearReason): void {
    this.cleared.push(reason);
  }

  accept(candidate: SuggestionCandidate): void {
    this.accepted.push(candidate);
  }
}

class FakeScheduler implements SuggestionScheduler {
  #now = 0;
  #sequence = 0;
  readonly #tasks = new Map<
    number,
    { readonly at: number; readonly callback: () => void }
  >();

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = ++this.#sequence;
    this.#tasks.set(id, { at: this.#now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.#tasks.delete(handle as number);
  }

  advanceBy(durationMs: number): void {
    const target = this.#now + durationMs;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort(
          ([leftId, left], [rightId, right]) =>
            left.at - right.at || leftId - rightId,
        )[0];
      if (next === undefined) break;
      const [id, task] = next;
      this.#tasks.delete(id);
      this.#now = task.at;
      task.callback();
    }
    this.#now = target;
  }

  pendingCount(): number {
    return this.#tasks.size;
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
