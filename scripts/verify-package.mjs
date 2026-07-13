import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "chat-suggestion-package-"),
);
const npmEnvironment = {
  ...process.env,
  npm_config_cache: join(temporaryDirectory, "npm-cache"),
};

try {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--pack-destination", temporaryDirectory, "--json"],
      { cwd: packageDirectory, encoding: "utf8", env: npmEnvironment },
    ),
  )[0];
  const fileNames = new Set(packResult.files.map(({ path }) => path));
  const requiredFiles = [
    "package.json",
    "README.md",
    "LICENSE",
    "src/production-extension.ts",
  ];

  for (const requiredFile of requiredFiles) {
    if (!fileNames.has(requiredFile)) {
      throw new Error(`packed artifact is missing ${requiredFile}`);
    }
  }

  execFileSync(
    "tar",
    [
      "-xzf",
      join(temporaryDirectory, packResult.filename),
      "-C",
      temporaryDirectory,
    ],
    { stdio: "ignore" },
  );
  const installedPackage = join(temporaryDirectory, "package");
  const manifest = JSON.parse(
    readFileSync(join(installedPackage, "package.json"), "utf8"),
  );
  if (
    manifest.name !== "@chat-suggestion/adapter-pi" ||
    manifest.private ||
    !manifest.pi?.extensions?.includes("./src/production-extension.ts")
  ) {
    throw new Error(
      "installed package has the wrong identity, is private, or lacks its Pi entry",
    );
  }

  console.log(`verified ${manifest.name}@${manifest.version}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
