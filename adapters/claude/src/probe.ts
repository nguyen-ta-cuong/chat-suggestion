import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, open, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

import {
  parsePtyProfileDescriptor,
  type PtyProfileDescriptor,
} from "@chat-suggestion/protocol";

import {
  missingHandshakeDimensions,
  nativeCapabilities,
  unsupportedCapabilities,
} from "./handshake.js";
import type { ClaudeCapabilityReport, ClaudeProbeOptions } from "./types.js";

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 16_384;
const VERSION_PATTERN =
  /(?:claude(?:\s+code)?\s*)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/iu;

export async function probeClaude(
  options: ClaudeProbeOptions = {},
): Promise<ClaudeCapabilityReport> {
  const executable = await resolveClaudeExecutable(options);
  if (executable === undefined) return unavailableReport();
  try {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maximumOutputBytes =
      options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES;
    const versionOutput = await runBounded(
      executable,
      ["--version"],
      timeoutMs,
      maximumOutputBytes,
    );
    const version = parseVersion(versionOutput);
    if (version === undefined)
      return unsupportedReport(executable, undefined, undefined, false, [
        "unrecognized-version-output",
      ]);
    const fingerprint = await sha256File(executable);
    const help = await runBounded(
      executable,
      ["--help"],
      timeoutMs,
      maximumOutputBytes,
    );
    const hooksAdvertised = /hooks?|UserPromptSubmit/iu.test(help);

    if (options.nativeHandshake !== undefined) {
      const controller = new AbortController();
      const handshakeTimeoutMs = options.nativeHandshakeTimeoutMs ?? timeoutMs;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const evidence = await Promise.race([
          options.nativeHandshake.negotiate(controller.signal),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(codeError("native-handshake-timeout"));
            }, handshakeTimeoutMs);
          }),
        ]);
        const missing = missingHandshakeDimensions(evidence);
        if (missing.length === 0) {
          return {
            status: "native-handshake-supported",
            executable,
            version,
            fingerprint,
            capabilities: nativeCapabilities(),
            lifecycleHooksAdvertised: hooksAdvertised,
            evidence: [
              "version-probe",
              "help-probe",
              "native-editor-handshake",
            ],
            downgradeReasons: [],
            missingHandshakeDimensions: [],
          };
        }
        return unsupportedReport(
          executable,
          version,
          fingerprint,
          hooksAdvertised,
          ["incomplete-native-editor-handshake"],
          missing,
        );
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }

    const profile = selectExactProfile(
      options.testedPtyProfiles ?? [],
      executable,
      version,
      fingerprint,
    );
    if (profile !== undefined) {
      return {
        status: "pty-profile-supported",
        executable,
        version,
        fingerprint,
        capabilities: profile.capabilities,
        lifecycleHooksAdvertised: hooksAdvertised,
        evidence: ["version-probe", "help-probe", "exact-pty-profile"],
        downgradeReasons: ["experimental-adjacent-pty-only"],
        missingHandshakeDimensions: [],
        ptyProfile: profile,
      };
    }
    return unsupportedReport(
      executable,
      version,
      fingerprint,
      hooksAdvertised,
      [
        hooksAdvertised
          ? "lifecycle-hooks-are-not-editor-access"
          : "no-editor-handshake",
      ],
    );
  } catch (error: unknown) {
    return {
      status: "error",
      executable,
      capabilities: unsupportedCapabilities(),
      lifecycleHooksAdvertised: false,
      evidence: [],
      downgradeReasons: [safeErrorCode(error)],
      missingHandshakeDimensions: [],
    };
  }
}

export async function resolveClaudeExecutable(
  options: Pick<ClaudeProbeOptions, "executablePath" | "pathEnvironment"> = {},
): Promise<string | undefined> {
  const candidates =
    options.executablePath === undefined
      ? pathCandidates(options.pathEnvironment ?? process.env.PATH ?? "")
      : [options.executablePath];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try {
      const resolved = await realpath(candidate);
      const info = await stat(resolved);
      if (!info.isFile()) continue;
      await access(resolved, 1);
      return resolved;
    } catch {
      // An unavailable candidate is expected during PATH discovery.
    }
  }
  return undefined;
}

function pathCandidates(pathEnvironment: string): string[] {
  return pathEnvironment
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, "claude"));
}

async function runBounded(
  executable: string,
  arguments_: readonly string[],
  timeoutMs: number,
  maximumBytes: number,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [...arguments_], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let forcedError: Error | undefined;
    let reapFallback: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (reapFallback !== undefined) clearTimeout(reapFallback);
      if (error !== undefined) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const collect = (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        forcedError = codeError("probe-output-limit");
        child.kill("SIGKILL");
        reapFallback ??= setTimeout(() => finish(forcedError), timeoutMs);
      } else chunks.push(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      finish(
        forcedError ??
          (code === 0 ? undefined : codeError("probe-exit-nonzero")),
      );
    });
    const timer = setTimeout(() => {
      forcedError = codeError("probe-timeout");
      child.kill("SIGKILL");
      reapFallback ??= setTimeout(() => finish(forcedError), timeoutMs);
    }, timeoutMs);
  });
}

function parseVersion(output: string): string | undefined {
  return VERSION_PATTERN.exec(output)?.[1];
}

async function sha256File(path: string): Promise<string> {
  const handle = await open(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

function selectExactProfile(
  profiles: readonly PtyProfileDescriptor[],
  executable: string,
  version: string,
  fingerprint: string,
): PtyProfileDescriptor | undefined {
  return profiles.find((profile) => {
    const parsed = parsePtyProfileDescriptor(profile);
    return (
      parsed.ok &&
      profile.host.executable === executable &&
      profile.host.version === version &&
      profile.host.sha256 === fingerprint
    );
  });
}

function unavailableReport(): ClaudeCapabilityReport {
  return {
    status: "unavailable",
    capabilities: unsupportedCapabilities(),
    lifecycleHooksAdvertised: false,
    evidence: [],
    downgradeReasons: ["claude-executable-not-found"],
    missingHandshakeDimensions: [],
  };
}

function unsupportedReport(
  executable: string,
  version: string | undefined,
  fingerprint: string | undefined,
  hooks: boolean,
  reasons: readonly string[],
  missing: ClaudeCapabilityReport["missingHandshakeDimensions"] = [],
): ClaudeCapabilityReport {
  return {
    status: "present-unsupported",
    executable,
    ...(version === undefined ? {} : { version }),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    capabilities: unsupportedCapabilities(),
    lifecycleHooksAdvertised: hooks,
    evidence: ["bounded-public-probe"],
    downgradeReasons: reasons,
    missingHandshakeDimensions: missing,
  };
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return "probe-error";
}
