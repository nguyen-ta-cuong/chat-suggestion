import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import {
  parsePtyProfileDescriptor,
  type AdapterCapabilities,
  type DowngradeMetadata,
  type PtyHostFingerprint,
  type PtyMarkerName,
  type PtyProfileDescriptor,
  type ValidationResult,
} from "@chat-suggestion/protocol";

export type PtySuspensionReason =
  | "alternate-screen"
  | "bracketed-paste"
  | "completion-ownership-unknown"
  | "cursor-motion"
  | "hidden-input"
  | "host-output"
  | "profile-mismatch"
  | "redraw"
  | "resized"
  | "submitted"
  | "unknown-sequence";

export type PtyConfidenceState =
  | { readonly kind: "untrusted"; readonly reason: "handshake-required" }
  | { readonly kind: "ready" }
  | { readonly kind: "suspended"; readonly reason: PtySuspensionReason };

export interface CompiledPtyProfile {
  readonly profile: PtyProfile;
  readonly matched: boolean;
  readonly downgrade?: DowngradeMetadata;
}

const DISABLED_CAPABILITIES: AdapterCapabilities = {
  transport: "pty",
  inlineRender: "none",
  bufferRead: false,
  cursorRead: false,
  atomicAcceptance: false,
  cancellation: true,
  resizeAwareness: true,
  alternateScreenSafety: false,
  nativeCompletionAwareness: false,
  attachmentReferences: false,
};

const ESCAPE = "\u001b";
const ALTERNATE_SCREEN_PATTERN = /^\[\?(?:47|1047|1049)[hl]/u;
const REDRAW_PATTERN = /^\[(?:2J|H|[0-9;]*[ABCD])/u;
const CURSOR_MOTION_PATTERN = /^\[(?:[ABCDHF]|[0-9;]*[~ABCD])/u;
// eslint-disable-next-line no-control-regex -- OSC prompt markers are terminal control sequences
const PROMPT_MARKER_PATTERN = /\u001b\]133;([AB])(?:\u0007|\u001b\\)/gu;
const PROMPT_MARKER_PREFIX = `${ESCAPE}]133;`;

export class PtyProfile {
  readonly #descriptor: PtyProfileDescriptor;
  readonly #matched: boolean;
  readonly #requiredHandshakeMarkers: ReadonlySet<PtyMarkerName>;
  readonly #seenHandshakeMarkers = new Set<PtyMarkerName>();
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #state: PtyConfidenceState;
  #draft = "";
  #hidden = false;
  #outputBuffer = "";

  constructor(descriptor: PtyProfileDescriptor, matched: boolean) {
    this.#descriptor = descriptor;
    this.#matched = matched;
    this.#requiredHandshakeMarkers = new Set(
      descriptor.markers.filter(
        (marker) => marker === "prompt-start" || marker === "prompt-end",
      ),
    );
    this.#state = matched
      ? { kind: "untrusted", reason: "handshake-required" }
      : { kind: "suspended", reason: "profile-mismatch" };
  }

  get state(): PtyConfidenceState {
    return this.#state;
  }

  get draft(): string {
    return this.#draft;
  }

  get canRequestSuggestion(): boolean {
    return this.#state.kind === "ready" && !this.#hidden;
  }

  matchesSnapshot(text: string, cursorByte: number): boolean {
    return (
      this.canRequestSuggestion &&
      text === this.#draft &&
      cursorByte === Buffer.byteLength(text, "utf8")
    );
  }

  capabilities(): AdapterCapabilities {
    return this.canRequestSuggestion
      ? this.#descriptor.capabilities
      : DISABLED_CAPABILITIES;
  }

  observeMarker(marker: PtyMarkerName): void {
    if (!this.#descriptor.markers.includes(marker) || !this.#matched) {
      this.suspend("unknown-sequence");
      return;
    }
    if (marker === "hidden-input-start") {
      this.#hidden = true;
      this.suspend("hidden-input");
      return;
    }
    if (marker === "hidden-input-end") {
      this.#hidden = false;
      this.#restartHandshake();
      return;
    }
    if (marker === "prompt-start") {
      this.#draft = "";
      this.#decoder = new TextDecoder("utf-8", { fatal: true });
    }
    this.#seenHandshakeMarkers.add(marker);
    if (this.#hasCompleteHandshake()) {
      this.#state = { kind: "ready" };
    }
  }

  observeInput(bytes: Uint8Array): void {
    if (bytes.length === 0 || this.#state.kind !== "ready") {
      return;
    }
    const controlReason = classifyControlInput(bytes);
    if (controlReason !== undefined) {
      this.suspend(controlReason);
      return;
    }
    let text: string;
    try {
      text = this.#decoder.decode(bytes, { stream: true });
    } catch {
      this.suspend("unknown-sequence");
      return;
    }
    for (const character of text) {
      if (character === "\u007f" || character === "\b") {
        this.#draft = Array.from(this.#draft).slice(0, -1).join("");
      } else if (isSafePrintable(character)) {
        this.#draft += character;
      } else {
        this.suspend("unknown-sequence");
        return;
      }
    }
  }

  observeOutput(bytes: Uint8Array): void {
    if (bytes.length === 0 || !this.#matched) return;
    let data = this.#outputBuffer + Buffer.from(bytes).toString("latin1");
    this.#outputBuffer = "";
    if (this.#descriptor.detectors.includes("output-mode")) {
      data = data.replace(PROMPT_MARKER_PATTERN, (_sequence, code: string) => {
        if (
          code === "A" &&
          this.#hidden &&
          this.#descriptor.markers.includes("hidden-input-end")
        ) {
          this.observeMarker("hidden-input-end");
        }
        const marker = code === "A" ? "prompt-start" : "prompt-end";
        if (this.#descriptor.markers.includes(marker)) {
          this.observeMarker(marker);
        }
        return "";
      });
      const incompleteIndex = incompletePromptMarkerIndex(data);
      if (incompleteIndex !== undefined) {
        this.#outputBuffer = data.slice(incompleteIndex, incompleteIndex + 64);
        data = data.slice(0, incompleteIndex);
      }
    }
    if (
      this.#descriptor.detectors.includes("hidden-input") &&
      /password|passphrase/iu.test(data)
    ) {
      if (this.#descriptor.markers.includes("hidden-input-start")) {
        this.observeMarker("hidden-input-start");
      } else {
        this.suspend("hidden-input");
      }
      return;
    }
    if (
      this.#descriptor.detectors.includes("completion-ui") &&
      /completion|menu/iu.test(data)
    ) {
      this.suspend("completion-ownership-unknown");
      return;
    }
    if (data.length === 0 || this.#state.kind !== "ready") return;
    if (
      this.#descriptor.detectors.includes("alternate-screen") &&
      containsEscapeSequence(data, ALTERNATE_SCREEN_PATTERN)
    ) {
      this.suspend("alternate-screen");
      return;
    }
    if (
      (this.#descriptor.detectors.includes("redraw") ||
        this.#descriptor.detectors.includes("cursor-motion")) &&
      containsEscapeSequence(data, REDRAW_PATTERN)
    ) {
      this.suspend("redraw");
      return;
    }
    this.suspend("host-output");
  }

  suspend(reason: PtySuspensionReason): void {
    this.#state = { kind: "suspended", reason };
    this.#draft = "";
    this.#decoder = new TextDecoder("utf-8", { fatal: true });
    this.#seenHandshakeMarkers.clear();
    this.#outputBuffer = "";
  }

  #restartHandshake(): void {
    this.#draft = "";
    this.#decoder = new TextDecoder("utf-8", { fatal: true });
    this.#seenHandshakeMarkers.clear();
    this.#outputBuffer = "";
    this.#state = { kind: "untrusted", reason: "handshake-required" };
  }

  #hasCompleteHandshake(): boolean {
    return (
      this.#requiredHandshakeMarkers.size > 0 &&
      [...this.#requiredHandshakeMarkers].every((marker) =>
        this.#seenHandshakeMarkers.has(marker),
      )
    );
  }
}

export function compilePtyProfile(
  input: unknown,
  observedHost: PtyHostFingerprint,
): ValidationResult<CompiledPtyProfile> {
  const parsed = parsePtyProfileDescriptor(input);
  if (!parsed.ok) {
    return parsed;
  }
  const matched = fingerprintsMatch(parsed.value.host, observedHost);
  const mismatch = matched
    ? undefined
    : {
        code: "profile-mismatch",
        message:
          "Executable, version, and SHA-256 fingerprint must match exactly.",
      };
  return {
    ok: true,
    value: {
      profile: new PtyProfile(parsed.value, matched),
      matched,
      ...(mismatch === undefined
        ? parsed.value.downgrade === undefined
          ? {}
          : { downgrade: parsed.value.downgrade }
        : { downgrade: mismatch }),
    },
  };
}

function fingerprintsMatch(
  expected: PtyHostFingerprint,
  observed: PtyHostFingerprint,
): boolean {
  return (
    expected.executable === observed.executable &&
    expected.version === observed.version &&
    expected.sha256 === observed.sha256
  );
}

function classifyControlInput(
  bytes: Uint8Array,
): PtySuspensionReason | undefined {
  if (bytes.includes(0x0d) || bytes.includes(0x0a) || bytes.includes(0x04)) {
    return "submitted";
  }
  if (bytes.includes(0x09)) {
    return "completion-ownership-unknown";
  }
  if (bytes.includes(0x1b)) {
    const value = Buffer.from(bytes).toString("latin1");
    if (value.includes(`${ESCAPE}[200~`) || value.includes(`${ESCAPE}[201~`)) {
      return "bracketed-paste";
    }
    if (containsEscapeSequence(value, CURSOR_MOTION_PATTERN)) {
      return "cursor-motion";
    }
    return "unknown-sequence";
  }
  return undefined;
}

function containsEscapeSequence(value: string, pattern: RegExp): boolean {
  return value
    .split(ESCAPE)
    .slice(1)
    .some((sequence) => pattern.test(sequence));
}

function incompletePromptMarkerIndex(value: string): number | undefined {
  const searchStart = Math.max(0, value.length - 64);
  for (let index = searchStart; index < value.length; index += 1) {
    const tail = value.slice(index);
    if (
      PROMPT_MARKER_PREFIX.startsWith(tail) ||
      (tail.startsWith(PROMPT_MARKER_PREFIX) &&
        !tail.includes("\u0007") &&
        !tail.includes(ESCAPE, 1))
    ) {
      return index;
    }
  }
  return undefined;
}

function isSafePrintable(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x20 && codePoint !== 0x7f;
}
