import {
  PROTOCOL_VERSION,
  type PromptSnapshot,
  type SuggestionCandidate,
} from "../src/suggestion.js";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MINIMUM_DRAFT_CHARACTERS,
  PiSuggestionEditor,
  type SuggestionBridge,
} from "../src/pi-suggestion-editor.js";

const passthrough = (text: string): string => text;
const theme: EditorTheme = {
  borderColor: passthrough,
  selectList: {
    selectedPrefix: passthrough,
    selectedText: passthrough,
    description: passthrough,
    scrollInfo: passthrough,
    noMatch: passthrough,
  },
};

class FakeTui implements TUI {
  readonly terminal = { rows: 24, columns: 80 };
  readonly requestRender = vi.fn();
}

class FakeKeybindings implements KeybindingsManager {
  matches(data: string, action: string): boolean {
    return (
      (data === "\t" && action === "tui.input.tab") ||
      (data === "\u001b" && action === "app.interrupt")
    );
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PiSuggestionEditor public rendering spike", () => {
  it.each([
    ["hello", 20],
    ["1234567890", 10],
    ["emoji 👩🏽‍💻", 16],
    ["界界界", 10],
    ["e\u0301", 8],
  ])(
    "renders a bounded one-line ghost without mutating %s",
    async (text, width) => {
      vi.useFakeTimers();
      const editor = createEditor(immediateBridge(" suffix"));
      editor.focused = true;
      editor.setText(text.slice(0, -1));
      editor.render(width);
      editor.handleInput(text.slice(-1));
      await vi.runAllTimersAsync();

      const beforeRender = editor.getText();
      const rendered = editor.render(width);

      expect(editor.getText()).toBe(beforeRender);
      expect(rendered.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(
        rendered.filter((line) => line.includes(CURSOR_MARKER)),
      ).toHaveLength(1);
      expect(rendered.join("\n")).toContain("suf");
    },
  );

  it("clears the ghost on resize instead of reusing stale layout", async () => {
    vi.useFakeTimers();
    const cleared: string[] = [];
    const editor = createEditor(immediateBridge(" tests"), (reason) =>
      cleared.push(reason),
    );
    editor.focused = true;
    editor.render(30);
    editor.handleInput("x");
    await vi.runAllTimersAsync();
    expect(editor.render(30).join("\n")).toContain("tests");

    expect(editor.render(12).join("\n")).not.toContain("tests");
    expect(cleared).toContain("resized");
  });

  it("does not queue a redundant render while clearing stale layout", async () => {
    vi.useFakeTimers();
    const tui = new FakeTui();
    const editor = new PiSuggestionEditor(tui, theme, {
      bridge: immediateBridge(" tests"),
      keybindings: new FakeKeybindings(),
      styleDim: (text) => `\u001b[2m${text}\u001b[22m`,
      debounceMs: 1,
    });
    editor.focused = true;
    editor.render(30);
    editor.handleInput("abc");
    await vi.runAllTimersAsync();
    expect(editor.render(30).join("\n")).toContain("tests");

    tui.requestRender.mockClear();
    expect(editor.render(12).join("\n")).not.toContain("tests");
    expect(tui.requestRender).not.toHaveBeenCalled();
  });
});

describe("PiSuggestionEditor key arbitration and freshness", () => {
  it("renders and accepts a current partial before generation completes", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    let resolveFinal:
      ((candidate: SuggestionCandidate | null) => void) | undefined;
    const bridge = {
      suggest(
        snapshot: PromptSnapshot,
        requestId: string,
        signal: AbortSignal,
        onUpdate?: (candidate: SuggestionCandidate) => void,
      ) {
        capturedSignal = signal;
        onUpdate?.(candidateFor(snapshot, " tests", requestId));
        return new Promise<SuggestionCandidate | null>((resolve) => {
          resolveFinal = resolve;
        });
      },
    };
    const editor = createEditor(bridge);
    editor.focused = true;

    editor.handleInput("a");
    await vi.advanceTimersByTimeAsync(1);

    expect(editor.render(30).join("\n")).toContain("tests");
    editor.handleInput("\t");
    expect(editor.getText()).toBe("a tests");
    expect(capturedSignal?.aborted).toBe(true);
    resolveFinal?.(null);
  });

  it("clears a streamed partial when the final generation fails", async () => {
    vi.useFakeTimers();
    let resolveFinal:
      ((candidate: SuggestionCandidate | null) => void) | undefined;
    const bridge = {
      suggest(
        snapshot: PromptSnapshot,
        requestId: string,
        _signal: AbortSignal,
        onUpdate?: (candidate: SuggestionCandidate) => void,
      ) {
        onUpdate?.(candidateFor(snapshot, " tests", requestId));
        return new Promise<SuggestionCandidate | null>((resolve) => {
          resolveFinal = resolve;
        });
      },
    };
    const editor = createEditor(bridge);
    editor.focused = true;

    editor.handleInput("a");
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.render(30).join("\n")).toContain("tests");

    resolveFinal?.(null);
    await Promise.resolve();
    expect(editor.render(30).join("\n")).not.toContain("tests");
  });

  it("rejects a partial update from an obsolete prompt revision", async () => {
    vi.useFakeTimers();
    const pending: {
      snapshot: PromptSnapshot;
      requestId: string;
      onUpdate?: (candidate: SuggestionCandidate) => void;
    }[] = [];
    const bridge = {
      suggest(
        snapshot: PromptSnapshot,
        requestId: string,
        _signal: AbortSignal,
        onUpdate?: (candidate: SuggestionCandidate) => void,
      ) {
        pending.push({
          snapshot,
          requestId,
          ...(onUpdate === undefined ? {} : { onUpdate }),
        });
        return new Promise<SuggestionCandidate | null>(() => undefined);
      },
    };
    const editor = createEditor(bridge);
    editor.focused = true;

    editor.handleInput("a");
    await vi.advanceTimersByTimeAsync(1);
    editor.handleInput("b");

    const obsolete = pending[0];
    if (!obsolete) throw new Error("obsolete request was not captured");
    obsolete.onUpdate?.(
      candidateFor(obsolete.snapshot, " stale", obsolete.requestId),
    );

    expect(editor.render(30).join("\n")).not.toContain("stale");
  });

  it("waits for an intentional pause before requesting a suggestion", async () => {
    vi.useFakeTimers();
    const suggest = vi.fn(() => Promise.resolve(null));
    const editor = createEditor({ suggest }, undefined, null);

    editor.handleInput("fix");
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS - 1);
    expect(suggest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(suggest).toHaveBeenCalledOnce();
    expect(DEFAULT_DEBOUNCE_MS).toBe(250);
  });

  it("skips low-signal drafts shorter than three non-whitespace characters", async () => {
    vi.useFakeTimers();
    const suggest = vi.fn(() => Promise.resolve(null));
    const editor = createEditor({ suggest }, undefined, 1, null);

    editor.handleInput("a b");
    await vi.runAllTimersAsync();
    expect(suggest).not.toHaveBeenCalled();

    editor.handleInput("c");
    await vi.runAllTimersAsync();
    expect(suggest).toHaveBeenCalledOnce();
    expect(DEFAULT_MINIMUM_DRAFT_CHARACTERS).toBe(3);
  });

  it("shrinks a matching visible ghost locally without another model call", async () => {
    vi.useFakeTimers();
    const suggest = vi.fn((snapshot: PromptSnapshot, requestId: string) =>
      Promise.resolve(candidateFor(snapshot, " tests", requestId)),
    );
    const editor = createEditor({ suggest });
    editor.focused = true;

    editor.handleInput("a");
    await vi.runAllTimersAsync();
    expect(editor.render(30).join("\n")).toContain("tests");

    editor.handleInput(" ");

    expect(editor.getText()).toBe("a ");
    expect(editor.render(30).join("\n")).toContain("ests");
    expect(suggest).toHaveBeenCalledOnce();

    editor.handleInput("\t");
    expect(editor.getText()).toBe("a tests");
  });

  it("invalidates a visible ghost and debounces again on a mismatch", async () => {
    vi.useFakeTimers();
    const suggest = vi
      .fn()
      .mockImplementationOnce((snapshot: PromptSnapshot, requestId: string) =>
        Promise.resolve(candidateFor(snapshot, " tests", requestId)),
      )
      .mockResolvedValue(null);
    const editor = createEditor({ suggest });
    editor.focused = true;

    editor.handleInput("a");
    await vi.runAllTimersAsync();
    editor.handleInput("x");

    expect(editor.render(30).join("\n")).not.toContain("ests");
    expect(suggest).toHaveBeenCalledOnce();

    await vi.runAllTimersAsync();
    expect(suggest).toHaveBeenCalledTimes(2);
  });

  it("accepts once with Tab and delegates later Tab presses", async () => {
    vi.useFakeTimers();
    const editor = createEditor(immediateBridge(" tests"));
    editor.handleInput("a");
    await vi.runAllTimersAsync();

    editor.handleInput("\t");
    expect(editor.getText()).toBe("a tests");
    editor.handleInput("\t");
    expect(editor.getText()).toBe("a tests");
  });

  it("rejects a visible candidate after programmatic text mutation", async () => {
    vi.useFakeTimers();
    const cleared: string[] = [];
    const editor = createEditor(immediateBridge(" tests"), (reason) =>
      cleared.push(reason),
    );
    editor.handleInput("a");
    await vi.runAllTimersAsync();

    editor.setText("different");
    expect(editor.render(30).join("\n")).not.toContain("tests");
    editor.handleInput("\t");

    expect(editor.getText()).toBe("different");
    expect(cleared).toContain("stale");
  });

  it("dismisses the first Escape and delegates the next one", async () => {
    vi.useFakeTimers();
    const editor = createEditor(immediateBridge(" tests"));
    const onEscape = vi.fn();
    editor.onEscape = onEscape;
    editor.handleInput("a");
    await vi.runAllTimersAsync();

    editor.handleInput("\u001b");
    expect(onEscape).not.toHaveBeenCalled();
    editor.handleInput("\u001b");
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("gives native autocomplete priority over ghost acceptance", async () => {
    vi.useFakeTimers();
    const cleared: string[] = [];
    const editor = createEditor(immediateBridge(" tests"), (reason) =>
      cleared.push(reason),
    );
    editor.handleInput("a");
    await vi.runAllTimersAsync();
    vi.spyOn(editor, "isShowingAutocomplete").mockReturnValue(true);

    editor.handleInput("\t");

    expect(editor.getText()).toBe("a");
    expect(cleared).toContain("completion-visible");
  });

  it("delegates bracketed paste without generating from the paste", async () => {
    vi.useFakeTimers();
    const suggest = vi.fn(() => Promise.resolve(null));
    const editor = createEditor({ suggest });

    editor.handleInput("\u001b[200~pasted text\u001b[201~");
    await vi.runAllTimersAsync();

    expect(suggest).not.toHaveBeenCalled();
  });

  it("aborts an old request and rejects its late result", async () => {
    vi.useFakeTimers();
    const pending: {
      readonly snapshot: PromptSnapshot;
      readonly requestId: string;
      readonly signal: AbortSignal;
      readonly resolve: (candidate: SuggestionCandidate) => void;
    }[] = [];
    const bridge: SuggestionBridge = {
      suggest: (snapshot, requestId, signal) =>
        new Promise((resolve) => {
          pending.push({ snapshot, requestId, signal, resolve });
        }),
    };
    const editor = createEditor(bridge);
    editor.focused = true;
    editor.handleInput("a");
    await vi.advanceTimersByTimeAsync(1);
    editor.handleInput("b");
    await vi.advanceTimersByTimeAsync(1);

    expect(pending[0]?.signal.aborted).toBe(true);
    const first = pending[0];
    if (!first) throw new Error("first request was not captured");
    first.resolve(candidateFor(first.snapshot, " stale", first.requestId));
    await Promise.resolve();
    expect(editor.render(30).join("\n")).not.toContain("stale");
  });

  it("rejects a result carrying a different request id", async () => {
    vi.useFakeTimers();
    const bridge: SuggestionBridge = {
      suggest(snapshot) {
        return Promise.resolve(
          candidateFor(snapshot, " mismatch", "wrong-request"),
        );
      },
    };
    const editor = createEditor(bridge);
    editor.handleInput("a");
    await vi.runAllTimersAsync();
    expect(editor.render(30).join("\n")).not.toContain("mismatch");
  });

  it("rejects terminal controls and disposes active generation", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const bridge: SuggestionBridge = {
      suggest(snapshot, requestId, signal) {
        capturedSignal = signal;
        return Promise.resolve(
          candidateFor(snapshot, "\u001b[31munsafe", requestId),
        );
      },
    };
    const editor = createEditor(bridge);
    editor.handleInput("a");
    await vi.runAllTimersAsync();
    expect(editor.render(30).join("\n")).not.toContain("unsafe");

    const neverBridge: SuggestionBridge = {
      suggest: (_snapshot, _requestId, signal) => {
        capturedSignal = signal;
        return new Promise((resolve) => {
          void resolve;
        });
      },
    };
    const active = createEditor(neverBridge);
    active.handleInput("a");
    await vi.advanceTimersByTimeAsync(1);
    active.dispose();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

function createEditor(
  bridge: SuggestionBridge,
  onClear?: (reason: string) => void,
  debounceMs: number | null = 1,
  minimumDraftCharacters: number | null = 1,
): PiSuggestionEditor {
  return new PiSuggestionEditor(new FakeTui(), theme, {
    bridge,
    keybindings: new FakeKeybindings(),
    styleDim: (text) => `\u001b[2m${text}\u001b[22m`,
    ...(debounceMs === null ? {} : { debounceMs }),
    ...(minimumDraftCharacters === null ? {} : { minimumDraftCharacters }),
    ...(onClear ? { onClear } : {}),
  });
}

function immediateBridge(suffix: string): SuggestionBridge {
  return {
    suggest(snapshot, requestId) {
      return Promise.resolve(candidateFor(snapshot, suffix, requestId));
    },
  };
}

function candidateFor(
  snapshot: PromptSnapshot,
  suffix: string,
  requestId = `request-${snapshot.revision}`,
): SuggestionCandidate {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    revision: snapshot.revision,
    edit: {
      startByte: snapshot.cursorByte,
      endByte: snapshot.cursorByte,
      text: suffix,
    },
    tokenCount: 1,
  };
}
