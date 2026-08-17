---
id: procedure.project-configuration
kind: procedure
mediaType: text/markdown
---

# Project configuration

Use the current route facts and Context SDK documentation to make only the
declaration requested by the route in `src/index.ts`.

- Do not invent sources, modules, collections, or output types.
- Ask for a user decision when the route is gated and no current-session
  authority is present.
- Keep source registration, capture, extraction, align, compile, review, and
  package declarations paired by their canonical source and collection.
- After editing, run `context status --format json` again. The workspace facts,
  not the edit itself, determine whether the route is complete.

The Context SDK API reference is a discoverable resource. Do not guess an API
shape from older prompts or cached plugin text.
