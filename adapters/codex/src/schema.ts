import { open, rm } from "node:fs/promises";
import { join } from "node:path";

import { runBoundedProcess, type BoundedProcessOptions } from "./process.js";

const MAX_SCHEMA_BYTES = 32 * 1_024;

export async function probeInitializeSchema(
  executable: string,
  schemaDirectory: string,
  processOptions: BoundedProcessOptions,
): Promise<boolean> {
  try {
    const result = await runBoundedProcess(
      executable,
      ["app-server", "generate-json-schema", "--out", schemaDirectory],
      processOptions,
    );
    if (!result.ok) return false;
    const schema = await readBoundedJson(
      join(schemaDirectory, "v1", "InitializeParams.json"),
    );
    return isCompatibleInitializeSchema(schema);
  } catch {
    return false;
  } finally {
    await rm(schemaDirectory, { force: true, recursive: true });
  }
}

async function readBoundedJson(file: string): Promise<unknown> {
  const handle = await open(file, "r");
  try {
    const bytes = Buffer.alloc(MAX_SCHEMA_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_SCHEMA_BYTES) {
      throw new RangeError("Initialize schema exceeds the read limit.");
    }
    return JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

function isCompatibleInitializeSchema(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const schema = input as Record<string, unknown>;
  return (
    schema.title === "InitializeParams" &&
    Array.isArray(schema.required) &&
    schema.required.includes("clientInfo")
  );
}
