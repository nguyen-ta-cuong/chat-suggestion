import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDocuments = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "docs/user-guide.md",
  "docs/architecture.md",
  "docs/privacy.md",
  "docs/troubleshooting.md",
];

test("public documentation contains no internal planning references", () => {
  const text = publicDocuments
    .map((path) => readFileSync(join(root, path), "utf8"))
    .join("\n");

  assert.doesNotMatch(text, /\b(?:PRD|ExecPlan|implementation note)\b/u);
  assert.doesNotMatch(text, /(?:^|\/)plans\//u);
});

test("local Markdown links resolve", () => {
  const markdownLink = /\[[^\]]+\]\(([^)]+)\)/gu;

  for (const document of publicDocuments) {
    const sourcePath = join(root, document);
    const source = readFileSync(sourcePath, "utf8");
    for (const match of source.matchAll(markdownLink)) {
      const target = match[1];
      if (!target || /^(?:https?:|mailto:|#)/u.test(target)) continue;
      const path = target.split("#", 1)[0];
      assert.ok(
        path && existsSync(resolve(dirname(sourcePath), path)),
        `${document} links to missing ${target}`,
      );
    }
  }
});

test("README identifies Pi as the only supported host", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /supports \[Pi\].*only/isu);
  assert.match(readme, /never submitted or executed\s+automatically/isu);
});
