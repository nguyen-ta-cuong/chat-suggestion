import { describe, expect, it } from "vitest";

import { transcript, type FixtureScenario } from "../src/index.js";

const scenarios: readonly FixtureScenario[] = [
  "line",
  "raw",
  "alternate",
  "cursor-repaint",
  "async-output",
  "bracketed-paste",
  "hidden",
  "unicode-wrap",
  "completion-menu",
  "malformed-ansi",
  "resize",
  "signal",
  "exit-code",
];

describe("TUI conformance fixture", () => {
  it.each(scenarios)(
    "emits bounded deterministic %s events and restores mode",
    (scenario) => {
      const first = transcript(scenario);
      expect(transcript(scenario)).toEqual(first);
      expect(
        first.some(
          (event) => event.type === "restore" && event.value === "line",
        ),
      ).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBeLessThan(
        1024,
      );
    },
  );
});
