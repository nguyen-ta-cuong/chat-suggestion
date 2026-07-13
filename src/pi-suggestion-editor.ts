import {
  PROTOCOL_VERSION,
  MAX_DRAFT_BYTES,
  parseSuggestionCandidate,
  utf8ByteLength,
  type AdapterCapabilities,
  type ClearReason,
  type PromptSnapshot,
  type SuggestionCandidate,
} from "./suggestion.js";
import {
  CustomEditor,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { decorateEolGhostLine } from "./render-ghost.js";

export const PI_NATIVE_CAPABILITIES: AdapterCapabilities = Object.freeze({
  transport: "native",
  inlineRender: "eol-only",
  bufferRead: true,
  cursorRead: true,
  atomicAcceptance: true,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: true,
  nativeCompletionAwareness: true,
  attachmentReferences: false,
});

export const DEFAULT_DEBOUNCE_MS = 250;
export const DEFAULT_MINIMUM_DRAFT_CHARACTERS = 3;

export interface SuggestionBridge {
  suggest(
    snapshot: PromptSnapshot,
    requestId: string,
    signal: AbortSignal,
    onUpdate?: (candidate: SuggestionCandidate) => void,
  ): Promise<SuggestionCandidate | null>;
}

export interface PiEditorOptions {
  readonly bridge: SuggestionBridge;
  readonly keybindings: KeybindingsManager;
  readonly styleDim: (text: string) => string;
  readonly debounceMs?: number;
  readonly minimumDraftCharacters?: number;
  readonly enabled?: boolean;
  readonly onClear?: (reason: ClearReason) => void;
}

interface EditorPosition {
  readonly text: string;
  readonly line: number;
  readonly col: number;
}

interface CurrentCandidateState {
  readonly candidate: SuggestionCandidate;
  readonly snapshot: PromptSnapshot;
}

export class PiSuggestionEditor extends CustomEditor {
  private readonly bridge: SuggestionBridge;
  private readonly keybindings: KeybindingsManager;
  private readonly styleDim: (text: string) => string;
  private readonly debounceMs: number;
  private readonly minimumDraftCharacters: number;
  private readonly onClear: ((reason: ClearReason) => void) | undefined;
  private revision = 0;
  private requestSequence = 0;
  private enabled: boolean;
  private currentCandidate: CurrentCandidateState | undefined;
  private renderedCandidate: SuggestionCandidate | undefined;
  private generation: AbortController | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pasteInProgress = false;
  private disposed = false;

  constructor(tui: TUI, theme: EditorTheme, options: PiEditorOptions) {
    super(tui, theme, options.keybindings);
    this.bridge = options.bridge;
    this.keybindings = options.keybindings;
    this.styleDim = options.styleDim;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.minimumDraftCharacters = Math.max(
      0,
      Math.floor(
        options.minimumDraftCharacters ?? DEFAULT_MINIMUM_DRAFT_CHARACTERS,
      ),
    );
    this.enabled = options.enabled ?? true;
    this.onClear = options.onClear;
  }

  capabilities(): AdapterCapabilities {
    return PI_NATIVE_CAPABILITIES;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear("disabled");
    }
  }

  clear(reason: ClearReason, requestRender = true): void {
    const hadWork =
      this.currentCandidate !== undefined ||
      this.generation !== undefined ||
      this.debounceTimer !== undefined;
    this.cancelPending();
    this.resetCandidate();
    if (hadWork) {
      this.onClear?.(reason);
      if (requestRender) this.tui.requestRender();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear("disabled");
  }

  override handleInput(data: string): void {
    const autocompleteVisible = this.isShowingAutocomplete();
    const pasteStarted = data.includes("\u001b[200~");
    if (pasteStarted) {
      this.pasteInProgress = true;
      this.clear("pasted");
    }

    if (
      !autocompleteVisible &&
      this.focused &&
      this.renderedCandidate &&
      this.keybindings.matches(data, "tui.input.tab")
    ) {
      this.acceptCurrentCandidate(this.renderedCandidate);
      return;
    }

    if (
      !autocompleteVisible &&
      (this.currentCandidate || this.generation || this.debounceTimer) &&
      this.keybindings.matches(data, "app.interrupt")
    ) {
      this.clear("dismissed");
      return;
    }

    const before = this.capturePosition();
    const stateBeforeInput = this.currentCandidate;
    const candidateBeforeEdit = stateBeforeInput?.candidate;
    const hadWorkBeforeInput =
      stateBeforeInput !== undefined ||
      this.generation !== undefined ||
      this.debounceTimer !== undefined;
    const candidateWasCurrent = Boolean(
      stateBeforeInput &&
      this.isCandidateCurrent(
        stateBeforeInput.candidate,
        stateBeforeInput.snapshot,
        stateBeforeInput.candidate.requestId,
      ),
    );
    const isPasteInput =
      this.pasteInProgress || pasteStarted || data.includes("\u001b[201~");

    super.handleInput(data);
    if (data.includes("\u001b[201~")) this.pasteInProgress = false;
    const after = this.capturePosition();

    if (before.text !== after.text) {
      this.cancelPending();
      this.resetCandidate();
      this.revision += 1;
      if (hadWorkBeforeInput)
        this.onClear?.(isPasteInput ? "pasted" : "edited");
      if (!isPasteInput) {
        if (
          candidateWasCurrent &&
          candidateBeforeEdit &&
          this.reuseMatchingCandidate(before, after, candidateBeforeEdit)
        ) {
          return;
        }
        this.scheduleSuggestion(after);
      }
      return;
    }

    if (before.line !== after.line || before.col !== after.col) {
      this.cancelPending();
      this.resetCandidate();
      if (hadWorkBeforeInput) this.onClear?.("cursor-moved");
      this.tui.requestRender();
    }
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    this.renderedCandidate = undefined;

    const state = this.currentCandidate;
    if (!state) return lines;
    const { candidate, snapshot } = state;
    if (!this.isCandidateCurrent(candidate, snapshot, candidate.requestId)) {
      this.clear("stale", false);
      return lines;
    }
    if (this.isShowingAutocomplete()) return lines;
    if (!this.isAtLogicalEnd()) {
      this.clear("cursor-moved", false);
      return lines;
    }

    const markerLine = lines.findIndex((line) => line.includes(CURSOR_MARKER));
    if (markerLine < 0) {
      if (this.focused) this.clear("layout-unknown", false);
      return lines;
    }

    const line = lines[markerLine];
    if (line === undefined) return lines;
    const decorated = decorateEolGhostLine({
      line,
      suffix: candidate.edit.text,
      width,
      styleDim: this.styleDim,
    });
    if (!decorated) return lines;

    lines[markerLine] = decorated;
    this.renderedCandidate = candidate;
    return lines;
  }

  private capturePosition(): EditorPosition {
    const cursor = this.getCursor();
    return { text: this.getText(), line: cursor.line, col: cursor.col };
  }

  private scheduleSuggestion(position: EditorPosition): void {
    if (
      !this.enabled ||
      this.disposed ||
      utf8ByteLength(position.text) > MAX_DRAFT_BYTES ||
      !hasMinimumNonWhitespaceCharacters(
        position.text,
        this.minimumDraftCharacters,
      ) ||
      !this.isAtLogicalEnd(position)
    )
      return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.generateSuggestion(position);
    }, this.debounceMs);
  }

  private async generateSuggestion(position: EditorPosition): Promise<void> {
    const controller = new AbortController();
    this.generation = controller;
    const snapshot = this.createSnapshot(position);
    const requestId = `pi-${snapshot.revision}-${++this.requestSequence}`;

    try {
      const publishCandidate = (candidate: SuggestionCandidate): void => {
        if (this.generation !== controller || controller.signal.aborted) return;
        if (!this.isCandidateCurrent(candidate, snapshot, requestId)) return;
        if (
          this.currentCandidate?.candidate.requestId === candidate.requestId &&
          this.currentCandidate.candidate.edit.text === candidate.edit.text
        ) {
          return;
        }
        this.currentCandidate = { candidate, snapshot };
        this.tui.requestRender();
      };
      const candidate = await this.bridge.suggest(
        snapshot,
        requestId,
        controller.signal,
        publishCandidate,
      );
      if (this.generation !== controller || controller.signal.aborted) return;
      if (
        !candidate ||
        !this.isCandidateCurrent(candidate, snapshot, requestId)
      ) {
        const retainedPartial = this.hasCurrentCandidateForRequest(
          snapshot,
          requestId,
        );
        this.generation = undefined;
        if (retainedPartial) return;
        if (candidate) this.onClear?.("stale");
        this.clearCandidateForRequest(requestId);
        return;
      }
      publishCandidate(candidate);
      this.generation = undefined;
    } catch {
      if (this.generation !== controller || controller.signal.aborted) return;
      const retainedPartial = this.hasCurrentCandidateForRequest(
        snapshot,
        requestId,
      );
      this.generation = undefined;
      if (retainedPartial) return;
      this.clearCandidateForRequest(requestId);
      this.onClear?.("provider-error");
    }
  }

  private createSnapshot(position: EditorPosition): PromptSnapshot {
    const cursorByte = cursorByteOffset(
      position.text,
      position.line,
      position.col,
    );
    return Object.freeze({
      revision: this.revision,
      text: position.text,
      cursorByte,
    });
  }

  private hasCurrentCandidateForRequest(
    snapshot: PromptSnapshot,
    requestId: string,
  ): boolean {
    const state = this.currentCandidate;
    return (
      state?.snapshot === snapshot &&
      this.isCandidateCurrent(state.candidate, state.snapshot, requestId)
    );
  }

  private clearCandidateForRequest(requestId: string): void {
    if (this.currentCandidate?.candidate.requestId !== requestId) return;
    this.resetCandidate();
    this.tui.requestRender();
  }

  private reuseMatchingCandidate(
    before: EditorPosition,
    after: EditorPosition,
    candidate: SuggestionCandidate,
  ): boolean {
    if (!after.text.startsWith(before.text)) return false;

    const appendedText = after.text.slice(before.text.length);
    if (
      appendedText.length === 0 ||
      !candidate.edit.text.startsWith(appendedText)
    ) {
      return false;
    }

    const remainingText = candidate.edit.text.slice(appendedText.length);
    if (remainingText.length === 0) return false;

    const snapshot = this.createSnapshot(after);
    const requestId = `pi-reuse-${snapshot.revision}-${++this.requestSequence}`;
    this.currentCandidate = {
      candidate: {
        ...candidate,
        requestId,
        revision: snapshot.revision,
        edit: {
          startByte: snapshot.cursorByte,
          endByte: snapshot.cursorByte,
          text: remainingText,
        },
      },
      snapshot,
    };
    this.renderedCandidate = undefined;
    this.tui.requestRender();
    return true;
  }

  private isCandidateCurrent(
    candidate: SuggestionCandidate,
    snapshot: PromptSnapshot,
    requestId: string,
  ): boolean {
    if (!parseSuggestionCandidate(candidate).ok) return false;
    if (candidate.protocolVersion !== PROTOCOL_VERSION) return false;
    if (candidate.requestId !== requestId) return false;
    if (
      candidate.revision !== snapshot.revision ||
      this.revision !== snapshot.revision
    )
      return false;
    const current = this.capturePosition();
    if (current.text !== snapshot.text) return false;
    const currentByte = cursorByteOffset(
      current.text,
      current.line,
      current.col,
    );
    if (currentByte !== snapshot.cursorByte) return false;
    return (
      candidate.edit.startByte === currentByte &&
      candidate.edit.endByte === currentByte
    );
  }

  private acceptCurrentCandidate(candidate: SuggestionCandidate): void {
    const state = this.currentCandidate;
    if (!state) {
      this.clear("stale");
      return;
    }
    if (
      state.candidate.requestId !== candidate.requestId ||
      !this.isCandidateCurrent(candidate, state.snapshot, candidate.requestId)
    ) {
      this.clear("stale");
      return;
    }

    this.resetCandidate();
    this.cancelPending();
    this.insertTextAtCursor(candidate.edit.text);
    this.revision += 1;
    this.onClear?.("accepted");
    this.tui.requestRender();
  }

  private isAtLogicalEnd(position = this.capturePosition()): boolean {
    const lines = position.text.split("\n");
    const finalLine = lines.length - 1;
    return (
      position.line === finalLine &&
      position.col === (lines[finalLine]?.length ?? 0)
    );
  }

  private resetCandidate(): void {
    this.currentCandidate = undefined;
    this.renderedCandidate = undefined;
  }

  private cancelPending(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.generation?.abort();
    this.generation = undefined;
  }
}

function hasMinimumNonWhitespaceCharacters(
  value: string,
  minimum: number,
): boolean {
  if (minimum <= 0) return true;

  let count = 0;
  for (const character of value) {
    if (!/\S/u.test(character)) continue;
    count += 1;
    if (count >= minimum) return true;
  }
  return false;
}

function cursorByteOffset(text: string, line: number, col: number): number {
  const lines = text.split("\n");
  const boundedLine = Math.max(0, Math.min(line, lines.length - 1));
  let prefix = "";
  for (let index = 0; index < boundedLine; index += 1) {
    prefix += `${lines[index] ?? ""}\n`;
  }
  prefix += (lines[boundedLine] ?? "").slice(0, col);
  return utf8ByteLength(prefix);
}
