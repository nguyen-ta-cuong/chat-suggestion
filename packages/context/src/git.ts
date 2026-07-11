import { execFile } from "node:child_process";

export function runGit(
  repositoryRoot: string,
  arguments_: readonly string[],
  signal: AbortSignal,
  maximumBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...arguments_],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: Math.max(1, maximumBytes),
        signal,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(
            error instanceof Error
              ? error
              : new Error("Git context collection failed"),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}
