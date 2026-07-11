import type {
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
} from "./types.js";

export function success<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function failure<T>(
  code: ValidationErrorCode,
  path: string,
  message: string,
): ValidationResult<T> {
  return { ok: false, error: { code, path, message } };
}

export function prefixError(
  prefix: string,
  error: ValidationError,
): ValidationError {
  return {
    ...error,
    path: error.path === "$" ? prefix : `${prefix}${error.path.slice(1)}`,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findUnknownKey(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): string | undefined {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).find((key) => !allowed.has(key));
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isBoundedString(
  value: unknown,
  maximumCharacters: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Array.from(value).length <= maximumCharacters
  );
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
