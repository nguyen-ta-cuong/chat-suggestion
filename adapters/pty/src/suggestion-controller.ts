import { Buffer } from "node:buffer";

import {
  sanitizeSuggestionText,
  validateCandidateForRequest,
  type PtyMarkerName,
  type SuggestionCandidate,
  type SuggestionRequest,
} from "@chat-suggestion/protocol";

import type { PtyProfile } from "./profile.js";
import type { AdjacentSuggestionSurface } from "./types.js";

interface CurrentSuggestion {
  readonly request: SuggestionRequest;
  readonly candidate: SuggestionCandidate;
}

export class PtySuggestionController {
  readonly #profile: PtyProfile;
  readonly #surface: AdjacentSuggestionSurface;
  readonly #acceptanceChord: Uint8Array;
  #current: CurrentSuggestion | undefined;

  constructor(
    profile: PtyProfile,
    surface: AdjacentSuggestionSurface,
    acceptanceChord: Uint8Array = Uint8Array.of(0x09),
  ) {
    if (acceptanceChord.length === 0) {
      throw new RangeError("acceptanceChord must not be empty");
    }
    this.#profile = profile;
    this.#surface = surface;
    this.#acceptanceChord = Uint8Array.from(acceptanceChord);
  }

  show(request: SuggestionRequest, candidateInput: unknown): boolean {
    const validated = validateCandidateForRequest(candidateInput, request);
    if (
      !validated.ok ||
      !this.#profile.matchesSnapshot(
        request.snapshot.text,
        request.snapshot.cursorByte,
      )
    ) {
      this.clear(validated.ok ? "profile-not-ready" : validated.error.code);
      return false;
    }
    this.#current = { request, candidate: validated.value };
    this.#surface.show(validated.value.edit.text);
    return true;
  }

  handleInput(bytes: Uint8Array, writeChild: (data: Uint8Array) => void): void {
    if (this.#canAccept(bytes)) {
      const current = this.#current;
      if (current === undefined) {
        throw new Error("acceptance invariant violated");
      }
      const validated = validateCandidateForRequest(
        current.candidate,
        current.request,
      );
      const sanitized = validated.ok
        ? sanitizeSuggestionText(validated.value.edit.text)
        : "";
      if (sanitized.length > 0) {
        const acceptedBytes = Buffer.from(sanitized, "utf8");
        writeChild(acceptedBytes);
        this.#profile.observeInput(acceptedBytes);
        this.clear("accepted");
        return;
      }
      this.clear("unsafe");
    }

    this.clear("edited");
    this.#profile.observeInput(bytes);
    if (!this.#profile.canRequestSuggestion) {
      this.clear(
        this.#profile.state.kind === "suspended"
          ? this.#profile.state.reason
          : "untrusted",
      );
    }
    writeChild(bytes);
  }

  observeOutput(bytes: Uint8Array): void {
    this.#profile.observeOutput(bytes);
    if (!this.#profile.canRequestSuggestion) {
      this.clear(
        this.#profile.state.kind === "suspended"
          ? this.#profile.state.reason
          : "untrusted",
      );
    }
  }

  observeMarker(marker: PtyMarkerName): void {
    this.#profile.observeMarker(marker);
    if (!this.#profile.canRequestSuggestion) {
      this.clear(
        this.#profile.state.kind === "suspended"
          ? this.#profile.state.reason
          : "untrusted",
      );
    }
  }

  resize(): void {
    this.#profile.suspend("resized");
    this.clear("resized");
  }

  clear(reason: string): void {
    if (this.#current !== undefined) {
      this.#current = undefined;
      this.#surface.clear(reason);
    }
  }

  #canAccept(bytes: Uint8Array): boolean {
    return (
      this.#current !== undefined &&
      this.#profile.canRequestSuggestion &&
      Buffer.from(bytes).equals(Buffer.from(this.#acceptanceChord))
    );
  }
}
