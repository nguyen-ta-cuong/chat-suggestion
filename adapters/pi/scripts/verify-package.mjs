import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const repositoryDir = fileURLToPath(new URL("../../..", import.meta.url));
const protocolDir = join(repositoryDir, "packages", "protocol");
const distEntry = join(packageDir, "dist", "production-extension.js");

if (!existsSync(distEntry)) {
  throw new Error("Build the workspace before running adapter-pi:test:package");
}

const tempDir = mkdtempSync(join(tmpdir(), "chat-suggestion-pi-package-"));
try {
  const pack = (cwd) => {
    const output = execFileSync(
      "npm",
      ["pack", "--pack-destination", tempDir, "--json"],
      { cwd, encoding: "utf8" },
    );
    return JSON.parse(output)[0].filename;
  };

  const protocolTarball = join(tempDir, pack(protocolDir));
  const adapterTarball = join(tempDir, pack(packageDir));
  const installDir = join(tempDir, "install");
  execFileSync("npm", ["init", "-y", "--prefix", installDir], {
    stdio: "ignore",
  });
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      installDir,
      "--omit=peer",
      "--ignore-scripts",
      protocolTarball,
      adapterTarball,
    ],
    { stdio: "ignore" },
  );

  const installedPackageDir = join(
    installDir,
    "node_modules",
    "@chat-suggestion",
    "adapter-pi",
  );
  const manifest = JSON.parse(
    readFileSync(join(installedPackageDir, "package.json"), "utf8"),
  );
  if (
    manifest.private ||
    !manifest.pi?.extensions?.includes("./dist/production-extension.js")
  ) {
    throw new Error("installed Pi package is not public or lacks its pi entry");
  }
  const productionEntry = readFileSync(
    join(installedPackageDir, "dist", "production-extension.js"),
    "utf8",
  );
  if (/\.\.?\//.test(productionEntry) && productionEntry.includes("src/")) {
    throw new Error("installed Pi entry contains a workspace source import");
  }
  console.log(`verified ${manifest.name}@${manifest.version}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
