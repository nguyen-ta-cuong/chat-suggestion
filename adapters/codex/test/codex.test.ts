import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "@chat-suggestion/protocol";

import {
  CodexProbeCache,
  probeCodexCapabilities,
  resolveCodexExecutable,
  type CodexProbeOptions,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("resolveCodexExecutable", () => {
  it("does not mistake a config directory for an executable", async () => {
    const directory = await makeTemporaryDirectory();
    const result = await resolveCodexExecutable({
      explicitPath: directory,
      pathEnvironment: "",
      bundlePaths: [],
    });

    expect(result).toEqual({
      available: false,
      reason: "No regular executable Codex binary was found.",
    });
  });

  it("prefers an explicit executable over PATH and opt-in bundles", async () => {
    const explicit = await makeFakeCodex({ version: "0.1.0" });
    const pathBinary = await makeFakeCodex({ version: "0.2.0" });

    const result = await resolveCodexExecutable({
      explicitPath: explicit,
      pathEnvironment: join(pathBinary, "missing"),
      bundlePaths: [pathBinary],
    });

    expect(result).toEqual({
      available: true,
      executable: explicit,
      source: "explicit",
    });
  });
});

describe("probeCodexCapabilities", () => {
  it("fails closed for malformed version output", async () => {
    const executable = await makeFakeCodex({ version: "nightly-secret-build" });
    const report = await probe(executable);

    expect(report.available).toBe(true);
    expect(report.version).toBeUndefined();
    expect(report.selection).toBe("unsupported");
    expect(report.stockTui.inlineRender).toBe("none");
    expect(report.customFrontend.available).toBe(false);
    expect(report.downgradeReasons).toContain(
      "Codex returned an unrecognized version string.",
    );
  });

  it("reports hooks-only help as no native inline support", async () => {
    const executable = await makeFakeCodex({
      version: "0.7.0",
      rootHelp: "Commands:\n  hooks  Configure UserPromptSubmit hooks\n",
    });
    const report = await probe(executable);

    expect(report.evidence.rootHelp).toBe(true);
    expect(report.evidence.appServerAdvertised).toBe(false);
    expect(report.stockTui).toMatchObject({
      transport: "none",
      inlineRender: "none",
      bufferRead: false,
      cursorRead: false,
      atomicAcceptance: false,
    });
    expect(report.selection).toBe("unsupported");
  });

  it("enables only a custom frontend after schema and app-server negotiation", async () => {
    const executable = await makeFakeCodex({ version: "0.144.0-alpha.4" });
    const report = await probe(executable);

    expect(report.evidence).toEqual({
      rootHelp: true,
      appServerAdvertised: true,
      appServerHelp: true,
      schemaGenerationAdvertised: true,
      initializeSchemaCompatible: true,
      appServerInitialized: true,
      unknownMethodRejected: true,
      malformedRequestRejected: true,
    });
    expect(report.customFrontend).toMatchObject({
      available: true,
      capabilities: {
        transport: "app-server",
        inlineRender: "arbitrary",
        bufferRead: true,
        cursorRead: true,
        atomicAcceptance: true,
      },
    });
    expect(report.stockTui).toMatchObject({
      transport: "none",
      inlineRender: "none",
    });
    expect(report.selection).toBe("custom-frontend");
  });

  it("rejects a custom-frontend handshake when the expected version differs", async () => {
    const executable = await makeFakeCodex({ version: "0.144.0-alpha.4" });
    const report = await probeCodexCapabilities({
      ...probeOptions(executable),
      expectedAppServerVersion: "0.145.0",
    });

    expect(report.customFrontend.available).toBe(false);
    expect(report.selection).toBe("unsupported");
    expect(report.downgradeReasons).toContain(
      "App-server negotiation was skipped because the tested version did not match.",
    );
  });

  it("fails closed and settles when app-server exits before initialization", async () => {
    const executable = await makeFakeCodex({ appServerExitsEarly: true });
    const startedAt = Date.now();
    const report = await probe(executable);

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(report.customFrontend.available).toBe(false);
    expect(report.selection).toBe("unsupported");
  });

  it("kills bounded probes on timeout", async () => {
    const executable = await makeFakeCodex({ hangOnVersion: true });
    const startedAt = Date.now();
    const report = await probeCodexCapabilities({
      ...probeOptions(executable),
      timeoutMs: 80,
    });

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(report.selection).toBe("unsupported");
    expect(report.downgradeReasons).toContain("Codex version probe timed out.");
  });

  it("fails closed when probe output exceeds the configured cap", async () => {
    const executable = await makeFakeCodex({ noisyVersion: true });
    const report = await probeCodexCapabilities({
      ...probeOptions(executable),
      maxOutputBytes: 128,
    });

    expect(report.selection).toBe("unsupported");
    expect(report.downgradeReasons).toContain(
      "Codex version probe exceeded the output limit.",
    );
  });

  it("caches immutable reports without rerunning the executable", async () => {
    const executable = await makeFakeCodex({
      version: "0.7.0",
      rootHelp: "Commands:\n  hooks  Configure hooks\n",
    });
    const cache = new CodexProbeCache({ ttlMs: 60_000, maxEntries: 2 });
    const options = { ...probeOptions(executable), cache };

    const first = await probeCodexCapabilities(options);
    await rm(executable);
    const second = await probeCodexCapabilities(options);

    expect(second).toEqual(first);
  });

  it("selects PTY only for an exact executable fingerprint", async () => {
    const executable = await makeFakeCodex({
      version: "0.7.0",
      rootHelp: "Commands:\n  hooks  Configure hooks\n",
    });
    const bytes = await readFile(executable);
    const profile = {
      protocolVersion: PROTOCOL_VERSION,
      host: {
        executable: "codex",
        version: "0.7.0",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      detectors: ["alternate-screen", "cursor-motion"] as const,
      markers: [] as const,
      capabilities: {
        transport: "pty" as const,
        inlineRender: "adjacent" as const,
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
        message: "Adjacent rendering only.",
      },
    };
    const matching = await probeCodexCapabilities({
      ...probeOptions(executable),
      ptyProfile: profile,
    });
    const mismatched = await probeCodexCapabilities({
      ...probeOptions(executable),
      ptyProfile: {
        ...profile,
        host: { ...profile.host, sha256: "0".repeat(64) },
      },
    });

    expect(matching.selection).toBe("pty");
    expect(matching.ptyProfile).toEqual(profile);
    expect(mismatched.selection).toBe("unsupported");
    expect(mismatched.ptyProfile).toBeUndefined();
  });

  it("handles repeated unavailable probes without leaking work", async () => {
    const options: CodexProbeOptions = {
      resolution: {
        explicitPath: join(tmpdir(), "codex-does-not-exist"),
        pathEnvironment: "",
        bundlePaths: [],
      },
      timeoutMs: 50,
    };

    const reports = await Promise.all(
      Array.from({ length: 50 }, () => probeCodexCapabilities(options)),
    );

    expect(reports.every((report) => report.selection === "unsupported")).toBe(
      true,
    );
  });
});

async function probe(executable: string) {
  return probeCodexCapabilities(probeOptions(executable));
}

function probeOptions(executable: string): CodexProbeOptions {
  return {
    resolution: {
      explicitPath: executable,
      pathEnvironment: "",
      bundlePaths: [],
    },
    timeoutMs: 2_000,
    maxOutputBytes: 16 * 1_024,
  };
}

interface FakeCodexOptions {
  readonly version?: string;
  readonly rootHelp?: string;
  readonly hangOnVersion?: boolean;
  readonly noisyVersion?: boolean;
  readonly appServerExitsEarly?: boolean;
}

async function makeFakeCodex(options: FakeCodexOptions): Promise<string> {
  const directory = await makeTemporaryDirectory();
  const executable = join(directory, "codex");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const version = ${JSON.stringify(options.version ?? "0.144.0-alpha.4")};
const rootHelp = ${JSON.stringify(
    options.rootHelp ?? "Commands:\n  app-server  Run the app server\n",
  )};
if (args[0] === "--version") {
  ${options.hangOnVersion === true ? "setInterval(() => {}, 1000);" : ""}
  ${options.noisyVersion === true ? 'process.stdout.write("x".repeat(4096), () => process.exit(0));' : ""}
  if (${options.hangOnVersion !== true && options.noisyVersion !== true}) console.log("codex-cli " + version);
} else if (args[0] === "--help") {
  process.stdout.write(rootHelp);
} else if (args[0] === "app-server" && args[1] === "--help") {
  process.stdout.write("Commands:\\n  generate-json-schema  Generate JSON Schema\\n");
} else if (args[0] === "app-server" && args[1] === "generate-json-schema") {
  const out = args[args.indexOf("--out") + 1];
  fs.mkdirSync(out + "/v1", { recursive: true });
  fs.writeFileSync(out + "/v1/InitializeParams.json", JSON.stringify({ title: "InitializeParams", required: ["clientInfo"] }));
  fs.writeFileSync(out + "/ClientRequest.json", JSON.stringify({ oneOf: [{ properties: { method: { enum: ["initialize"] } } }] }));
} else if (args[0] === "app-server") {
  ${options.appServerExitsEarly === true ? "process.exit(1);" : ""}
  let buffered = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\\n")) >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); } catch { console.log(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); continue; }
      if (message.method === "initialize") {
        if (message.params && message.params.clientInfo) console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { userAgent: "fake-codex/" + version, platformFamily: "unix", platformOs: "test", codexHome: "/tmp/fake" } }));
        else console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "invalid params" } }));
      } else if (message.method === "chat-suggestion/unknown") {
        console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } }));
      } else if (message.id !== undefined) {
        console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "invalid request" } }));
      }
    }
  });
}
`;
  await writeFile(executable, script, "utf8");
  await chmod(executable, 0o755);
  return executable;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "adapter-codex-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
