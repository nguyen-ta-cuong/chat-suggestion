import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAKE_CAPABILITIES } from "@chat-suggestion/protocol";
import { expect, it } from "vitest";

import {
  ContextAssembler,
  createDefaultContextPolicy,
  type ContextCollector,
} from "../src/index.js";

it("records cold and warm p95 for a 10,000-name project fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-context-benchmark-"));
  try {
    const names = Array.from(
      { length: 10_000 },
      (_, index) => `src/module-${index.toString().padStart(5, "0")}.ts`,
    ).join("\n");
    let collectionCount = 0;
    const projectCollector: ContextCollector = {
      sourceId: "project-10k",
      kind: "project",
      collect: () => {
        collectionCount += 1;
        return Promise.resolve({
          sourceId: "project-10k",
          kind: "project",
          content: names,
          originalBytes: Buffer.byteLength(names),
          redactionRuleIds: [],
          redactionCount: 0,
          durationMs: 0,
        });
      },
    };
    const assembler = new ContextAssembler(createDefaultContextPolicy(root));
    const input = {
      snapshot: {
        revision: 1,
        text: "benchmark",
        cursorByte: 9,
        host: { name: "fixture", version: "1" },
        capabilities: FAKE_CAPABILITIES,
        workingDirectory: root,
        sessionId: "benchmark",
      },
      trustedProject: true,
    };
    const coldStart = performance.now();
    await assembler.collect(input, new AbortController().signal, [
      projectCollector,
    ]);
    const coldMs = performance.now() - coldStart;
    const warmSamples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      await assembler.collect(input, new AbortController().signal, [
        projectCollector,
      ]);
      warmSamples.push(performance.now() - startedAt);
    }
    warmSamples.sort((left, right) => left - right);
    const warmP95Ms =
      warmSamples[Math.ceil(warmSamples.length * 0.95) - 1] ?? 0;

    expect(collectionCount).toBe(1);
    expect(coldMs).toBeGreaterThanOrEqual(0);
    expect(warmP95Ms).toBeGreaterThanOrEqual(0);
    console.info(
      `context 10k-name benchmark cold=${coldMs.toFixed(2)}ms warm-p95=${warmP95Ms.toFixed(2)}ms`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
