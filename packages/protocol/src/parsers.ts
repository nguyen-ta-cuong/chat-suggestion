import { Buffer } from "node:buffer";

import {
  CONTEXT_SOURCE_BYTE_LIMITS,
  MAX_CANDIDATE_BYTES,
  MAX_CANDIDATE_CHARACTERS,
  MAX_CANDIDATE_LINES,
  MAX_CONTEXT_BYTES,
  MAX_DRAFT_BYTES,
  MAX_PROVIDER_TOKENS,
  MAX_REQUEST_BYTES,
} from "./limits.js";
import { containsUnsafeTerminalText } from "./safety.js";
import {
  PROTOCOL_VERSION,
  type AdapterCapabilities,
  type ByteRange,
  type ContextContribution,
  type ContextEnvelope,
  type ContextSourceKind,
  type PromptSnapshot,
  type PtyDetectorName,
  type PtyMarkerName,
  type PtyProfileDescriptor,
  type SuggestionCandidate,
  type SuggestionRequest,
  type ValidationResult,
} from "./types.js";
import { isUtf8Boundary, isWellFormedUnicode, utf8ByteLength } from "./utf8.js";
import {
  failure,
  findUnknownKey,
  isBoolean,
  isBoundedString,
  isNonNegativeInteger,
  isRecord,
  success,
} from "./validation.js";

const CAPABILITY_KEYS = [
  "transport",
  "inlineRender",
  "bufferRead",
  "cursorRead",
  "atomicAcceptance",
  "cancellation",
  "resizeAwareness",
  "alternateScreenSafety",
  "nativeCompletionAwareness",
  "attachmentReferences",
] as const;

const CONTEXT_KINDS: readonly ContextSourceKind[] = [
  "recent-chat",
  "git",
  "project",
  "attachment",
  "plan",
];

const PTY_DETECTORS: readonly PtyDetectorName[] = [
  "alternate-screen",
  "bracketed-paste",
  "completion-ui",
  "cursor-motion",
  "hidden-input",
  "output-mode",
  "redraw",
];

const PTY_MARKERS: readonly PtyMarkerName[] = [
  "prompt-start",
  "prompt-end",
  "hidden-input-start",
  "hidden-input-end",
];

export function parseAdapterCapabilities(
  input: unknown,
  path = "$.capabilities",
): ValidationResult<AdapterCapabilities> {
  if (!isRecord(input)) {
    return failure("invalid-type", path, "must be an object");
  }
  const unknownKey = findUnknownKey(input, CAPABILITY_KEYS);
  if (unknownKey !== undefined) {
    return failure(
      "unknown-field",
      `${path}.${unknownKey}`,
      "is not supported",
    );
  }
  if (!isOneOf(input.transport, ["native", "app-server", "pty", "none"])) {
    return failure(
      "invalid-value",
      `${path}.transport`,
      "is not a supported transport",
    );
  }
  if (
    !isOneOf(input.inlineRender, ["arbitrary", "eol-only", "adjacent", "none"])
  ) {
    return failure(
      "invalid-value",
      `${path}.inlineRender`,
      "is not a supported render mode",
    );
  }
  for (const key of CAPABILITY_KEYS.slice(2)) {
    if (!isBoolean(input[key])) {
      return failure("invalid-type", `${path}.${key}`, "must be a boolean");
    }
  }
  return success(input as unknown as AdapterCapabilities);
}

export function parsePromptSnapshot(
  input: unknown,
  path = "$.snapshot",
): ValidationResult<PromptSnapshot> {
  if (!isRecord(input)) {
    return failure("invalid-type", path, "must be an object");
  }
  const unknownKey = findUnknownKey(input, [
    "revision",
    "text",
    "cursorByte",
    "selection",
    "host",
    "capabilities",
    "workingDirectory",
    "sessionId",
  ]);
  if (unknownKey !== undefined) {
    return failure(
      "unknown-field",
      `${path}.${unknownKey}`,
      "is not supported",
    );
  }
  if (!isNonNegativeInteger(input.revision)) {
    return failure(
      "invalid-value",
      `${path}.revision`,
      "must be a non-negative integer",
    );
  }
  if (typeof input.text !== "string" || !isWellFormedUnicode(input.text)) {
    return failure(
      "invalid-utf8",
      `${path}.text`,
      "must contain well-formed Unicode text",
    );
  }
  if (utf8ByteLength(input.text) > MAX_DRAFT_BYTES) {
    return failure(
      "size-limit",
      `${path}.text`,
      `must not exceed ${MAX_DRAFT_BYTES} UTF-8 bytes`,
    );
  }
  if (!isUtf8Boundary(input.text, input.cursorByte as number)) {
    return failure(
      "invalid-offset",
      `${path}.cursorByte`,
      "must be a UTF-8 code-point boundary",
    );
  }
  if (input.selection !== undefined) {
    const selectionResult = parseByteRange(
      input.selection,
      input.text,
      `${path}.selection`,
    );
    if (!selectionResult.ok) {
      return selectionResult;
    }
  }
  const hostResult = parseHostIdentity(input.host, `${path}.host`);
  if (!hostResult.ok) {
    return hostResult;
  }
  const capabilityResult = parseAdapterCapabilities(
    input.capabilities,
    `${path}.capabilities`,
  );
  if (!capabilityResult.ok) {
    return capabilityResult;
  }
  if (!isBoundedString(input.workingDirectory, 4_096)) {
    return failure(
      "invalid-value",
      `${path}.workingDirectory`,
      "must be a non-empty bounded string",
    );
  }
  if (!isBoundedString(input.sessionId, 256)) {
    return failure(
      "invalid-value",
      `${path}.sessionId`,
      "must be a non-empty bounded string",
    );
  }
  return success(input as unknown as PromptSnapshot);
}

export function parseContextEnvelope(
  input: unknown,
  path = "$.context",
): ValidationResult<ContextEnvelope> {
  if (!isRecord(input)) {
    return failure("invalid-type", path, "must be an object");
  }
  const unknownKey = findUnknownKey(input, ["contributions"]);
  if (unknownKey !== undefined) {
    return failure(
      "unknown-field",
      `${path}.${unknownKey}`,
      "is not supported",
    );
  }
  if (!Array.isArray(input.contributions)) {
    return failure("invalid-type", `${path}.contributions`, "must be an array");
  }

  const sourceBytes = new Map<ContextSourceKind, number>();
  let totalBytes = 0;
  for (const [index, contribution] of input.contributions.entries()) {
    const contributionPath = `${path}.contributions[${index}]`;
    const result = parseContextContribution(contribution, contributionPath);
    if (!result.ok) {
      return result;
    }
    const contentBytes = utf8ByteLength(result.value.content);
    const kindBytes = (sourceBytes.get(result.value.kind) ?? 0) + contentBytes;
    if (kindBytes > CONTEXT_SOURCE_BYTE_LIMITS[result.value.kind]) {
      return failure(
        "size-limit",
        `${contributionPath}.content`,
        `${result.value.kind} context exceeds its ${CONTEXT_SOURCE_BYTE_LIMITS[result.value.kind]} byte budget`,
      );
    }
    sourceBytes.set(result.value.kind, kindBytes);
    totalBytes += contentBytes;
    if (totalBytes > MAX_CONTEXT_BYTES) {
      return failure(
        "size-limit",
        path,
        `context exceeds ${MAX_CONTEXT_BYTES} UTF-8 bytes`,
      );
    }
  }
  return success(input as unknown as ContextEnvelope);
}

export function parseSuggestionRequest(
  input: unknown,
): ValidationResult<SuggestionRequest> {
  if (!isRecord(input)) {
    return failure("invalid-type", "$", "request must be an object");
  }
  const unknownKey = findUnknownKey(input, [
    "protocolVersion",
    "requestId",
    "revision",
    "snapshot",
    "context",
  ]);
  if (unknownKey !== undefined) {
    return failure("unknown-field", `$.${unknownKey}`, "is not supported");
  }
  if (input.protocolVersion !== PROTOCOL_VERSION) {
    return failure(
      "unsupported-version",
      "$.protocolVersion",
      "only protocol version 1 is supported",
    );
  }
  if (!isBoundedString(input.requestId, 128)) {
    return failure(
      "invalid-value",
      "$.requestId",
      "must be a non-empty bounded string",
    );
  }
  if (!isNonNegativeInteger(input.revision)) {
    return failure(
      "invalid-value",
      "$.revision",
      "must be a non-negative integer",
    );
  }
  const snapshotResult = parsePromptSnapshot(input.snapshot);
  if (!snapshotResult.ok) {
    return snapshotResult;
  }
  if (snapshotResult.value.revision !== input.revision) {
    return failure(
      "stale-result",
      "$.revision",
      "must match snapshot.revision",
    );
  }
  const contextResult = parseContextEnvelope(input.context);
  if (!contextResult.ok) {
    return contextResult;
  }
  if (serializedByteLength(input) > MAX_REQUEST_BYTES) {
    return failure(
      "size-limit",
      "$",
      `serialized request exceeds ${MAX_REQUEST_BYTES} UTF-8 bytes`,
    );
  }
  return success(input as unknown as SuggestionRequest);
}

export function parseSuggestionCandidate(
  input: unknown,
): ValidationResult<SuggestionCandidate> {
  if (!isRecord(input)) {
    return failure("invalid-type", "$", "candidate must be an object");
  }
  const unknownKey = findUnknownKey(input, [
    "protocolVersion",
    "requestId",
    "revision",
    "edit",
    "tokenCount",
  ]);
  if (unknownKey !== undefined) {
    return failure("unknown-field", `$.${unknownKey}`, "is not supported");
  }
  if (input.protocolVersion !== PROTOCOL_VERSION) {
    return failure(
      "unsupported-version",
      "$.protocolVersion",
      "only protocol version 1 is supported",
    );
  }
  if (!isBoundedString(input.requestId, 128)) {
    return failure(
      "invalid-value",
      "$.requestId",
      "must be a non-empty bounded string",
    );
  }
  if (!isNonNegativeInteger(input.revision)) {
    return failure(
      "invalid-value",
      "$.revision",
      "must be a non-negative integer",
    );
  }
  if (!isRecord(input.edit)) {
    return failure("invalid-type", "$.edit", "must be an object");
  }
  const editUnknownKey = findUnknownKey(input.edit, [
    "startByte",
    "endByte",
    "text",
  ]);
  if (editUnknownKey !== undefined) {
    return failure(
      "unknown-field",
      `$.edit.${editUnknownKey}`,
      "is not supported",
    );
  }
  if (
    !isNonNegativeInteger(input.edit.startByte) ||
    input.edit.startByte !== input.edit.endByte
  ) {
    return failure(
      "invalid-offset",
      "$.edit",
      "must be an insertion with equal non-negative offsets",
    );
  }
  const textResult = validateCandidateText(input.edit.text);
  if (!textResult.ok) {
    return textResult;
  }
  if (
    !isNonNegativeInteger(input.tokenCount) ||
    input.tokenCount < 1 ||
    input.tokenCount > MAX_PROVIDER_TOKENS
  ) {
    return failure(
      "invalid-value",
      "$.tokenCount",
      `must be an integer between 1 and ${MAX_PROVIDER_TOKENS}`,
    );
  }
  return success(input as unknown as SuggestionCandidate);
}

export function validateCandidateForRequest(
  candidateInput: unknown,
  request: SuggestionRequest,
): ValidationResult<SuggestionCandidate> {
  const candidateResult = parseSuggestionCandidate(candidateInput);
  if (!candidateResult.ok) {
    return candidateResult;
  }
  const candidate = candidateResult.value;
  if (
    candidate.requestId !== request.requestId ||
    candidate.revision !== request.revision
  ) {
    return failure(
      "stale-result",
      "$",
      "candidate does not belong to the current request revision",
    );
  }
  if (candidate.edit.startByte !== request.snapshot.cursorByte) {
    return failure(
      "invalid-offset",
      "$.edit",
      "candidate insertion must be at the snapshot cursor",
    );
  }
  return success(candidate);
}

export function parsePtyProfileDescriptor(
  input: unknown,
): ValidationResult<PtyProfileDescriptor> {
  if (!isRecord(input)) {
    return failure("invalid-type", "$", "PTY profile must be an object");
  }
  const unknownKey = findUnknownKey(input, [
    "protocolVersion",
    "host",
    "detectors",
    "markers",
    "capabilities",
    "downgrade",
  ]);
  if (unknownKey !== undefined) {
    return failure("unknown-field", `$.${unknownKey}`, "is not supported");
  }
  if (input.protocolVersion !== PROTOCOL_VERSION) {
    return failure(
      "unsupported-version",
      "$.protocolVersion",
      "only protocol version 1 is supported",
    );
  }
  const hostResult = parsePtyHost(input.host);
  if (!hostResult.ok) {
    return hostResult;
  }
  const detectorResult = parseUniqueStringArray(
    input.detectors,
    PTY_DETECTORS,
    "$.detectors",
  );
  if (!detectorResult.ok) {
    return detectorResult;
  }
  const markerResult = parseUniqueStringArray(
    input.markers,
    PTY_MARKERS,
    "$.markers",
  );
  if (!markerResult.ok) {
    return markerResult;
  }
  const capabilityResult = parseAdapterCapabilities(input.capabilities);
  if (!capabilityResult.ok) {
    return capabilityResult;
  }
  if (capabilityResult.value.transport !== "pty") {
    return failure(
      "invalid-value",
      "$.capabilities.transport",
      "PTY profiles must use pty transport",
    );
  }
  if (input.downgrade !== undefined) {
    const downgradeResult = parseDowngrade(input.downgrade);
    if (!downgradeResult.ok) {
      return downgradeResult;
    }
  }
  return success(input as unknown as PtyProfileDescriptor);
}

function parseHostIdentity(
  input: unknown,
  path: string,
): ValidationResult<PromptSnapshot["host"]> {
  if (!isRecord(input)) {
    return failure("invalid-type", path, "must be an object");
  }
  const unknownKey = findUnknownKey(input, ["name", "version"]);
  if (unknownKey !== undefined) {
    return failure(
      "unknown-field",
      `${path}.${unknownKey}`,
      "is not supported",
    );
  }
  if (
    !isBoundedString(input.name, 128) ||
    !isBoundedString(input.version, 128)
  ) {
    return failure(
      "invalid-value",
      path,
      "name and version must be non-empty bounded strings",
    );
  }
  return success(input as unknown as PromptSnapshot["host"]);
}

function parseByteRange(
  input: unknown,
  text: string,
  path: string,
): ValidationResult<ByteRange> {
  if (!isRecord(input)) {
    return failure("invalid-type", path, "must be an object");
  }
  const unknownKey = findUnknownKey(input, ["startByte", "endByte"]);
  if (unknownKey !== undefined) {
    return failure(
      "unknown-field",
      `${path}.${unknownKey}`,
      "is not supported",
    );
  }
  if (
    !isUtf8Boundary(text, input.startByte as number) ||
    !isUtf8Boundary(text, input.endByte as number) ||
    (input.startByte as number) > (input.endByte as number)
  ) {
    return failure(
      "invalid-offset",
      path,
      "must be an ordered UTF-8 boundary range",
    );
  }
  return success(input as unknown as ByteRange);
}

function parseContextContribution(
  input: unknown,
  path: string,
): ValidationResult<ContextContribution> {
  if (!isRecord(input)) {
    return failure("invalid-type", path, "must be an object");
  }
  const unknownKey = findUnknownKey(input, ["kind", "content"]);
  if (unknownKey !== undefined) {
    return failure(
      "unknown-field",
      `${path}.${unknownKey}`,
      "is not supported",
    );
  }
  if (!isOneOf(input.kind, CONTEXT_KINDS)) {
    return failure(
      "invalid-value",
      `${path}.kind`,
      "is not a supported context source",
    );
  }
  if (
    typeof input.content !== "string" ||
    !isWellFormedUnicode(input.content)
  ) {
    return failure(
      "invalid-utf8",
      `${path}.content`,
      "must contain well-formed Unicode text",
    );
  }
  return success(input as unknown as ContextContribution);
}

function validateCandidateText(input: unknown): ValidationResult<string> {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    !isWellFormedUnicode(input)
  ) {
    return failure(
      "invalid-value",
      "$.edit.text",
      "must be non-empty well-formed Unicode text",
    );
  }
  if (containsUnsafeTerminalText(input)) {
    return failure(
      "unsafe-text",
      "$.edit.text",
      "contains terminal control characters",
    );
  }
  if (utf8ByteLength(input) > MAX_CANDIDATE_BYTES) {
    return failure(
      "size-limit",
      "$.edit.text",
      `must not exceed ${MAX_CANDIDATE_BYTES} UTF-8 bytes`,
    );
  }
  if (Array.from(input).length > MAX_CANDIDATE_CHARACTERS) {
    return failure(
      "size-limit",
      "$.edit.text",
      `must not exceed ${MAX_CANDIDATE_CHARACTERS} Unicode characters`,
    );
  }
  if (input.split("\n").length > MAX_CANDIDATE_LINES) {
    return failure(
      "size-limit",
      "$.edit.text",
      `must not exceed ${MAX_CANDIDATE_LINES} lines`,
    );
  }
  return success(input);
}

function parsePtyHost(
  input: unknown,
): ValidationResult<PtyProfileDescriptor["host"]> {
  if (!isRecord(input)) {
    return failure("invalid-type", "$.host", "must be an object");
  }
  const unknownKey = findUnknownKey(input, ["executable", "version", "sha256"]);
  if (unknownKey !== undefined) {
    return failure("unknown-field", `$.host.${unknownKey}`, "is not supported");
  }
  if (
    !isBoundedString(input.executable, 512) ||
    !isBoundedString(input.version, 128)
  ) {
    return failure(
      "invalid-value",
      "$.host",
      "executable and version must be non-empty bounded strings",
    );
  }
  if (
    typeof input.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.sha256)
  ) {
    return failure(
      "invalid-value",
      "$.host.sha256",
      "must be a lowercase SHA-256 digest",
    );
  }
  return success(input as unknown as PtyProfileDescriptor["host"]);
}

function parseDowngrade(
  input: unknown,
): ValidationResult<PtyProfileDescriptor["downgrade"]> {
  if (!isRecord(input)) {
    return failure("invalid-type", "$.downgrade", "must be an object");
  }
  const unknownKey = findUnknownKey(input, ["code", "message"]);
  if (unknownKey !== undefined) {
    return failure(
      "unknown-field",
      `$.downgrade.${unknownKey}`,
      "is not supported",
    );
  }
  if (
    !isBoundedString(input.code, 128) ||
    !isBoundedString(input.message, 1_024)
  ) {
    return failure(
      "invalid-value",
      "$.downgrade",
      "code and message must be non-empty bounded strings",
    );
  }
  return success(input as unknown as PtyProfileDescriptor["downgrade"]);
}

function parseUniqueStringArray<T extends string>(
  input: unknown,
  allowedValues: readonly T[],
  path: string,
): ValidationResult<readonly T[]> {
  if (!Array.isArray(input)) {
    return failure("invalid-type", path, "must be an array");
  }
  const seen = new Set<T>();
  for (const [index, value] of input.entries()) {
    if (!isOneOf(value, allowedValues)) {
      return failure("invalid-value", `${path}[${index}]`, "is not supported");
    }
    if (seen.has(value)) {
      return failure(
        "invalid-value",
        `${path}[${index}]`,
        "must not be duplicated",
      );
    }
    seen.add(value);
  }
  return success(input as readonly T[]);
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
