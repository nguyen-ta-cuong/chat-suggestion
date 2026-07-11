import type { ContextSourceKind } from "./types.js";

export const MAX_REQUEST_BYTES = 65_536;
export const MAX_DRAFT_BYTES = 8_192;
export const MAX_CONTEXT_BYTES = 49_152;
export const MAX_CANDIDATE_BYTES = 1_024;
export const MAX_CANDIDATE_CHARACTERS = 160;
export const MAX_CANDIDATE_LINES = 2;
export const MAX_PROVIDER_TOKENS = 64;

export const CONTEXT_SOURCE_BYTE_LIMITS: Readonly<
  Record<ContextSourceKind, number>
> = {
  "recent-chat": 12_288,
  git: 20_480,
  project: 8_192,
  attachment: 4_096,
  plan: 4_096,
};
