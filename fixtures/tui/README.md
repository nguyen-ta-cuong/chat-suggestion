# Open TUI conformance fixture

The fixture exports deterministic semantic transcripts for line, raw,
alternate-screen, cursor repaint, asynchronous output, bracketed paste, hidden
input, Unicode wrapping, completion menu, malformed ANSI, resize, signal, and
exit-code scenarios. It contains no agent-specific behavior or captured user
session data.

After building, run a transcript without touching the active terminal:

    node fixtures/tui/dist/index.js raw

The command emits bounded JSON events. Interactive mode is explicit and uses the
same scenarios:

    node fixtures/tui/dist/index.js raw --interactive
