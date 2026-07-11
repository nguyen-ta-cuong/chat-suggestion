import { createRequire } from "node:module";
import { Buffer } from "node:buffer";

import type { Disposable } from "@chat-suggestion/protocol";

import type { PtyBackend, PtyChild, PtyExitEvent } from "./types.js";

interface NodePtyProcess {
  write(data: string | Buffer): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string | Buffer) => void): Disposable;
  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void,
  ): Disposable;
}

interface NodePtyModule {
  spawn(
    executable: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
      encoding: null;
    },
  ): NodePtyProcess;
}

export class PtyDependencyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PtyDependencyError";
  }
}

export function createNodePtyBackend(
  platform: NodeJS.Platform = process.platform,
): PtyBackend {
  if (platform !== "darwin" && platform !== "linux") {
    throw new PtyDependencyError(
      `node-pty fallback is supported only on darwin and linux; received ${platform}`,
    );
  }
  const require = createRequire(import.meta.url);
  let module: NodePtyModule;
  try {
    module = require("node-pty") as NodePtyModule;
  } catch (error) {
    throw new PtyDependencyError(
      "Optional dependency node-pty is unavailable; PTY fallback is disabled.",
      { cause: error },
    );
  }
  return {
    name: "node-pty",
    supportedPlatforms: ["darwin", "linux"],
    spawn(executable, args, options) {
      return wrapNodePtyChild(
        module.spawn(executable, [...args], {
          cwd: options.cwd,
          env: { ...options.env },
          cols: options.columns,
          rows: options.rows,
          encoding: null,
        }),
      );
    },
  };
}

function wrapNodePtyChild(child: NodePtyProcess): PtyChild {
  return {
    write(data) {
      child.write(Buffer.from(data));
    },
    resize(columns, rows) {
      child.resize(columns, rows);
    },
    kill(signal) {
      child.kill(signal);
    },
    onData(listener) {
      return child.onData((data) => {
        listener(typeof data === "string" ? Buffer.from(data, "utf8") : data);
      });
    },
    onExit(listener) {
      return child.onExit((event) => {
        listener(toExitEvent(event));
      });
    },
  };
}

function toExitEvent(event: {
  exitCode: number;
  signal?: number;
}): PtyExitEvent {
  return event.signal === undefined
    ? { exitCode: event.exitCode }
    : { exitCode: event.exitCode, signal: event.signal };
}
