import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePtyProfileDescriptor,
  PROTOCOL_VERSION,
  type PtyProfileDescriptor,
} from "@chat-suggestion/protocol";
import { afterEach, describe, expect, it } from "vitest";

import {
  ClaudeCapabilityProbeCache,
  probeClaude,
  resolveClaudeExecutable,
  type ClaudeNativeEditorEvidence,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("Claude capability probing", () => {
  it("reports unavailable for a missing binary or settings directory alone", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "settings.json"), "{}", "utf8");
    expect(
      await resolveClaudeExecutable({ pathEnvironment: directory }),
    ).toBeUndefined();
    const report = await probeClaude({
      executablePath: join(directory, "claude"),
    });
    expect(report.status).toBe("unavailable");
    expect(report.capabilities.inlineRender).toBe("none");
  });

  it("treats lifecycle hooks as context evidence, never editor access", async () => {
    const executable = await fakeClaude(
      "Claude Code 2.3.4",
      "Commands: hooks UserPromptSubmit",
    );
    const report = await probeClaude({ executablePath: executable });
    expect(report).toMatchObject({
      status: "present-unsupported",
      version: "2.3.4",
      lifecycleHooksAdvertised: true,
      capabilities: { transport: "none", inlineRender: "none" },
      downgradeReasons: ["lifecycle-hooks-are-not-editor-access"],
    });
  });

  it("retains malformed or unknown versions as unsupported", async () => {
    const executable = await fakeClaude("development build", "hooks");
    const report = await probeClaude({ executablePath: executable });
    expect(report.status).toBe("present-unsupported");
    expect(report.version).toBeUndefined();
    expect(report.downgradeReasons).toContain("unrecognized-version-output");
  });

  it("requires every native editor handshake dimension", async () => {
    const executable = await fakeClaude("claude 1.2.3", "public editor API");
    const report = await probeClaude({
      executablePath: executable,
      nativeHandshake: {
        negotiate: () =>
          Promise.resolve(nativeEvidence({ styledDecoration: false })),
      },
    });
    expect(report.status).toBe("present-unsupported");
    expect(report.missingHandshakeDimensions).toEqual(["styledDecoration"]);
    expect(report.capabilities.inlineRender).toBe("none");
  });

  it("enables native capability only after a complete explicit handshake", async () => {
    const executable = await fakeClaude("claude 1.2.3", "public editor API");
    const report = await probeClaude({
      executablePath: executable,
      nativeHandshake: { negotiate: () => Promise.resolve(nativeEvidence()) },
    });
    expect(report.status).toBe("native-handshake-supported");
    expect(report.capabilities).toMatchObject({
      transport: "native",
      inlineRender: "arbitrary",
      atomicAcceptance: true,
    });
  });

  it("bounds a native handshake that ignores abort", async () => {
    const executable = await fakeClaude("claude 1.2.3", "public editor API");
    const report = await probeClaude({
      executablePath: executable,
      nativeHandshakeTimeoutMs: 25,
      nativeHandshake: {
        negotiate: async () =>
          await new Promise<ClaudeNativeEditorEvidence>(() => undefined),
      },
    });
    expect(report).toMatchObject({
      status: "error",
      downgradeReasons: ["native-handshake-timeout"],
    });
  });

  it("selects PTY support only for an exact validated fingerprint", async () => {
    const executable = await fakeClaude("claude 1.2.3", "help");
    const canonicalExecutable = await realpath(executable);
    const fingerprint = createHash("sha256")
      .update(await readFile(executable))
      .digest("hex");
    const exact = ptyProfile(canonicalExecutable, "1.2.3", fingerprint);
    expect(parsePtyProfileDescriptor(exact)).toMatchObject({ ok: true });
    const supported = await probeClaude({
      executablePath: executable,
      testedPtyProfiles: [exact],
    });
    expect(supported.executable).toBe(canonicalExecutable);
    expect(supported.version).toBe("1.2.3");
    expect(supported.fingerprint).toBe(fingerprint);
    expect(supported.status).toBe("pty-profile-supported");
    expect(supported.capabilities.inlineRender).toBe("adjacent");

    const mismatched = await probeClaude({
      executablePath: executable,
      testedPtyProfiles: [
        ptyProfile(canonicalExecutable, "1.2.4", fingerprint),
      ],
    });
    expect(mismatched.status).toBe("present-unsupported");
  });

  it("kills bounded probes on timeout and oversized output", async () => {
    const slow = await fakeClaude(
      "claude 1.2.3",
      "help",
      "setTimeout(() => {}, 60_000);",
    );
    const timedOut = await probeClaude({ executablePath: slow, timeoutMs: 25 });
    expect(timedOut).toMatchObject({
      status: "error",
      downgradeReasons: ["probe-timeout"],
    });

    const noisy = await fakeClaude("x".repeat(2_000), "help");
    const oversized = await probeClaude({
      executablePath: noisy,
      maximumOutputBytes: 100,
    });
    expect(oversized).toMatchObject({
      status: "error",
      downgradeReasons: ["probe-output-limit"],
    });
  });

  it("caches bounded probe evidence until cleared", async () => {
    const executable = await fakeClaude("claude 1.2.3", "help");
    const cache = new ClaudeCapabilityProbeCache();
    expect((await cache.probe({ executablePath: executable })).version).toBe(
      "1.2.3",
    );
    const changed = (await readFile(executable, "utf8")).replace(
      "1.2.3",
      "9.9.9",
    );
    await writeFile(executable, changed, "utf8");
    expect((await cache.probe({ executablePath: executable })).version).toBe(
      "1.2.3",
    );
    cache.clear();
    expect((await cache.probe({ executablePath: executable })).version).toBe(
      "9.9.9",
    );
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "claude-adapter-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function fakeClaude(
  version: string,
  help: string,
  suffix = "",
): Promise<string> {
  const directory = await temporaryDirectory();
  const executable = join(directory, "claude");
  const source = `#!/usr/bin/env node
const argument = process.argv[2];
if (argument === "--version") process.stdout.write(${JSON.stringify(version)});
else if (argument === "--help") process.stdout.write(${JSON.stringify(help)});
else process.exitCode = 64;
${suffix}
`;
  await writeFile(executable, source, "utf8");
  await chmod(executable, 0o700);
  return executable;
}

function nativeEvidence(
  overrides: Partial<ClaudeNativeEditorEvidence> = {},
): ClaudeNativeEditorEvidence {
  return {
    semanticBufferRead: true,
    cursorRead: true,
    changeEvents: true,
    styledDecoration: true,
    nonSubmittingInsertion: true,
    nativeCompletionAwareness: true,
    disposal: true,
    ...overrides,
  };
}

function ptyProfile(
  executable: string,
  version: string,
  sha256: string,
): PtyProfileDescriptor {
  return {
    protocolVersion: PROTOCOL_VERSION,
    host: { executable, version, sha256 },
    detectors: ["hidden-input", "completion-ui", "alternate-screen"],
    markers: [
      "prompt-start",
      "prompt-end",
      "hidden-input-start",
      "hidden-input-end",
    ],
    capabilities: {
      transport: "pty",
      inlineRender: "adjacent",
      bufferRead: false,
      cursorRead: false,
      atomicAcceptance: false,
      cancellation: true,
      resizeAwareness: true,
      alternateScreenSafety: false,
      nativeCompletionAwareness: false,
      attachmentReferences: false,
    },
    downgrade: {
      code: "experimental-pty",
      message: "Synthetic transcript profile only",
    },
  };
}
