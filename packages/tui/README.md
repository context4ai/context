# Context Terminal Components

[简体中文](./README.zh-CN.md)

`@c4a/tui` contains shared Ink and React components used by Context repository
development tools. Its current consumer is `@c4a/dev-cli`.

This is a maintainer-facing UI library, not the Context knowledge workflow and
not the user-facing Agent integration. Keeping it separate lets development
menus share layout, prompts, and CJK-aware text behavior without adding terminal
UI dependencies to the runtime or SDK.

## Package relationship

```text
@c4a/tui → @c4a/dev-cli → repository maintenance
```

It has no internal package dependencies and is not required by knowledge
workspaces.

## Key exports

- `CascadeMenu` — multi-level interactive terminal menu;
- `Header` — shared menu header;
- `HelpPanel` — contextual help display;
- `confirm()` — confirmation dialogue;
- `pickDirectory()` — interactive directory picker;
- `displayWidth()`, `padToWidth()`, and `truncateToWidth()` — CJK-aware width
  utilities;
- `MenuItem` — menu item type.

## Development

```bash
bun run --filter @c4a/tui build
bun run --filter @c4a/tui typecheck
bun run --filter @c4a/tui lint
```

Runtime components remain compatible with Node.js; Bun-specific APIs belong
only in build or test tooling.
