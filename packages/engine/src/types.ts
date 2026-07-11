import type {
  ContextEnvelope,
  PromptSnapshot,
  SuggestionProvider,
  SuggestionSurface,
} from "@chat-suggestion/protocol";

export interface SuggestionInput {
  readonly snapshot: PromptSnapshot;
  readonly enabled: boolean;
  readonly focused: boolean;
  readonly hostIdle: boolean;
  readonly imeComposing: boolean;
  readonly nativeCompletionVisible: boolean;
  readonly hiddenInput: boolean;
  readonly layoutKnown: boolean;
}

export interface SuggestionConfiguration {
  readonly debounceMs: number;
  readonly requestTimeoutMs: number;
  readonly minimumPrefixCharacters: number;
}

export type CoordinatorPhase =
  "idle" | "debouncing" | "collecting" | "generating" | "visible" | "disposed";

export interface CoordinatorState {
  readonly phase: CoordinatorPhase;
  readonly revision?: number;
  readonly requestId?: string;
}

export type MetricName =
  | "request-scheduled"
  | "collection-started"
  | "generation-started"
  | "suggestion-visible"
  | "stale-result"
  | "request-timeout"
  | "request-error"
  | "suggestion-dismissed"
  | "suggestion-accepted";

export interface SuggestionMetric {
  readonly name: MetricName;
  readonly durationMs?: number;
  readonly count?: number;
  readonly bytes?: number;
}

export interface SuggestionMetrics {
  record(metric: SuggestionMetric): void;
}

export type TimerHandle = object | number;

export interface SuggestionScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export type RequestIdFactory = () => string;

export type ContextLoader = (
  snapshot: PromptSnapshot,
  signal: AbortSignal,
) => Promise<ContextEnvelope>;

export interface SuggestionCoordinatorDependencies {
  readonly provider: SuggestionProvider;
  readonly context: ContextLoader;
  readonly surface: SuggestionSurface;
  readonly scheduler?: SuggestionScheduler;
  readonly requestId?: RequestIdFactory;
  readonly metrics?: SuggestionMetrics;
  readonly configuration?: Partial<SuggestionConfiguration>;
}
