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
  import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

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
}
