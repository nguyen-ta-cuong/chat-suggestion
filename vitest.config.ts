import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const globalNodeModules = execFileSync("npm", ["root", "-g"], {
  encoding: "utf8",
}).trim();
const piRoot = join(globalNodeModules, "@earendil-works", "pi-coding-agent");
const piEntry = join(piRoot, "dist", "index.js");
const tuiEntry = join(
  piRoot,
  "node_modules",
  "@earendil-works",
  "pi-tui",
  "dist",
  "index.js",
);
const piAiEntry = join(
  piRoot,
  "node_modules",
  "@earendil-works",
  "pi-ai",
  "dist",
  "compat.js",
);

if (!existsSync(piEntry) || !existsSync(tuiEntry) || !existsSync(piAiEntry)) {
  throw new Error(
    "Pi public-API tests require an installed @earendil-works/pi-coding-agent; checked npm root -g",
  );
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@earendil-works/pi-coding-agent": piEntry,
      "@earendil-works/pi-tui": tuiEntry,
      "@earendil-works/pi-ai/compat": piAiEntry,
    },
  },
});
