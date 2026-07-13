import type {
  EditorFactory,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  PiSuggestionEditor,
  type PiEditorOptions,
  type SuggestionBridge,
} from "./pi-suggestion-editor.js";

const STATUS_KEY = "chat-suggestion";

export interface PiSuggestionExtensionOptions {
  readonly bridge: SuggestionBridge;
  readonly debounceMs?: number;
  readonly initiallyEnabled?: boolean;
}

export function createPiSuggestionExtension(
  options: PiSuggestionExtensionOptions,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    let activeEditor: PiSuggestionEditor | undefined;
    let installedFactory: EditorFactory | undefined;
    let enabled = options.initiallyEnabled ?? true;
    let capability: "eol-only" | "none" = "none";
    let downgradeReason = "not initialized";

    const clearActive = (
      reason: Parameters<PiSuggestionEditor["clear"]>[0],
    ): void => {
      activeEditor?.clear(reason);
    };

    const installForSession = (context: ExtensionContext): void => {
      if (context.mode !== "tui") {
        capability = "none";
        downgradeReason = `Pi mode ${context.mode} has no TUI editor component`;
        return;
      }

      const previousFactory = context.ui.getEditorComponent();
      if (previousFactory) {
        capability = "none";
        downgradeReason = "another extension already owns the custom editor";
        context.ui.setStatus(
          STATUS_KEY,
          "suggestions: disabled (editor conflict)",
        );
        return;
      }

      const editorOptions: Omit<PiEditorOptions, "keybindings" | "styleDim"> = {
        bridge: options.bridge,
        enabled,
        ...(options.debounceMs === undefined
          ? {}
          : { debounceMs: options.debounceMs }),
      };

      const factory: EditorFactory = (tui, theme, keybindings) => {
        activeEditor?.dispose();
        activeEditor = new PiSuggestionEditor(tui, theme, {
          ...editorOptions,
          keybindings,
          styleDim: (text) => context.ui.theme.fg("dim", text),
        });
        return activeEditor;
      };
      installedFactory = factory;
      context.ui.setEditorComponent(factory);
      capability = "eol-only";
      downgradeReason = "";
      context.ui.setStatus(
        STATUS_KEY,
        enabled ? "suggestions: eol-only" : "suggestions: off",
      );
    };

    const uninstallForSession = (context: ExtensionContext): void => {
      activeEditor?.dispose();
      activeEditor = undefined;
      if (
        installedFactory &&
        context.ui.getEditorComponent() === installedFactory
      ) {
        context.ui.setEditorComponent(undefined);
      }
      installedFactory = undefined;
      context.ui.setStatus(STATUS_KEY, undefined);
    };

    pi.on("session_start", (_event, context) => {
      installForSession(context);
    });
    pi.on("session_shutdown", (_event, context) => {
      uninstallForSession(context);
    });
    pi.on("input", () => {
      clearActive("submitted");
    });
    pi.on("agent_start", () => {
      clearActive("unsafe");
    });
    pi.on("model_select", () => {
      clearActive("unsafe");
    });
    pi.on("session_before_switch", () => {
      clearActive("session-changed");
    });
    pi.on("session_before_fork", () => {
      clearActive("session-changed");
    });

    pi.registerCommand("chat-suggest", {
      description: "Enable, disable, or report inline prompt suggestions",
      handler: (args, context) => {
        const action = args.trim().toLowerCase();
        if (action === "on") {
          enabled = true;
          activeEditor?.setEnabled(true);
          context.ui.setStatus(
            STATUS_KEY,
            capability === "eol-only"
              ? "suggestions: eol-only"
              : "suggestions: disabled",
          );
          return;
        }
        if (action === "off") {
          enabled = false;
          activeEditor?.setEnabled(false);
          context.ui.setStatus(STATUS_KEY, "suggestions: off");
          return;
        }

        const detail =
          capability === "eol-only"
            ? "native eol-only"
            : `none: ${downgradeReason}`;
        context.ui.notify(
          `Chat suggestions: ${enabled ? "on" : "off"}; capability ${detail}`,
          "info",
        );
      },
    });
  };
}
