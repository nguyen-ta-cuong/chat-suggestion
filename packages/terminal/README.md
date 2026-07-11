# Terminal safety primitives

This package contains agent-neutral terminal safety helpers. `sanitizeTerminalText`
removes terminal control sequences and applies byte, character, line, and grapheme
limits. Width helpers use `Intl.Segmenter` and conservative Unicode cell widths.
`InputConfidenceTracker` begins suspended, becomes usable only after an explicit
handshake, and clears captured draft text on any ambiguous input, child output,
hidden-input marker, alternate-screen transition, or resize.

The tracker is deliberately not a terminal emulator and never treats child output
as proof of a logical prompt buffer. Callers must render nothing unless
`canRenderSuggestion()` returns true.
