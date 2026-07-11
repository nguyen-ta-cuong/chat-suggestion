import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type {
  CodexExecutableSource,
  CodexResolution,
  CodexResolutionOptions,
} from "./types.js";

export async function resolveCodexExecutable(
  options: CodexResolutionOptions = {},
): Promise<CodexResolution> {
  const candidates = buildCandidates(options);
  for (const candidate of candidates) {
    if (await isRegularExecutable(candidate.executable)) {
      return { available: true, ...candidate };
    }
  }
  return {
    available: false,
    reason: "No regular executable Codex binary was found.",
  };
}

function buildCandidates(
  options: CodexResolutionOptions,
): readonly { executable: string; source: CodexExecutableSource }[] {
  const candidates: { executable: string; source: CodexExecutableSource }[] =
    [];
  if (options.explicitPath !== undefined) {
    candidates.push({ executable: options.explicitPath, source: "explicit" });
  }
  const pathEnvironment = options.pathEnvironment ?? process.env.PATH ?? "";
  for (const directory of pathEnvironment.split(delimiter)) {
    if (directory !== "") {
      candidates.push({ executable: join(directory, "codex"), source: "path" });
    }
  }
  for (const executable of options.bundlePaths ?? []) {
    candidates.push({ executable, source: "bundle" });
  }
  return candidates;
}

async function isRegularExecutable(file: string): Promise<boolean> {
  try {
    const metadata = await stat(file);
    if (!metadata.isFile()) {
      return false;
    }
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
