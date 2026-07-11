export type ProviderErrorCode =
  | "aborted"
  | "configuration"
  | "cooldown"
  | "http-client"
  | "http-server"
  | "invalid-response"
  | "network"
  | "rate-limited"
  | "timeout"
  | "unsafe-output";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
