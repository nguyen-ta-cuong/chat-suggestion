declare module "@earendil-works/pi-tui" {
  export const CURSOR_MARKER: string;

  export interface TUI {
    readonly terminal: { readonly rows: number; readonly columns: number };
    requestRender(): void;
  }

  export interface EditorTheme {
    borderColor(value: string): string;
    readonly selectList: object;
  }

  export function sliceByColumn(
    value: string,
    start: number,
    end?: number,
  ): string;
  export function truncateToWidth(
    value: string,
    width: number,
    ellipsis?: string,
  ): string;
  export function visibleWidth(value: string): number;
}

declare module "@earendil-works/pi-coding-agent" {
  import type { Message } from "@earendil-works/pi-ai/compat";
  import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

  export const VERSION: string;

  export interface PiModelRegistry {
    getApiKeyAndHeaders(model: unknown): Promise<
      | {
          ok: true;
          apiKey?: string;
          headers?: Record<string, string>;
          env?: Record<string, string>;
        }
      | { ok: false; error: string }
    >;
  }

  export interface KeybindingsManager {
    matches(data: string, action: string): boolean;
  }

  export class CustomEditor {
    protected readonly tui: TUI;
    focused: boolean;
    onSubmit?: (text: string) => void;
    onChange?: (text: string) => void;
    onEscape?: () => void;
    constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager);
    handleInput(data: string): void;
    render(width: number): string[];
    invalidate(): void;
    getText(): string;
    getLines(): string[];
    getCursor(): { line: number; col: number };
    setText(text: string): void;
    insertTextAtCursor(text: string): void;
    isShowingAutocomplete(): boolean;
  }

  export type EditorFactory = (
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ) => CustomEditor;

  export interface ReadonlySessionManager {
    getSessionId(): string;
    buildContextEntries(): readonly unknown[];
  }

  export interface ExtensionUIContext {
    readonly theme: { fg(color: "dim" | "muted", text: string): string };
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
    setEditorComponent(factory: EditorFactory | undefined): void;
    getEditorComponent(): EditorFactory | undefined;
  }

  export interface ExtensionContext {
    readonly mode: "tui" | "rpc" | "json" | "print";
    readonly cwd: string;
    readonly ui: ExtensionUIContext;
    readonly sessionManager: ReadonlySessionManager;
    readonly modelRegistry: PiModelRegistry;
    readonly model: unknown;
  }

  export interface ExtensionAPI {
    on(
      event: string,
      handler: (
        event: unknown,
        context: ExtensionContext,
      ) => void | Promise<void>,
    ): void;
    registerCommand(
      name: string,
      command: {
        readonly description: string;
        readonly handler: (
          args: string,
          context: ExtensionContext,
        ) => void | Promise<void>;
      },
    ): void;
  }

  export function sessionEntryToContextMessages(entry: unknown): unknown[];
  export function convertToLlm(messages: unknown[]): Message[];
}

declare module "@earendil-works/pi-ai/compat" {
  export interface TextContent {
    readonly type: "text";
    readonly text: string;
  }

  export interface Message {
    readonly role: "user";
    readonly content: string | readonly TextContent[];
    readonly timestamp: number;
  }

  export interface CompletionOptions {
    readonly signal?: AbortSignal;
    readonly maxTokens?: number;
    readonly temperature?: number;
    readonly sessionId?: string;
    readonly apiKey?: string;
    readonly headers?: Record<string, string>;
    readonly env?: Record<string, string>;
  }

  export interface AssistantMessage {
    readonly content: readonly TextContent[];
    readonly stopReason: string;
    readonly usage?: { readonly output?: number };
  }

  export type AssistantMessageEvent =
    | {
        readonly type: "text_delta";
        readonly contentIndex: number;
        readonly delta: string;
        readonly partial: AssistantMessage;
      }
    | {
        readonly type: "text_end";
        readonly contentIndex: number;
        readonly content: string;
        readonly partial: AssistantMessage;
      }
    | {
        readonly type: "done";
        readonly reason: string;
        readonly message: AssistantMessage;
      }
    | {
        readonly type: "error";
        readonly reason: string;
        readonly error: AssistantMessage;
      };

  export function completeSimple(
    model: unknown,
    context: { systemPrompt?: string; messages: readonly Message[] },
    options?: CompletionOptions,
  ): Promise<AssistantMessage>;

  export function streamSimple(
    model: unknown,
    context: { systemPrompt?: string; messages: readonly Message[] },
    options?: CompletionOptions,
  ): AsyncIterable<AssistantMessageEvent>;
}
