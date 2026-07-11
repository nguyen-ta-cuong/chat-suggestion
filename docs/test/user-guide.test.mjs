/* eslint-disable */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const guidePath = join(root, "docs/user-guide.md");
const manifestPath = join(root, "docs/test/user-guide-command-manifest.json");
const cliPath = join(root, "apps/chat-suggest/dist/cli.js");
const secretPattern =
  /(?:sk-[A-Za-z0-9]{16,}|authorization:\s*bearer|api[_-]?key\s*[:=]\s*[^<\s][^\s]*)/iu;
const privatePathPattern = /\/(?:Users|home)\/[^/\s]+\//u;

function run(command, arguments_, options = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolveResult({ status, output }));
  });
}

function cliArguments(command) {
  const prefix = "npm run chat-suggest -- ";
  assert.ok(
    command.startsWith(prefix),
    `unsupported offline command: ${command}`,
  );
  return command.slice(prefix.length).split(" ");
}

test("user guide has a complete safe command manifest and valid local links", async () => {
  const [guide, manifestText] = await Promise.all([
    readFile(guidePath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.schemaVersion, 1);
  for (const entry of manifest.commands) {
    assert.match(entry.id, /^[a-z0-9-]+$/u);
    assert.match(
      guide,
      new RegExp(`<!-- user-guide-command: ${entry.id} -->`, "u"),
    );
    assert.ok(
      guide.includes(entry.command),
      `${entry.id} command is not published`,
    );
    assert.ok(
      ["offline", "manual-host", "remote-opt-in"].includes(entry.safetyClass),
    );
  }
  assert.match(guide, /Remote provider: explicit opt-in/u);
  assert.match(guide, /Experimental PTY/u);
  assert.match(guide, /stock Codex\s+TUI.*not\s+supported/isu);
  assert.match(guide, /stock Claude\s+TUI.*not\s+supported/isu);
  assert.match(guide, /durable\s+Pi\s+installation\s+is\s+unavailable/iu);
  assert.equal(secretPattern.test(guide), false);
  assert.equal(privatePathPattern.test(guide), false);

  for (const [, target] of guide.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    if (/^(?:https?:|#|mailto:)/u.test(target)) continue;
    const local = resolve(dirname(guidePath), target);
    assert.equal(
      relative(root, local).startsWith(".."),
      false,
      `link escapes repository: ${target}`,
    );
    await readFile(local);
  }
});

test("offline guide commands run without provider credentials", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "chat-suggestion-guide-"),
  );
  const environment = {
    ...process.env,
    PATH: process.env.PATH,
    CHAT_SUGGEST_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
  };
  try {
    for (const entry of manifest.commands.filter(
      (candidate) => candidate.safetyClass === "offline",
    )) {
      const result =
        entry.id === "build"
          ? await run("npm", ["run", "build"], { env: environment })
          : await run(
              process.execPath,
              [cliPath, ...cliArguments(entry.command)],
              { cwd: temporaryDirectory, env: environment },
            );
      assert.equal(
        result.status,
        entry.expectedExitStatus,
        `${entry.id}: ${result.output}`,
      );
      assert.match(
        result.output,
        new RegExp(entry.redactedOutputPattern, "u"),
        entry.id,
      );
      assert.equal(secretPattern.test(result.output), false, entry.id);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("manual and remote commands have evidence but are never executed", async () => {
  const [manifestText, evidence] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(
      join(root, "docs/verification/user-guide-command-evidence.md"),
      "utf8",
    ),
  ]);
  const manifest = JSON.parse(manifestText);
  for (const entry of manifest.commands.filter(
    (candidate) => candidate.safetyClass !== "offline",
  )) {
    assert.ok(
      evidence.includes(`\`${entry.id}\``),
      `missing evidence for ${entry.id}`,
    );
  }
  assert.equal(secretPattern.test(evidence), false);
  assert.equal(privatePathPattern.test(evidence), false);
});
