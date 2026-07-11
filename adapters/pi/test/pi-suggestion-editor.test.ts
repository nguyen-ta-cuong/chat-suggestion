import {
  PROTOCOL_VERSION,
  type PromptSnapshot,
  type SuggestionCandidate,
} from "@chat-suggestion/protocol";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
});

describe("PiSuggestionEditor key arbitration and freshness", () => {
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
): PiSuggestionEditor {
  return new PiSuggestionEditor(new FakeTui(), theme, {
    bridge,
    host: { name: "pi", version: "0.80.6" },
    workingDirectory: "/fixture",
    sessionId: "session-1",
    keybindings: new FakeKeybindings(),
    styleDim: (text) => `\u001b[2m${text}\u001b[22m`,
    debounceMs: 1,
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
