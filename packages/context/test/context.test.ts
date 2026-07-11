import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTEXT_SOURCE_BYTE_LIMITS,
  FAKE_CAPABILITIES,
  parseContextEnvelope,
  type PromptSnapshot,
} from "@chat-suggestion/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContextAssembler,
  collectorCacheKey,
  collectContext,
  createCollectors,
  createDefaultContextPolicy,
  previewContext,
  runGit,
  type CollectedSource,
  type ContextAssemblyInput,
  type ContextCollector,
  type ContextPolicy,
} from "../src/index.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("context assembly", () => {
  it("never serializes host-supplied raw content into cache keys", () => {
    const input = assemblyInput(process.cwd(), {
      recentChat: [{ role: "user", content: "raw-private-chat" }],
      attachments: [
        {
          name: "note.txt",
          content: "raw-private-attachment",
          explicit: true,
          textual: true,
        },
      ],
    });
    const policy = createDefaultContextPolicy(input.snapshot.workingDirectory);
    const collectors = createCollectors(input, policy);

    expect(
      collectors
        .filter((collector) => collector.sourceId !== "project")
        .every(
          (collector) => collectorCacheKey(collector, input, policy) === null,
        ),
    ).toBe(true);
    const project = collectors.find(
      (collector) => collector.sourceId === "project",
    );
    expect(project).toBeDefined();
    const key = project && collectorCacheKey(project, input, policy);
    expect(key).not.toContain("raw-private");
  });

  it("bounds host-supplied collector cardinality before collection", () => {
    const attachments = Array.from({ length: 100 }, (_, index) => ({
      name: `note-${index}.txt`,
      content: "x".repeat(100_000),
      explicit: true,
      textual: true,
    }));
    const input = assemblyInput(process.cwd(), { attachments });
    const collectors = createCollectors(
      input,
      createDefaultContextPolicy(process.cwd()),
    );

    expect(
      collectors.filter((collector) =>
        collector.sourceId.startsWith("attachment:"),
      ),
    ).toHaveLength(32);
  });
  it("collects only trusted, explicit, in-root text and redacts fake secrets", async () => {
    const { root, outside } = await createAdversarialRepository();
    const policy = createDefaultContextPolicy(root);
    const input = assemblyInput(root, {
      recentChat: [
        { role: "user", content: "older message" },
        { role: "assistant", content: "newer message" },
      ],
      attachments: [
        {
          name: "notes.txt",
          content: "github_pat_FAKEFAKEFAKEFAKEFAKEFAKEFAKE",
          explicit: true,
          textual: true,
        },
        {
          name: "hidden.txt",
          content: "MUST_NOT_INCLUDE_ATTACHMENT",
          explicit: false,
          textual: true,
        },
      ],
      referencedFiles: [
        "src/app.ts",
        ".env",
        "binary.dat",
        "escape-link.txt",
        outside,
      ],
      selectedSnippets: [
        {
          relativePath: "src/app.ts",
          content: "const selected = true;",
          provenance: "editor selection",
        },
        {
          relativePath: "src/app.ts",
          content: "MUST_NOT_INCLUDE_UNPROVENANCED",
          provenance: "",
        },
      ],
      planFiles: ["AGENTS.md", "not-allowlisted.md"],
    });

    const result = await collectContext(input, policy);

    expect(result.status).toBe("collected");
    if (result.status !== "collected") return;
    const serialized = JSON.stringify(result.envelope);
    expect(serialized).toContain("tracked change");
    expect(serialized).toContain("staged change");
    expect(serialized).toContain("const selected = true;");
    expect(serialized).toContain("newer message");
    expect(serialized).toContain("[REDACTED:github-token]");
    expect(serialized).not.toContain("FAKEFAKEFAKE");
    expect(serialized).not.toContain("UNTRACKED_ENV_SECRET");
    expect(serialized).not.toContain("UNTRACKED_FILE_SECRET");
    expect(serialized).not.toContain("OUTSIDE_SECRET");
    expect(serialized).not.toContain("NESTED_SECRET");
    expect(serialized).not.toContain("BINARY_SECRET");
    expect(serialized).not.toContain("MUST_NOT_INCLUDE_ATTACHMENT");
    expect(serialized).not.toContain("MUST_NOT_INCLUDE_UNPROVENANCED");
    expect(serialized).not.toContain("not-allowlisted body");
    expect(result.serializedBytes).toBe(Buffer.byteLength(serialized));
    expect(result.serializedBytes).toBeLessThanOrEqual(
      policy.totalContextBytes,
    );
    expect(parseContextEnvelope(result.envelope).ok).toBe(true);
    expect(result.sources.some((source) => source.redactionCount > 0)).toBe(
      true,
    );
  });

  it("fails closed for an untrusted project while retaining host-supplied chat and attachments", async () => {
    const { root } = await createAdversarialRepository();
    const input = assemblyInput(root, {
      trustedProject: false,
      recentChat: [{ role: "user", content: "host chat" }],
      attachments: [
        {
          name: "note.txt",
          content: "explicit note",
          explicit: true,
          textual: true,
        },
      ],
      referencedFiles: ["src/app.ts"],
      planFiles: ["AGENTS.md"],
    });

    const result = await collectContext(
      input,
      createDefaultContextPolicy(root),
    );

    expect(result.status).toBe("collected");
    if (result.status !== "collected") return;
    expect(
      result.envelope.contributions.map(({ kind }) => kind).sort(),
    ).toEqual(["attachment", "recent-chat"]);
    expect(JSON.stringify(result.envelope)).not.toContain("tracked change");
  });

  it("enforces draft, per-source, Unicode, and serialized-envelope budgets", async () => {
    const root = await makeDirectory("budget");
    initializeGit(root);
    const policy = policyWith(root, {
      totalContextBytes: 220,
      sourceByteLimits: { ...CONTEXT_SOURCE_BYTE_LIMITS, attachment: 96 },
    });
    const largeUnicode = "界".repeat(200);
    const input = assemblyInput(root, {
      attachments: [
        {
          name: "unicode.txt",
          content: largeUnicode,
          explicit: true,
          textual: true,
        },
      ],
    });

    const result = await collectContext(input, policy);
    expect(result.status).toBe("collected");
    if (result.status !== "collected") return;
    expect(result.serializedBytes).toBeLessThanOrEqual(220);
    const attachment = result.envelope.contributions.find(
      ({ kind }) => kind === "attachment",
    );
    expect(Buffer.byteLength(attachment?.content ?? "")).toBeLessThanOrEqual(
      96,
    );
    expect(attachment?.content).not.toContain("�");
    expect(
      result.sources.find(({ kind }) => kind === "attachment")?.truncated,
    ).toBe(true);

    const skipped = await collectContext(
      assemblyInput(root, { draft: "x".repeat(9) }),
      policyWith(root, { draftByteLimit: 8 }),
    );
    expect(skipped).toMatchObject({
      status: "skipped",
      reason: "draft-too-large",
      draftBytes: 9,
    });
  });

  it("omits failed and timed-out collectors without delaying healthy context", async () => {
    const root = await makeDirectory("timeouts");
    const assembler = new ContextAssembler(
      policyWith(root, { collectorTimeoutMs: 20 }),
    );
    const abortObserved = vi.fn();
    const slow: ContextCollector = {
      sourceId: "slow",
      kind: "git",
      collect: (signal) =>
        new Promise(() => {
          signal.addEventListener(
            "abort",
            () => {
              abortObserved();
            },
            { once: true },
          );
        }),
    };
    const failed: ContextCollector = {
      sourceId: "failed",
      kind: "project",
      collect: () => Promise.reject(new Error("sensitive raw failure")),
    };
    const healthy = collector("healthy", "recent-chat", "healthy content");

    const result = await assembler.collect(
      assemblyInput(root),
      new AbortController().signal,
      [slow, failed, healthy],
    );

    expect(result.status).toBe("collected");
    if (result.status !== "collected") return;
    expect(result.envelope.contributions).toEqual([
      { kind: "recent-chat", content: "healthy content" },
    ]);
    expect(result.sources.map(({ outcome }) => outcome)).toEqual([
      "timed-out",
      "failed",
      "included",
    ]);
    expect(abortObserved).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.sources)).not.toContain(
      "sensitive raw failure",
    );
  });

  it("returns an aborted skip and stops an in-flight collector", async () => {
    const root = await makeDirectory("abort");
    const assembler = new ContextAssembler(
      policyWith(root, { collectorTimeoutMs: 1_000 }),
    );
    const controller = new AbortController();
    const stopped = vi.fn();
    const pending: ContextCollector = {
      sourceId: "pending",
      kind: "git",
      collect: (signal) =>
        new Promise(() => {
          signal.addEventListener(
            "abort",
            () => {
              stopped();
            },
            { once: true },
          );
        }),
    };
    const collection = assembler.collect(
      assemblyInput(root),
      controller.signal,
      [pending],
    );
    controller.abort(new Error("caller canceled"));

    await expect(collection).resolves.toMatchObject({
      status: "skipped",
      reason: "aborted",
    });
    expect(stopped).toHaveBeenCalledOnce();
  });

  it("makes preview and collection envelopes byte-for-byte equal", async () => {
    const root = await makeDirectory("preview");
    initializeGit(root);
    const input = assemblyInput(root, {
      recentChat: [{ role: "user", content: "same input" }],
    });
    const policy = createDefaultContextPolicy(root);

    const [collected, previewed] = await Promise.all([
      collectContext(input, policy),
      previewContext(input, policy),
    ]);

    expect(collected.status).toBe("collected");
    expect(previewed.status).toBe("collected");
    if (collected.status !== "collected" || previewed.status !== "collected")
      return;
    expect(JSON.stringify(previewed.envelope)).toBe(
      JSON.stringify(collected.envelope),
    );
  });

  it("aborts a Git child process instead of leaving it waiting", async () => {
    const root = await makeDirectory("git-abort");
    initializeGit(root);
    const controller = new AbortController();
    const running = runGit(
      root,
      ["cat-file", "--batch"],
      controller.signal,
      1_024,
    );
    setTimeout(() => {
      controller.abort();
    }, 10);

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});

function collector(
  sourceId: string,
  kind: CollectedSource["kind"],
  content: string,
): ContextCollector {
  return {
    sourceId,
    kind,
    collect: () =>
      Promise.resolve({
        sourceId,
        kind,
        content,
        originalBytes: Buffer.byteLength(content),
        redactionRuleIds: [],
        redactionCount: 0,
        durationMs: 0,
      }),
  };
}

async function createAdversarialRepository(): Promise<{
  root: string;
  outside: string;
}> {
  const root = await makeDirectory("adversarial");
  const outsideRoot = await makeDirectory("outside");
  const outside = join(outsideRoot, "outside.txt");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/app.ts"), "export const state = 'base';\n");
  await writeFile(join(root, "AGENTS.md"), "trusted instructions\n");
  await writeFile(join(root, "not-allowlisted.md"), "not-allowlisted body\n");
  await writeFile(
    join(root, "binary.dat"),
    Buffer.from([0, 1, 2, 66, 73, 78, 65, 82, 89]),
  );
  await writeFile(join(root, ".env"), "PASSWORD=UNTRACKED_ENV_SECRET\n");
  await writeFile(join(root, "untracked.txt"), "UNTRACKED_FILE_SECRET\n");
  await writeFile(outside, "OUTSIDE_SECRET\n");
  await symlink(outside, join(root, "escape-link.txt"));
  await mkdir(join(root, "nested-repository/.git"), { recursive: true });
  await writeFile(
    join(root, "nested-repository/private.txt"),
    "NESTED_SECRET\n",
  );
  initializeGit(root);
  git(root, ["add", "src/app.ts", "AGENTS.md", "binary.dat"]);
  git(root, ["commit", "-m", "fixture"]);
  await writeFile(
    join(root, "src/app.ts"),
    "export const state = 'tracked change';\n",
  );
  await writeFile(
    join(root, "AGENTS.md"),
    "trusted instructions staged change\n",
  );
  git(root, ["add", "AGENTS.md"]);
  return { root, outside };
}

async function makeDirectory(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `chat-context-${label}-`));
  temporaryPaths.push(path);
  return path;
}

function initializeGit(root: string): void {
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Context Fixture"]);
}

function git(root: string, arguments_: readonly string[]): void {
  execFileSync("git", [...arguments_], { cwd: root, stdio: "ignore" });
}

function assemblyInput(
  root: string,
  overrides: Partial<ContextAssemblyInput> & { draft?: string } = {},
): ContextAssemblyInput {
  const snapshot: PromptSnapshot = {
    revision: 1,
    text: overrides.draft ?? "fix the tests",
    cursorByte: Buffer.byteLength(overrides.draft ?? "fix the tests"),
    host: { name: "fixture", version: "1" },
    capabilities: FAKE_CAPABILITIES,
    workingDirectory: root,
    sessionId: "fixture-session",
  };
  const inputOverrides = { ...overrides };
  delete inputOverrides.draft;
  return { snapshot, trustedProject: true, ...inputOverrides };
}

function policyWith(
  root: string,
  overrides: Partial<ContextPolicy>,
): ContextPolicy {
  return { ...createDefaultContextPolicy(root), ...overrides };
}
