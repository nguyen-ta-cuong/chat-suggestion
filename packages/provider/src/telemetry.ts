import type { ProviderErrorCode } from "./errors.js";

export type ProviderStatusClass =
  "success" | "client-error" | "server-error" | "network-error" | "cancelled";

export type ByteBucket = "0" | "1-1024" | "1025-8192" | "8193-65536" | "65537+";

export interface ProviderTelemetryEvent {
  readonly statusClass: ProviderStatusClass;
  readonly durationMs: number;
  readonly requestBytes: ByteBucket;
  readonly responseBytes: ByteBucket;
  readonly errorCode?: ProviderErrorCode | "no-content";
}

export type ProviderTelemetrySink = (event: ProviderTelemetryEvent) => void;

export function bucketBytes(bytes: number): ByteBucket {
  if (bytes === 0) return "0";
  if (bytes <= 1_024) return "1-1024";
  if (bytes <= 8_192) return "1025-8192";
  if (bytes <= 65_536) return "8193-65536";
  return "65537+";
}
