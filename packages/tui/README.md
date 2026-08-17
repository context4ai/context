# @c4a/tui

Shared terminal UI components built on Ink and React for CLI applications.

## Role in the monorepo

Provides reusable TUI components used by `dev-cli` for interactive terminal
menus and prompts.

**Depends on:** (no internal packages)
**Depended on by:** `dev-cli`

## Key exports

- `CascadeMenu` — multi-level interactive terminal menu
- `Header` — styled header component
- `HelpPanel` — help text display
- `confirm()` — confirmation dialog
- `pickDirectory()` — interactive directory picker
- `displayWidth()` / `padToWidth()` / `truncateToWidth()` — CJK-aware string width utilities
- `MenuItem` type — menu item definition

## Development

```bash
bun run --filter @c4a/tui build
bun run --filter @c4a/tui typecheck
bun run --filter @c4a/tui lint
```
