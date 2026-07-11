import { spawn } from "node:child_process";

export type BoundedProcessResult =
  | {
      readonly ok: true;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly ok: false;
      readonly kind: "exit" | "output-limit" | "spawn" | "timeout";
      readonly detail: string;
    };

export interface BoundedProcessOptions {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export function runBoundedProcess(
  executable: string,
  arguments_: readonly string[],
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let settled = false;
    let forcedFailure: BoundedProcessResult | undefined;
    function finish(result: BoundedProcessResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }
    const terminate = (failure: BoundedProcessResult): void => {
      if (forcedFailure !== undefined || settled) return;
      forcedFailure = failure;
      clearTimeout(timer);
      child.kill("SIGKILL");
    };
    const terminateForLimit = (): void => {
      terminate({
        ok: false,
        kind: "output-limit",
        detail: "process output exceeded the configured byte limit",
      });
    };
    const append = (current: Buffer, chunk: Buffer): Buffer => {
      const next = Buffer.concat([current, chunk]);
      if (
        stdout.length + stderr.length + chunk.length >
        options.maxOutputBytes
      ) {
        terminateForLimit();
      }
      return next.subarray(0, options.maxOutputBytes);
    };
    const timer = setTimeout(() => {
      terminate({
        ok: false,
        kind: "timeout",
        detail: "process exceeded the configured timeout",
      });
    }, options.timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      finish(
        forcedFailure ?? {
          ok: false,
          kind: "spawn",
          detail: error.message,
        },
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (forcedFailure !== undefined) {
        finish(forcedFailure);
        return;
      }
      if (code !== 0) {
        finish({
          ok: false,
          kind: "exit",
          detail: `process exited with code ${String(code)} signal ${String(signal)}`,
        });
        return;
      }
      finish({
        ok: true,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
  });
}
