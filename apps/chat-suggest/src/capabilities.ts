import {
  probeClaude,
  type ClaudeCapabilityReport,
} from "@chat-suggestion/adapter-claude";
import {
  probeCodexCapabilities,
  type CodexCapabilityReport,
} from "@chat-suggestion/adapter-codex";
import type { AdapterCapabilities } from "@chat-suggestion/protocol";

export interface CapabilityProbeDependencies {
  readonly codex?: () => Promise<CodexCapabilityReport>;
  readonly claude?: () => Promise<ClaudeCapabilityReport>;
}

export interface CapabilityStatus {
  readonly pi: {
    readonly state: "runtime-handshake-required";
    readonly capabilities: AdapterCapabilities;
    readonly downgradeReasons: readonly string[];
  };
  readonly codex: Record<string, unknown>;
  readonly claude: Record<string, unknown>;
}

const DISABLED_CAPABILITIES: AdapterCapabilities = Object.freeze({
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
});

export async function inspectCapabilities(
  dependencies: CapabilityProbeDependencies = {},
): Promise<CapabilityStatus> {
  const [codex, claude] = await Promise.all([
    (dependencies.codex ?? probeCodexCapabilities)(),
    (dependencies.claude ?? probeClaude)(),
  ]);
  return {
    pi: {
      state: "runtime-handshake-required",
      capabilities: DISABLED_CAPABILITIES,
      downgradeReasons: [
        "Pi native rendering is enabled only after a TUI custom-editor handshake.",
      ],
    },
    codex: summarizeCodex(codex),
    claude: summarizeClaude(claude),
  };
}

function summarizeCodex(
  report: CodexCapabilityReport,
): Record<string, unknown> {
  return {
    available: report.available,
    commandName: report.commandName,
    version: report.version,
    executableSource: report.executableSource,
    selection: report.selection,
    stockTui: report.stockTui,
    customFrontend: report.customFrontend,
    evidence: report.evidence,
    downgradeReasons: report.downgradeReasons,
    ptyProfileVerified: report.ptyProfile !== undefined,
  };
}

function summarizeClaude(
  report: ClaudeCapabilityReport,
): Record<string, unknown> {
  return {
    status: report.status,
    version: report.version,
    capabilities: report.capabilities,
    lifecycleHooksAdvertised: report.lifecycleHooksAdvertised,
    evidence: report.evidence,
    downgradeReasons: report.downgradeReasons,
    missingHandshakeDimensions: report.missingHandshakeDimensions,
    ptyProfileVerified: report.ptyProfile !== undefined,
  };
}
