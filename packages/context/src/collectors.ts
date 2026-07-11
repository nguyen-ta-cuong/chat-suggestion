import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { extname } from "node:path";

import type { ContextSourceKind } from "@chat-suggestion/protocol";

import { byteLength, truncateUtf8 } from "./bytes.js";
import { runGit } from "./git.js";
import { isDenied, resolveSafeFile } from "./paths.js";
import { redactSecrets } from "./redaction.js";
import type {
  CollectedSource,
  ContextAssemblyInput,
  ContextCollector,
  ContextPolicy,
  ExplicitAttachment,
  SelectedSnippet,
} from "./types.js";

const FILE_READ_LIMIT = 65_536;
const PROJECT_LIST_LIMIT = 2 * 1_024 * 1_024;

export function createCollectors(
  input: ContextAssemblyInput,
  policy: ContextPolicy,
): readonly ContextCollector[] {
  const collectors: ContextCollector[] = [];
  if (input.attachments !== undefined) {
    for (const [index, attachment] of [...input.attachments]
      .reverse()
      .entries()) {
      collectors.push(createAttachmentCollector(attachment, index, policy));
    }
  }
  collectors.push(...createPlanCollectors(input, policy));
  if (input.recentChat !== undefined && input.recentChat.length > 0) {
    collectors.push(createChatCollector(input));
  }
  if (projectContextAllowed(input, policy)) {
    collectors.push(...createSnippetCollectors(input, policy));
    collectors.push(...createReferenceCollectors(input, policy));
    collectors.push(createGitCollector(policy));
    collectors.push(createProjectCollector(policy));
  }
  return collectors;
}

function createAttachmentCollector(
  attachment: ExplicitAttachment,
  newestIndex: number,
  policy: ContextPolicy,
): ContextCollector {
  return textCollector(`attachment:${newestIndex}`, "attachment", () => {
    if (
      !attachment.explicit ||
      !attachment.textual ||
      attachment.content === undefined ||
      isDenied(attachment.name, policy.denyPatterns)
    ) {
      return null;
    }
    return `attachment ${safeLabel(attachment.name)}\n${attachment.content}`;
  });
}

function createPlanCollectors(
  input: ContextAssemblyInput,
  policy: ContextPolicy,
): readonly ContextCollector[] {
  if (!projectContextAllowed(input, policy)) {
    return [];
  }
  const allowed = new Set(policy.instructionAllowlist);
  const explicitCandidates = [...(input.planFiles ?? [])]
    .filter(
      (path) => allowed.has(path) || allowed.has(path.split("/").at(-1) ?? ""),
    )
    .reverse();
  const candidates = [
    ...explicitCandidates,
    ...policy.instructionAllowlist.filter(
      (path) => !explicitCandidates.includes(path),
    ),
  ];
  return [...new Set(candidates)].map((path, index) =>
    fileCollector(`plan:${index}`, "plan", path, policy),
  );
}

function createReferenceCollectors(
  input: ContextAssemblyInput,
  policy: ContextPolicy,
): readonly ContextCollector[] {
  return [...(input.referencedFiles ?? [])]
    .reverse()
    .map((path, index) =>
      fileCollector(`reference:${index}`, "project", path, policy),
    );
}

function createSnippetCollectors(
  input: ContextAssemblyInput,
  policy: ContextPolicy,
): readonly ContextCollector[] {
  return [...(input.selectedSnippets ?? [])]
    .reverse()
    .map((snippet, index) => createSnippetCollector(snippet, index, policy));
}

function createSnippetCollector(
  snippet: SelectedSnippet,
  newestIndex: number,
  policy: ContextPolicy,
): ContextCollector {
  return textCollector(`snippet:${newestIndex}`, "project", async () => {
    if (snippet.provenance.trim().length === 0) {
      return null;
    }
    const safePath = await resolveSafeFile(
      policy.repositoryRoot,
      snippet.relativePath,
      policy.denyPatterns,
    );
    if (safePath === null) {
      return null;
    }
    return `selected ${safePath.relativePath} (${safeLabel(snippet.provenance)})\n${snippet.content}`;
  });
}

function createChatCollector(input: ContextAssemblyInput): ContextCollector {
  return textCollector("recent-chat", "recent-chat", () => {
    const newestFirst = [...(input.recentChat ?? [])].reverse();
    return newestFirst
      .map((message) => `${safeLabel(message.role)}: ${message.content}`)
      .join("\n");
  });
}

function createGitCollector(policy: ContextPolicy): ContextCollector {
  return textCollector("git", "git", async (signal) => {
    const maximumBytes = policy.sourceByteLimits.git * 4;
    const [status, staged, unstaged] = await Promise.all([
      runGit(
        policy.repositoryRoot,
        ["status", "--short", "--untracked-files=no"],
        signal,
        maximumBytes,
      ),
      runGit(
        policy.repositoryRoot,
        ["diff", "--cached", "--no-ext-diff", "--no-color"],
        signal,
        maximumBytes,
      ),
      runGit(
        policy.repositoryRoot,
        ["diff", "--no-ext-diff", "--no-color"],
        signal,
        maximumBytes,
      ),
    ]);
    const sections: readonly (readonly [string, string])[] = [
      ["tracked status", status],
      ["staged diff", staged],
      ["unstaged diff", unstaged],
    ];
    return sections
      .filter(([, content]) => content.length > 0)
      .map(([label, content]) => `${label}\n${content.trimEnd()}`)
      .join("\n\n");
  });
}

function createProjectCollector(policy: ContextPolicy): ContextCollector {
  return textCollector("project", "project", async (signal) => {
    const output = await runGit(
      policy.repositoryRoot,
      ["ls-files", "-z"],
      signal,
      PROJECT_LIST_LIMIT,
    );
    const paths = output
      .split("\0")
      .filter((path) => path.length > 0 && !isDenied(path, policy.denyPatterns))
      .sort();
    const extensionCounts = new Map<string, number>();
    for (const path of paths) {
      const extension = extname(path).toLowerCase() || "[none]";
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
    }
    const languages = [...extensionCounts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([extension, count]) => `${extension}:${count}`)
      .join(", ");
    return `tracked files (${paths.length})\n${paths.join("\n")}\nlanguage indicators\n${languages}`;
  });
}

function fileCollector(
  sourceId: string,
  kind: ContextSourceKind,
  path: string,
  policy: ContextPolicy,
): ContextCollector {
  return textCollector(sourceId, kind, async (signal) => {
    const safePath = await resolveSafeFile(
      policy.repositoryRoot,
      path,
      policy.denyPatterns,
    );
    if (safePath === null) {
      return null;
    }
    const content = await readBoundedText(safePath.absolutePath, signal);
    return content === null
      ? null
      : `file ${safePath.relativePath}\n${content}`;
  });
}

function textCollector(
  sourceId: string,
  kind: ContextSourceKind,
  read: (signal: AbortSignal) => Promise<string | null> | string | null,
): ContextCollector {
  return {
    sourceId,
    kind,
    async collect(signal) {
      const startedAt = performance.now();
      const content = await Promise.resolve(read(signal));
      if (content === null || content.length === 0) {
        return null;
      }
      const originalBytes = byteLength(content);
      const redacted = redactSecrets(truncateUtf8(content, FILE_READ_LIMIT));
      const bounded = truncateUtf8(redacted.text, FILE_READ_LIMIT);
      return {
        sourceId,
        kind,
        content: bounded,
        originalBytes,
        redactionRuleIds: redacted.ruleIds,
        redactionCount: redacted.count,
        durationMs: performance.now() - startedAt,
      } satisfies CollectedSource;
    },
  };
}

async function readBoundedText(
  path: string,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(FILE_READ_LIMIT + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    signal.throwIfAborted();
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) {
      return null;
    }
    return decodeUtf8Prefix(bytes, bytesRead === buffer.length);
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  } finally {
    await file.close();
  }
}

function decodeUtf8Prefix(
  bytes: Uint8Array,
  mayEndMidCharacter: boolean,
): string | null {
  const maximumRemovedBytes = mayEndMidCharacter
    ? Math.min(3, bytes.length)
    : 0;
  for (
    let removedBytes = 0;
    removedBytes <= maximumRemovedBytes;
    removedBytes += 1
  ) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, bytes.length - removedBytes),
      );
    } catch {
      // A bounded read can split only the final UTF-8 code point.
    }
  }
  return null;
}

function projectContextAllowed(
  input: ContextAssemblyInput,
  policy: ContextPolicy,
): boolean {
  return !policy.requireTrustedProject || input.trustedProject;
}

function safeLabel(value: string): string {
  return value.replace(/[\r\n\t\0]/gu, " ").slice(0, 256);
}

export function collectorCacheKey(
  collector: ContextCollector,
  input: ContextAssemblyInput,
  policy: ContextPolicy,
): string | null {
  if (collector.kind === "git") {
    return null;
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        sourceId: collector.sourceId,
        repositoryRoot: policy.repositoryRoot,
        trustedProject: input.trustedProject,
        recentChat: input.recentChat,
        attachments: input.attachments,
        planFiles: input.planFiles,
        referencedFiles: input.referencedFiles,
        selectedSnippets: input.selectedSnippets,
      }),
      "utf8",
    )
    .digest("hex");
  return `${collector.kind}:${digest}`;
}
