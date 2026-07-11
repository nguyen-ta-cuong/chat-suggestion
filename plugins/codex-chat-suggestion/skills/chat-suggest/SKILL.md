---
name: chat-suggest
description:
  Propose a short continuation for a submitted Codex prompt when the user
  explicitly asks for one.
---

# Chat Suggestion companion workflow

Use this skill only after the user has submitted a prompt and explicitly asks
for a continuation or rewrite. Return one short plain-text option for the user
to review. Do not execute it, submit it, or pretend that it is live ghost text.

The Codex stock terminal editor does not expose a documented live draft, cursor,
decoration, or atomic non-submitting insertion API to this plugin. If a user
asks why no suggestion appears while typing, report `inlineRender: none` and
explain that this companion skill is manual and post-submit only.
