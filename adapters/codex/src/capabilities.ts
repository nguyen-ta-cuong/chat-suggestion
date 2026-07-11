import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  parsePtyProfileDescriptor,
  type AdapterCapabilities,
} from "@chat-suggestion/protocol";

import { negotiateCodexAppServer } from "./app-server.js";
import { runBoundedProcess, type BoundedProcessOptions } from "./process.js";
import { resolveCodexExecutable } from "./resolver.js";
import { probeInitializeSchema } from "./schema.js";
import type {
  CodexCapabilityReport,
  CodexProbeEvidence,
  CodexProbeOptions,
  CodexResolution,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1_024;
const VERSION_PATTERN =
  /^codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)$/u;

const STOCK_TUI_CAPABILITIES: AdapterCapabilities = {
  transport: "none",
  inlineRender: "none",
  bufferRead: false,
  cursorRead: false,
  atomicAcceptance: false,
  cancellation: false,
  resizeAwareness: false,
  alternateScreenSafety: false,
  nativeCompletionAwareness: false,
  attachmentReferences: false,
};

const CUSTOM_FRONTEND_CAPABILITIES: AdapterCapabilities = {
  transport: "app-server",
  inlineRender: "arbitrary",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: true,
  nativeCompletionAwareness: true,
  attachmentReferences: false,
};

const EMPTY_EVIDENCE: CodexProbeEvidence = {
  rootHelp: false,
  appServerAdvertised: false,
  appServerHelp: false,
  schemaGenerationAdvertised: false,
  initializeSchemaCompatible: false,
  appServerInitialized: false,
  unknownMethodRejected: false,
  malformedRequestRejected: false,
};

export async function probeCodexCapabilities(
  options: CodexProbeOptions = {},
): Promise<CodexCapabilityReport> {
  const cacheKey = JSON.stringify({
    resolution: options.resolution ?? {},
    expectedAppServerVersion: options.expectedAppServerVersion,
    ptyProfile: options.ptyProfile,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  });
  const cached = options.cache?.get(cacheKey);
  if (cached !== undefined) return cached;

  const resolution = await resolveCodexExecutable(options.resolution);
  const report = await probeResolvedCodex(resolution, options);
  options.cache?.set(cacheKey, report);
  return report;
}

async function probeResolvedCodex(
  resolution: CodexResolution,
  options: CodexProbeOptions,
): Promise<CodexCapabilityReport> {
  if (!resolution.available) {
    return unavailableReport(resolution.reason);
  }
  const probeDirectory = await mkdtemp(
    join(tmpdir(), "codex-capability-probe-"),
  );
  await mkdir(join(probeDirectory, "codex-home"), { mode: 0o700 });
  const processOptions = buildProcessOptions(probeDirectory, options);
  try {
    return await probeExecutable(resolution, options, processOptions);
  } finally {
    await rm(probeDirectory, { force: true, recursive: true });
  }
}

async function probeExecutable(
  resolution: Extract<CodexResolution, { available: true }>,
  options: CodexProbeOptions,
  processOptions: BoundedProcessOptions,
): Promise<CodexCapabilityReport> {
  const versionResult = await runBoundedProcess(
    resolution.executable,
    ["--version"],
    processOptions,
  );
  if (!versionResult.ok) {
    return failedExecutableReport(
      resolution,
      processFailureReason("Codex version probe", versionResult.kind),
    );
  }
  const version = parseVersion(versionResult.stdout);
  if (version === undefined) {
    return failedExecutableReport(
      resolution,
      "Codex returned an unrecognized version string.",
    );
  }

  const rootHelp = await runBoundedProcess(
    resolution.executable,
    ["--help"],
    processOptions,
  );
  const rootHelpAvailable = rootHelp.ok;
  const appServerAdvertised =
    rootHelp.ok && /^\s*app-server\s+/mu.test(rootHelp.stdout);
  let appServerHelpAvailable = false;
  let schemaGenerationAdvertised = false;
  if (appServerAdvertised) {
    const appServerHelp = await runBoundedProcess(
      resolution.executable,
      ["app-server", "--help"],
      processOptions,
    );
    appServerHelpAvailable = appServerHelp.ok;
    schemaGenerationAdvertised =
      appServerHelp.ok &&
      /^\s*generate-json-schema\s+/mu.test(appServerHelp.stdout);
  }

  let initializeSchemaCompatible = false;
  if (schemaGenerationAdvertised) {
    initializeSchemaCompatible = await probeInitializeSchema(
      resolution.executable,
      join(processOptions.cwd, "schema"),
      processOptions,
    );
  }

  const reasons: string[] = [];
  let handshake = {
    initialized: false,
    unknownMethodRejected: false,
    malformedRequestRejected: false,
  };
  if (
    initializeSchemaCompatible &&
    options.expectedAppServerVersion !== undefined &&
    options.expectedAppServerVersion !== version
  ) {
    reasons.push(
      "App-server negotiation was skipped because the tested version did not match.",
    );
  } else if (initializeSchemaCompatible) {
    handshake = await negotiateCodexAppServer(
      resolution.executable,
      processOptions,
    );
    if (!handshake.initialized) {
      reasons.push("Codex app-server initialization failed closed.");
    }
  }

  const evidence: CodexProbeEvidence = {
    rootHelp: rootHelpAvailable,
    appServerAdvertised,
    appServerHelp: appServerHelpAvailable,
    schemaGenerationAdvertised,
    initializeSchemaCompatible,
    appServerInitialized: handshake.initialized,
    unknownMethodRejected: handshake.unknownMethodRejected,
    malformedRequestRejected: handshake.malformedRequestRejected,
  };
  const customFrontendAvailable =
    handshake.initialized &&
    handshake.unknownMethodRejected &&
    handshake.malformedRequestRejected;
  if (!customFrontendAvailable && reasons.length === 0) {
    reasons.push(customFrontendDowngradeReason(evidence));
  }
  return await selectCapabilityReport(
    resolution,
    version,
    evidence,
    customFrontendAvailable,
    reasons,
    options,
  );
}

async function selectCapabilityReport(
  resolution: Extract<CodexResolution, { available: true }>,
  version: string,
  evidence: CodexProbeEvidence,
  customFrontendAvailable: boolean,
  reasons: string[],
  options: CodexProbeOptions,
): Promise<CodexCapabilityReport> {
  const profileResult =
    options.ptyProfile === undefined
      ? undefined
      : parsePtyProfileDescriptor(options.ptyProfile);
  const ptyAvailable =
    profileResult?.ok === true &&
    (await profileMatchesExecutable(
      profileResult.value,
      resolution.executable,
      version,
    ));
  if (profileResult !== undefined && !ptyAvailable) {
    reasons.push(
      "The PTY profile did not exactly match the resolved executable fingerprint.",
    );
  }
  const selection: CodexCapabilityReport["selection"] = customFrontendAvailable
    ? "custom-frontend"
    : ptyAvailable
      ? "pty"
      : "unsupported";
  const base = {
    available: true,
    commandName: "codex" as const,
    executable: resolution.executable,
    executableSource: resolution.source,
    version,
    evidence,
    stockTui: STOCK_TUI_CAPABILITIES,
    customFrontend: {
      available: customFrontendAvailable,
      capabilities: customFrontendAvailable
        ? CUSTOM_FRONTEND_CAPABILITIES
        : STOCK_TUI_CAPABILITIES,
      reason: customFrontendAvailable
        ? "A custom frontend may own its editor over the initialized app-server transport."
        : "No compatible app-server initialization handshake was completed.",
    },
    selection,
    downgradeReasons: reasons,
  };
  return profileResult?.ok === true && ptyAvailable
    ? { ...base, ptyProfile: profileResult.value }
    : base;
}

async function profileMatchesExecutable(
  profile: NonNullable<CodexProbeOptions["ptyProfile"]>,
  executable: string,
  version: string,
): Promise<boolean> {
  if (
    profile.host.executable !== basename(executable) ||
    profile.host.version !== version
  ) {
    return false;
  }
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(executable)) {
      hash.update(chunk as Buffer);
    }
    return hash.digest("hex") === profile.host.sha256;
  } catch {
    return false;
  }
}

function buildProcessOptions(
  probeDirectory: string,
  options: CodexProbeOptions,
): BoundedProcessOptions {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    cwd: probeDirectory,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: probeDirectory,
      CODEX_HOME: join(probeDirectory, "codex-home"),
    },
  };
}

function parseVersion(stdout: string): string | undefined {
  return VERSION_PATTERN.exec(stdout.trim())?.[1];
}

function processFailureReason(prefix: string, kind: string): string {
  if (kind === "timeout") return `${prefix} timed out.`;
  if (kind === "output-limit") return `${prefix} exceeded the output limit.`;
  return `${prefix} failed.`;
}

function customFrontendDowngradeReason(evidence: CodexProbeEvidence): string {
  if (!evidence.rootHelp) return "Codex help probing failed.";
  if (!evidence.appServerAdvertised) {
    return "Codex did not advertise the documented app-server command.";
  }
  if (!evidence.initializeSchemaCompatible) {
    return "Codex did not generate a compatible public initialize schema.";
  }
  return "Codex app-server protocol safety checks did not all pass.";
}

function unavailableReport(reason: string): CodexCapabilityReport {
  return {
    available: false,
    commandName: "codex",
    evidence: EMPTY_EVIDENCE,
    stockTui: STOCK_TUI_CAPABILITIES,
    customFrontend: {
      available: false,
      capabilities: STOCK_TUI_CAPABILITIES,
      reason: "No executable Codex binary was found.",
    },
    selection: "unsupported",
    downgradeReasons: [reason],
  };
}

function failedExecutableReport(
  resolution: Extract<CodexResolution, { available: true }>,
  reason: string,
): CodexCapabilityReport {
  return {
    ...unavailableReport(reason),
    available: true,
    executable: resolution.executable,
    executableSource: resolution.source,
  };
}
