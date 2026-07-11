import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

const ALWAYS_DENIED_NAMES = new Set([
  ".git",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_rsa",
  "known_hosts",
]);

export interface SafePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export async function resolveSafeFile(
  repositoryRoot: string,
  requestedPath: string,
  denyPatterns: readonly string[],
): Promise<SafePath | null> {
  if (requestedPath.length === 0 || requestedPath.includes("\0")) {
    return null;
  }
  const root = await realpath(repositoryRoot);
  const candidate = isAbsolute(requestedPath)
    ? requestedPath
    : resolve(root, requestedPath);

  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    return null;
  }
  const relativePath = relative(root, resolved);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    isDenied(relativePath, denyPatterns)
  ) {
    return null;
  }

  const stats = await lstat(resolved);
  if (!stats.isFile()) {
    return null;
  }
  return { absolutePath: resolved, relativePath: normalize(relativePath) };
}

export function isDenied(
  relativePath: string,
  denyPatterns: readonly string[],
): boolean {
  const normalized = normalize(relativePath);
  const parts = normalized.split("/");
  const name = basename(normalized).toLowerCase();
  if (
    parts.includes(".git") ||
    name === ".env" ||
    name.startsWith(".env.") ||
    ALWAYS_DENIED_NAMES.has(name) ||
    /\.(?:key|p12|pfx|pem)$/iu.test(name)
  ) {
    return true;
  }
  return denyPatterns.some((pattern) => matchesPattern(normalized, pattern));
}

function matchesPattern(relativePath: string, rawPattern: string): boolean {
  const pattern = normalize(rawPattern).replace(/^\.\//u, "");
  if (pattern.length === 0) {
    return false;
  }
  if (!pattern.includes("*")) {
    return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
  }
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern.startsWith("**/", index)) {
      expression += "(?:.*/)?";
      index += 2;
    } else if (pattern.startsWith("**", index)) {
      expression += ".*";
      index += 1;
    } else if (pattern[index] === "*") {
      expression += "[^/]*";
    } else {
      expression += escapeRegExp(pattern[index] ?? "");
    }
  }
  return new RegExp(`^(?:${expression})$`, "u").test(relativePath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalize(value: string): string {
  return value.split(sep).join("/");
}
