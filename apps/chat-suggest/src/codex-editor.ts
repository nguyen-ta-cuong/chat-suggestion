import type { ClearReason } from "@chat-suggestion/protocol";
import {
  displayWidth,
  graphemes,
  renderDimSuggestion,
  sanitizeTerminalText,
} from "@chat-suggestion/terminal";

export type CodexEditorAction =
  | { readonly kind: "changed" }
  | { readonly kind: "accept-suggestion" }
  | { readonly kind: "dismissed" }
  | { readonly kind: "submit" }
  | { readonly kind: "interrupt" }
  | { readonly kind: "exit" }
  | { readonly kind: "ignored" };

const PROMPT = "> ";

export class CodexPromptEditor {
  #draft = "";
  #suggestion = "";
  #revision = 0;
  #submission: string | null = null;
  #busy = false;
  #preserveSuggestionOnEditClear = false;

  draft(): string {
    return this.#draft;
  }

  suggestion(): string {
    return this.#suggestion;
  }

  revision(): number {
    return this.#revision;
  }

  busy(): boolean {
    return this.#busy;
  }

  setBusy(value: boolean): void {
    this.#busy = value;
    if (value) this.clearSuggestion("submitted");
  }

  showSuggestion(value: string): void {
    this.#preserveSuggestionOnEditClear = false;
    this.#suggestion = sanitizeSingleLine(value);
  }

  clearSuggestion(reason: ClearReason): void {
    if (reason === "edited" && this.#preserveSuggestionOnEditClear) {
      this.#preserveSuggestionOnEditClear = false;
      return;
    }
    this.#preserveSuggestionOnEditClear = false;
    this.#suggestion = "";
  }

  acceptSuggestion(value: string): void {
    if (this.#busy) return;
    const safe = sanitizeSingleLine(value);
    if (safe.length === 0) return;
    this.#draft += safe;
    this.#suggestion = "";
    this.#preserveSuggestionOnEditClear = false;
    this.#revision += 1;
  }

  takeSubmission(): string | null {
    const value = this.#submission;
    this.#submission = null;
    return value;
  }

  handleInput(data: string): CodexEditorAction {
    if (data === "\u0003") {
      if (
        !this.#busy &&
        (this.#draft.length > 0 || this.#suggestion.length > 0)
      ) {
        this.#draft = "";
        this.#suggestion = "";
        this.#revision += 1;
        return { kind: "changed" };
      }
      return { kind: this.#busy ? "interrupt" : "exit" };
    }
    if (this.#busy) return { kind: "ignored" };
    if (data === "\u0004") {
      return { kind: this.#draft.length === 0 ? "exit" : "ignored" };
    }
    if (data === "\t") {
      return {
        kind: this.#suggestion.length > 0 ? "accept-suggestion" : "ignored",
      };
    }
    if (data === "\u001b") {
      if (this.#suggestion.length === 0) return { kind: "ignored" };
      this.#suggestion = "";
      this.#preserveSuggestionOnEditClear = false;
      return { kind: "dismissed" };
    }
    if (data === "\r" || data === "\n") {
      if (this.#draft.trim().length === 0) return { kind: "ignored" };
      this.#submission = this.#draft;
      this.#draft = "";
      this.#suggestion = "";
      this.#preserveSuggestionOnEditClear = false;
      this.#revision += 1;
      return { kind: "submit" };
    }
    if (data === "\u007f" || data === "\b") {
      const parts = graphemes(this.#draft);
      if (parts.length === 0) return { kind: "ignored" };
      parts.pop();
      this.#draft = parts.join("");
      this.#suggestion = "";
      this.#preserveSuggestionOnEditClear = false;
      this.#revision += 1;
      return { kind: "changed" };
    }
    if (data.includes("\u001b")) {
      const pasted = unwrapBracketedPaste(data);
      if (pasted === null) {
        this.#suggestion = "";
        this.#preserveSuggestionOnEditClear = false;
        return { kind: "ignored" };
      }
      data = pasted;
    }
    const text = sanitizeInput(data);
    if (text.length === 0) return { kind: "ignored" };
    if (this.#suggestion.startsWith(text)) {
      this.#suggestion = this.#suggestion.slice(text.length);
      this.#preserveSuggestionOnEditClear = this.#suggestion.length > 0;
    } else {
      this.#suggestion = "";
      this.#preserveSuggestionOnEditClear = false;
    }
    this.#draft += text;
    this.#revision += 1;
    return { kind: "changed" };
  }

  render(width: number): string {
    const contentWidth = Math.max(1, width - displayWidth(PROMPT));
    const visibleDraft = tailToWidth(this.#draft, contentWidth);
    const remaining = Math.max(0, contentWidth - displayWidth(visibleDraft));
    const ghost = renderDimSuggestion(this.#suggestion, remaining);
    const decoration = ghost.length === 0 ? "" : `\u001b[s${ghost}\u001b[u`;
    return `\r\u001b[2K${PROMPT}${visibleDraft}${decoration}`;
  }
}

function sanitizeSingleLine(value: string): string {
  return sanitizeTerminalText(value, { maxLines: 1 });
}

function sanitizeInput(value: string): string {
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint > 0x1f &&
      codePoint !== 0x7f &&
      codePoint !== 0x1b &&
      !(codePoint >= 0x80 && codePoint <= 0x9f)
    ) {
      output += character;
    }
  }
  return output;
}

function unwrapBracketedPaste(value: string): string | null {
  const start = "\u001b[200~";
  const end = "\u001b[201~";
  if (!value.startsWith(start) || !value.endsWith(end)) return null;
  const content = value.slice(start.length, -end.length);
  return content.includes("\u001b") ? null : content;
}

function tailToWidth(value: string, maximumWidth: number): string {
  const parts = graphemes(value);
  let width = 0;
  let output = "";
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part === undefined) continue;
    const nextWidth = displayWidth(part) + width;
    if (nextWidth > maximumWidth) break;
    output = part + output;
    width = nextWidth;
  }
  return output;
}
