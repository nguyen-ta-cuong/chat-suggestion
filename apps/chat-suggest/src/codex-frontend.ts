import type {
  CodexNotification,
  CodexServerRequest,
  CodexThreadStartOptions,
  CodexTurnStartOptions,
} from "@chat-suggestion/adapter-codex";
import { SuggestionCoordinator } from "@chat-suggestion/engine";
import {
  utf8ByteLength,
  type AdapterCapabilities,
  type Disposable,
  type PromptSnapshot,
  type SuggestionProvider,
} from "@chat-suggestion/protocol";
import { sanitizeTerminalText } from "@chat-suggestion/terminal";

import { CodexPromptEditor } from "./codex-editor.js";
import {
  CodexSuggestionProvider,
  type CodexSuggestionClient,
} from "./codex-suggestion-provider.js";
import type { ChatSuggestConfiguration } from "./config.js";
import { createSuggestionService, isTrustedProject } from "./service.js";

export interface CodexFrontendClient extends CodexSuggestionClient {
  initialize(): Promise<void>;
  startThread(options: CodexThreadStartOptions): Promise<{ threadId: string }>;
  startTurn(options: CodexTurnStartOptions): Promise<{ turnId: string }>;
  onNotification(listener: (value: CodexNotification) => void): Disposable;
  onRequest(listener: (value: CodexServerRequest) => void): Disposable;
  respond(id: number | string, result: unknown): void;
  respondError(id: number | string, code?: number, message?: string): void;
  close(): Promise<void>;
}

export interface CodexFrontendSessionOptions {
  readonly client: CodexFrontendClient;
  readonly provider?: SuggestionProvider;
  readonly collectContext?: boolean;
  readonly configuration: ChatSuggestConfiguration;
  readonly cwd: string;
  readonly codexVersion: string;
  readonly width: () => number;
  readonly write: (text: string) => void;
  readonly onExit: () => void;
}

export interface CodexFrontendState {
  readonly draft: string;
  readonly suggestion: string;
  readonly busy: boolean;
  readonly codingThreadId?: string;
  readonly activeTurnId?: string;
}

const CUSTOM_FRONTEND_CAPABILITIES: AdapterCapabilities = Object.freeze({
  transport: "app-server",
  inlineRender: "arbitrary",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: true,
  nativeCompletionAwareness: true,
  attachmentReferences: false,
});

const SUGGESTION_INSTRUCTIONS = [
  "Generate only a short missing suffix for an unfinished coding-agent prompt.",
  "Never call tools, inspect files, explain, quote the draft, or use Markdown.",
  "Return only the literal suffix to insert at the cursor, at most 160 characters and one line.",
].join(" ");

export class CodexFrontendSession {
  readonly #options: CodexFrontendSessionOptions;
  readonly #editor = new CodexPromptEditor();
  #provider: SuggestionProvider | undefined;
  #ownedProvider: CodexSuggestionProvider | undefined;
  #coordinator: SuggestionCoordinator | undefined;
  #codingThreadId: string | undefined;
  #activeTurnId: string | undefined;
  #subscriptions: Disposable[] = [];
  #started = false;
  #closed = false;

  constructor(options: CodexFrontendSessionOptions) {
    this.#options = options;
    this.#provider = options.provider;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    await this.#options.client.initialize();
    const coding = await this.#options.client.startThread({
      cwd: this.#options.cwd,
    });
    this.#codingThreadId = coding.threadId;
    if (this.#provider === undefined) {
      const suggestion = await this.#options.client.startThread({
        cwd: this.#options.cwd,
        ephemeral: true,
        baseInstructions: SUGGESTION_INSTRUCTIONS,
        approvalPolicy: "never",
        sandbox: "read-only",
        ...(this.#options.configuration.codexSuggestionModel === undefined
          ? {}
          : { model: this.#options.configuration.codexSuggestionModel }),
      });
      this.#ownedProvider = new CodexSuggestionProvider(
        this.#options.client,
        suggestion.threadId,
      );
      this.#provider = this.#ownedProvider;
    }
    this.#coordinator = this.#createCoordinator(this.#provider);
    this.#subscriptions = [
      this.#options.client.onNotification(this.#onNotification),
      this.#options.client.onRequest(this.#onRequest),
    ];
    this.#started = true;
    this.#options.write(
      "Chat Suggestion Codex frontend — Tab accepts ghost text, Escape dismisses, Enter sends, Ctrl-D exits.\n",
    );
    this.#publishInput();
    this.render();
  }

  handleInput(data: string): void {
    if (!this.#started || this.#closed) return;
    for (const event of splitInputEvents(data)) this.#handleInputEvent(event);
  }

  #handleInputEvent(data: string): void {
    const action = this.#editor.handleInput(data);
    switch (action.kind) {
      case "changed":
        this.#publishInput();
        this.render();
        break;
      case "accept-suggestion":
        if (this.#coordinator?.acceptAll() === true) {
          this.#publishInput();
          this.render();
        }
        break;
      case "dismissed":
        this.#coordinator?.dismiss();
        this.render();
        break;
      case "submit":
        void this.#submit();
        break;
      case "interrupt":
        void this.#interrupt();
        break;
      case "exit":
        this.#options.onExit();
        break;
      case "ignored":
        break;
    }
  }

  render(): void {
    if (!this.#started || this.#closed || this.#editor.busy()) return;
    this.#options.write(this.#editor.render(this.#options.width()));
  }

  state(): CodexFrontendState {
    return {
      draft: this.#editor.draft(),
      suggestion: this.#editor.suggestion(),
      busy: this.#editor.busy(),
      ...(this.#codingThreadId === undefined
        ? {}
        : { codingThreadId: this.#codingThreadId }),
      ...(this.#activeTurnId === undefined
        ? {}
        : { activeTurnId: this.#activeTurnId }),
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#subscriptions = [];
    this.#coordinator?.dispose();
    this.#ownedProvider?.dispose();
    this.#options.write("\r\u001b[2K\u001b[?25h");
    await this.#options.client.close();
  }

  #createCoordinator(provider: SuggestionProvider): SuggestionCoordinator {
    const service = createSuggestionService(
      this.#options.configuration,
      provider,
    );
    return new SuggestionCoordinator({
      provider,
      context: async (snapshot, signal) => {
        if (this.#options.collectContext !== true) {
          return { contributions: [] };
        }
        const result = await service.collect(
          {
            snapshot,
            trustedProject: isTrustedProject(
              snapshot.workingDirectory,
              this.#options.configuration,
            ),
          },
          signal,
        );
        return result.status === "collected"
          ? result.envelope
          : { contributions: [] };
      },
      surface: {
        capabilities: () => CUSTOM_FRONTEND_CAPABILITIES,
        show: (candidate) => {
          this.#editor.showSuggestion(candidate.edit.text);
          this.render();
        },
        clear: (reason) => {
          this.#editor.clearSuggestion(reason);
          this.render();
        },
        accept: (candidate) => {
          this.#editor.acceptSuggestion(candidate.edit.text);
        },
      },
      configuration: {
        debounceMs: this.#options.configuration.debounceMs,
        requestTimeoutMs: this.#options.configuration.codexSuggestionTimeoutMs,
        minimumPrefixCharacters:
          this.#options.configuration.minimumPrefixCharacters,
      },
    });
  }

  #publishInput(): void {
    const coordinator = this.#coordinator;
    const codingThreadId = this.#codingThreadId;
    if (coordinator === undefined || codingThreadId === undefined) return;
    const snapshot: PromptSnapshot = {
      revision: this.#editor.revision(),
      text: this.#editor.draft(),
      cursorByte: utf8ByteLength(this.#editor.draft()),
      host: {
        name: "chat-suggest-codex",
        version: this.#options.codexVersion,
      },
      capabilities: CUSTOM_FRONTEND_CAPABILITIES,
      workingDirectory: this.#options.cwd,
      sessionId: codingThreadId,
    };
    coordinator.update({
      snapshot,
      enabled: this.#options.configuration.enabled && !this.#editor.busy(),
      focused: true,
      hostIdle: !this.#editor.busy(),
      imeComposing: false,
      nativeCompletionVisible: false,
      hiddenInput: false,
      layoutKnown: this.#options.width() > 4,
    });
  }

  async #submit(): Promise<void> {
    const text = this.#editor.takeSubmission();
    const threadId = this.#codingThreadId;
    if (text === null || threadId === undefined) return;
    this.#editor.setBusy(true);
    this.#publishInput();
    this.#options.write("\n\n");
    try {
      const turn = await this.#options.client.startTurn({ threadId, text });
      this.#activeTurnId = turn.turnId;
    } catch (error) {
      this.#showError(error);
    }
  }

  async #interrupt(): Promise<void> {
    const threadId = this.#codingThreadId;
    const turnId = this.#activeTurnId;
    if (threadId === undefined || turnId === undefined) return;
    try {
      await this.#options.client.interruptTurn(threadId, turnId);
    } catch (error) {
      this.#showError(error);
    }
  }

  readonly #onNotification = (notification: CodexNotification): void => {
    if (!isRecord(notification.params)) return;
    if (notification.params.threadId !== this.#codingThreadId) return;
    if (notification.method === "item/agentMessage/delta") {
      if (
        typeof notification.params.delta === "string" &&
        (this.#activeTurnId === undefined ||
          notification.params.turnId === this.#activeTurnId)
      ) {
        this.#options.write(sanitizeAgentOutput(notification.params.delta));
      }
      return;
    }
    if (notification.method === "turn/completed") {
      const turn = notification.params.turn;
      if (!isRecord(turn) || typeof turn.id !== "string") return;
      if (this.#activeTurnId !== undefined && turn.id !== this.#activeTurnId) {
        return;
      }
      this.#activeTurnId = undefined;
      this.#editor.setBusy(false);
      this.#options.write("\n\n");
      this.#publishInput();
      this.render();
    }
  };

  readonly #onRequest = (request: CodexServerRequest): void => {
    if (
      request.method === "item/commandExecution/requestApproval" ||
      request.method === "item/fileChange/requestApproval"
    ) {
      this.#options.client.respond(request.id, { decision: "decline" });
      this.#options.write(
        "\n[Codex requested approval; this initial frontend declined it safely.]\n",
      );
      return;
    }
    this.#options.client.respondError(request.id);
  };

  #showError(error: unknown): void {
    this.#activeTurnId = undefined;
    this.#editor.setBusy(false);
    const message =
      error instanceof Error ? error.message : "Codex request failed.";
    this.#options.write(`\n[${sanitizeAgentOutput(message)}]\n`);
    this.#publishInput();
    this.render();
  }
}

function sanitizeAgentOutput(value: string): string {
  return sanitizeTerminalText(value, {
    maxBytes: 8 * 1024,
    maxCharacters: 8 * 1024,
    maxLines: 200,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function splitInputEvents(data: string): string[] {
  if (data.length === 0) return [];
  if (data.startsWith("\u001b[200~") && data.endsWith("\u001b[201~")) {
    return [data];
  }
  const events: string[] = [];
  let printable = "";
  const flush = (): void => {
    if (printable.length > 0) events.push(printable);
    printable = "";
  };
  for (let index = 0; index < data.length; index += 1) {
    const character = data[index];
    if (character === "\u001b") {
      flush();
      events.push(data.slice(index));
      break;
    }
    if (
      character === "\u0003" ||
      character === "\u0004" ||
      character === "\t" ||
      character === "\r" ||
      character === "\n" ||
      character === "\u007f" ||
      character === "\b"
    ) {
      flush();
      events.push(character);
    } else if (character !== undefined) {
      printable += character;
    }
  }
  flush();
  return events;
}
