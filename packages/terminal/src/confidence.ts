export type ConfidenceState =
  "known-eol" | "ambiguous" | "hidden" | "suspended";

export type DowngradeReason =
  | "alternate-screen"
  | "bracketed-paste"
  | "completion-ui"
  | "cursor-motion"
  | "full-redraw"
  | "hidden-input"
  | "mouse-input"
  | "resize"
  | "unexpected-output"
  | "unknown-sequence";

export interface ConfidenceSnapshot {
  readonly state: ConfidenceState;
  readonly reason?: DowngradeReason;
  readonly draft: string;
  readonly pasteActive: boolean;
}

const PRINTABLE_INPUT = /^[^\u0000-\u001f\u007f]+$/u;

export class InputConfidenceTracker {
  readonly #backspace: string;
  #snapshot: ConfidenceSnapshot = {
    state: "suspended",
    reason: "unexpected-output",
    draft: "",
    pasteActive: false,
  };

  constructor(backspace = "\u007f") {
    this.#backspace = backspace;
  }

  handshake(): void {
    this.#snapshot = { state: "known-eol", draft: "", pasteActive: false };
  }

  snapshot(): ConfidenceSnapshot {
    return this.#snapshot;
  }

  consumeInput(input: string): ConfidenceSnapshot {
    if (input === "\u001b[200~")
      return this.#downgrade("ambiguous", "bracketed-paste", true);
    if (input === "\u001b[201~")
      return this.#downgrade("ambiguous", "bracketed-paste", false);
    if (this.#snapshot.state !== "known-eol") return this.#snapshot;
    if (input === this.#backspace) {
      const draft = [...this.#snapshot.draft].slice(0, -1).join("");
      return (this.#snapshot = { ...this.#snapshot, draft });
    }
    if (PRINTABLE_INPUT.test(input))
      return (this.#snapshot = {
        ...this.#snapshot,
        draft: this.#snapshot.draft + input,
      });
    if (/^\u001b\[[?<]?100[0-6][hl]$/u.test(input))
      return this.#downgrade("ambiguous", "mouse-input");
    if (/^\u001b\[[ABCDHF]/u.test(input))
      return this.#downgrade("ambiguous", "cursor-motion");
    return this.#downgrade("ambiguous", "unknown-sequence");
  }

  observeOutput(output: string): ConfidenceSnapshot {
    if (/\u001b\[\?1049h/u.test(output))
      return this.#downgrade("suspended", "alternate-screen");
    if (/password|passphrase/iu.test(output))
      return this.#downgrade("hidden", "hidden-input");
    if (/completion|menu/iu.test(output))
      return this.#downgrade("ambiguous", "completion-ui");
    if (/\u001b\[(?:2J|H|[0-9;]*[Hf])/u.test(output))
      return this.#downgrade("ambiguous", "full-redraw");
    if (output.length > 0)
      return this.#downgrade("ambiguous", "unexpected-output");
    return this.#snapshot;
  }

  resize(): ConfidenceSnapshot {
    return this.#downgrade("suspended", "resize");
  }

  hide(): ConfidenceSnapshot {
    return this.#downgrade("hidden", "hidden-input");
  }

  canRenderSuggestion(): boolean {
    return this.#snapshot.state === "known-eol" && !this.#snapshot.pasteActive;
  }

  #downgrade(
    state: ConfidenceState,
    reason: DowngradeReason,
    pasteActive = false,
  ): ConfidenceSnapshot {
    return (this.#snapshot = { state, reason, draft: "", pasteActive });
  }
}
