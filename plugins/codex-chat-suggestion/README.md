# Chat Suggestion for Codex

This is a Codex companion plugin, not a stock-TUI editor replacement. Codex
plugins can add skills, hooks, MCP servers, and apps, but this plugin does not
receive the live prompt buffer or cursor and therefore cannot render or accept
Cursor-style ghost text while you type.

Install it through the Codex plugin marketplace flow or load this directory as
a local plugin. Use the `chat-suggest` skill after submitting a prompt when you
want a bounded continuation to review manually. Nothing is inserted or
submitted automatically, and the skill never claims native inline support.
