import { describe, expect, it } from "vitest";

import { CodexPromptEditor } from "../src/codex-editor.js";

describe("CodexPromptEditor", () => {
  it("renders ghost text as decoration and accepts it with Tab without submitting", () => {
    const editor = new CodexPromptEditor();
    editor.handleInput("fix auth");
    editor.showSuggestion(" tests");

    const rendered = editor.render(80);
    const action = editor.handleInput("\t");

    expect(rendered).toContain("fix auth");
    expect(rendered).toContain("\u001b[2m tests\u001b[22m");
    expect(action).toEqual({ kind: "accept-suggestion" });
    expect(editor.draft()).toBe("fix auth");

    editor.acceptSuggestion(" tests");
    expect(editor.draft()).toBe("fix auth tests");
    expect(editor.takeSubmission()).toBeNull();
  });

  it("dismisses with Escape without changing the draft", () => {
    const editor = new CodexPromptEditor();
    editor.handleInput("fix auth");
    editor.showSuggestion(" tests");

    expect(editor.handleInput("\u001b")).toEqual({ kind: "dismissed" });
    expect(editor.draft()).toBe("fix auth");
    expect(editor.suggestion()).toBe("");
  });

  it("keeps the remaining ghost text when typing through a matching prefix", () => {
    const editor = new CodexPromptEditor();
    editor.handleInput("run");
    editor.showSuggestion(" tests now");

    expect(editor.handleInput(" ")).toEqual({ kind: "changed" });
    editor.clearSuggestion("edited");
    expect(editor.draft()).toBe("run ");
    expect(editor.suggestion()).toBe("tests now");

    editor.handleInput("x");
    editor.clearSuggestion("edited");
    expect(editor.suggestion()).toBe("");
  });

  it("submits the real draft exactly once and never includes unaccepted ghost text", () => {
    const editor = new CodexPromptEditor();
    editor.handleInput("explain this");
    editor.showSuggestion(" file");

    expect(editor.handleInput("\r")).toEqual({ kind: "submit" });
    expect(editor.takeSubmission()).toBe("explain this");
    expect(editor.takeSubmission()).toBeNull();
    expect(editor.draft()).toBe("");
  });

  it("deletes one Unicode grapheme and sanitizes hostile suggestion output", () => {
    const editor = new CodexPromptEditor();
    editor.handleInput("go 👨‍💻");
    editor.handleInput("\u007f");
    editor.showSuggestion(" safe\u001b[31m bad\nignored");

    expect(editor.draft()).toBe("go ");
    expect(editor.suggestion()).toBe(" safe bad");
    expect(editor.render(20)).not.toContain("\u001b[31m");
  });

  it("truncates decoration to terminal width and restores the cursor before it", () => {
    const editor = new CodexPromptEditor();
    editor.handleInput("hello");
    editor.showSuggestion(" world beyond width");

    const rendered = editor.render(12);

    expect(rendered).toContain("\u001b[s");
    expect(rendered).toContain("\u001b[u");
    expect(rendered).not.toContain("beyond");
  });
});
