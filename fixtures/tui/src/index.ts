import { pathToFileURL } from "node:url";

export type FixtureScenario =
  | "line"
  | "raw"
  | "alternate"
  | "cursor-repaint"
  | "async-output"
  | "bracketed-paste"
  | "hidden"
  | "unicode-wrap"
  | "completion-menu"
  | "malformed-ansi"
  | "resize"
  | "signal"
  | "exit-code";

export interface FixtureEvent {
  readonly type: "mode" | "output" | "restore" | "resize" | "signal" | "exit";
  readonly value: string | number;
}

export function transcript(scenario: FixtureScenario): readonly FixtureEvent[] {
  const events = scenarios[scenario];
  if (events === undefined)
    throw new Error(`unknown fixture scenario: ${scenario}`);
  return events;
}

const scenarios: Readonly<Record<FixtureScenario, readonly FixtureEvent[]>> = {
  line: [
    { type: "mode", value: "line" },
    { type: "output", value: "prompt> " },
    { type: "restore", value: "line" },
  ],
  raw: [
    { type: "mode", value: "raw" },
    { type: "output", value: "raw-ready" },
    { type: "restore", value: "line" },
  ],
  alternate: [
    { type: "mode", value: "alternate" },
    { type: "output", value: "\\u001b[?1049h" },
    { type: "restore", value: "line" },
  ],
  "cursor-repaint": [
    { type: "output", value: "\\u001b[2J\\u001b[Hrepaint" },
    { type: "restore", value: "line" },
  ],
  "async-output": [
    { type: "output", value: "background-event" },
    { type: "restore", value: "line" },
  ],
  "bracketed-paste": [
    { type: "output", value: "\\u001b[200~paste\\u001b[201~" },
    { type: "restore", value: "line" },
  ],
  hidden: [
    { type: "mode", value: "hidden" },
    { type: "output", value: "Password: " },
    { type: "restore", value: "line" },
  ],
  "unicode-wrap": [
    { type: "output", value: "é界😀" },
    { type: "restore", value: "line" },
  ],
  "completion-menu": [
    { type: "output", value: "completion-menu" },
    { type: "restore", value: "line" },
  ],
  "malformed-ansi": [
    { type: "output", value: "\\u001b[broken" },
    { type: "restore", value: "line" },
  ],
  resize: [
    { type: "resize", value: "20x4" },
    { type: "restore", value: "line" },
  ],
  signal: [
    { type: "signal", value: "SIGINT" },
    { type: "restore", value: "line" },
    { type: "exit", value: 130 },
  ],
  "exit-code": [
    { type: "restore", value: "line" },
    { type: "exit", value: 23 },
  ],
};

function runCli(): void {
  const scenario = process.argv[2] as FixtureScenario | undefined;
  const mode = process.argv.includes("--interactive")
    ? "interactive"
    : "transcript";
  if (scenario === undefined || !(scenario in scenarios)) {
    process.stderr.write("usage: tui-fixture <scenario> [--interactive]\n");
    process.exitCode = 64;
    return;
  }
  if (mode === "interactive")
    process.stdout.write(
      "interactive mode uses the same deterministic semantic events\n",
    );
  for (const event of transcript(scenario))
    process.stdout.write(`${JSON.stringify(event)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  runCli();
