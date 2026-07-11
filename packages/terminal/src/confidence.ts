import { graphemes } from "./width.js";

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

const ESCAPE = "\u001b";

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
      const draft = graphemes(this.#snapshot.draft).slice(0, -1).join("");
      return (this.#snapshot = { ...this.#snapshot, draft });
    }
    if (isPrintableInput(input))
      return (this.#snapshot = {
        ...this.#snapshot,
        draft: this.#snapshot.draft + input,
      });
    const escapeSequence = input.startsWith(ESCAPE) ? input.slice(1) : "";
    if (/^\[[?<]?100[0-6][hl]$/u.test(escapeSequence))
      return this.#downgrade("ambiguous", "mouse-input");
    if (/^\[[ABCDHF]/u.test(escapeSequence))
      return this.#downgrade("ambiguous", "cursor-motion");
    return this.#downgrade("ambiguous", "unknown-sequence");
  }

  observeOutput(output: string): ConfidenceSnapshot {
    if (output.includes(`${ESCAPE}[?1049h`))
      return this.#downgrade("suspended", "alternate-screen");
    if (/password|passphrase/iu.test(output))
      return this.#downgrade("hidden", "hidden-input");
    if (/completion|menu/iu.test(output))
      return this.#downgrade("ambiguous", "completion-ui");
    if (
      output
        .split(ESCAPE)
        .slice(1)
        .some((sequence) => /^\[(?:2J|H|[0-9;]*[Hf])/u.test(sequence))
    )
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

function isPrintableInput(input: string): boolean {
  return (
    input.length > 0 &&
    Array.from(input).every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
  );
}
