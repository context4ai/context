# @c4a/context-cli Plugin Development

The complete local development workflow is documented in the workspace
[`DEVELOPMENT.md`](../../DEVELOPMENT.md). This file records only the CLI
package's plugin-specific boundaries.

## Surfaces

`@c4a/context-cli` ships the `context` executable and generated plugin surfaces
in one npm package:

- Claude commands under `dist/plugins/claude/commands/`;
- Codex skills under `dist/plugins/codex/skills/`;
- Cursor commands under `dist/plugins/cursor/commands/`;
- standalone skills under `dist/plugins/skills/`.

There is no separate marketplace repository. Maintain plugin source only under
`packages/context-cli/plugin/`. The package build generates
`packages/context-cli/dist/plugins/`; never edit that tree directly.
Do not
update any standalone marketplace checkout as a production surface.
Keep entry commands and Skills thin. If a lifecycle procedure, diagnostic,
semantic rule, schema, or dynamic view is missing, add it under
`packages/context-cli/context-workflow/`, reference it from the graph, and
rebuild. Keep only plugin entry descriptions and the instructions for consuming
`workflow.current` under `packages/context-cli/plugin/`.

## Build And Refresh

From the workspace root:

```bash
./start.sh link
context plugin path
```

The link command resolves `dist/plugins` next to the active CLI package and
automatically prunes stale Context-owned Claude/Codex plugin state before
reinstalling. A plugin failure does not roll back the CLI link; run
`context plugin install` manually to retry. After changing commands, manifests,
plugin documentation, or workflow resources, rebuild/relink and restart the
agent session.

Use `context plugin path` to confirm that a linked checkout resolves this
package's generated plugin tree rather than an older globally installed npm
package.
