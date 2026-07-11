import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

describe("chat-suggest CLI", () => {
  it("runs an offline fake-provider demo without submission", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(
      ["demo", "--provider", "fake"],
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      },
      process.cwd(),
    );

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const output = JSON.parse(stdout.join("")) as {
      suggestion: string;
      acceptedDraft: string;
      submitted: boolean;
    };
    expect(output.suggestion).toBe(" tests and add a regression test");
    expect(output.acceptedDraft).toBe(
      "fix the failing auth tests and add a regression test",
    );
    expect(output.submitted).toBe(false);
  });

  it("fails closed before launching an unprofiled PTY command", async () => {
    const stderr: string[] = [];
    const code = await runCli(
      ["wrap", "--experimental-pty", "--", "codex"],
      { stdout: () => undefined, stderr: (value) => stderr.push(value) },
      process.cwd(),
    );

    expect(code).toBe(1);
    expect(stderr.join(" ")).toContain("host.experimentalPty=true");
  });

  it("applies --provider fake before validating remote configuration", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "chat-suggest-cli-"));
    try {
      await writeFile(
        join(cwd, ".chat-suggestion.json"),
        JSON.stringify({ provider: "openai-compatible" }),
      );
      const stdout: string[] = [];
      const code = await runCli(
        ["demo", "--provider", "fake"],
        { stdout: (value) => stdout.push(value), stderr: () => undefined },
        cwd,
      );

      expect(code).toBe(0);
      expect(stdout.join(" ")).toContain('"submitted": false');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
