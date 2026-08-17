# Context Development

This guide explains how a contributor or an agent can run the Context CLI,
SDK, and bundled agent plugin from a local checkout. Product workflows and the
published installation path remain documented in the package READMEs.

## Choose A Mode

| Mode | CLI used | SDK used by a test workspace | Use it for |
|---|---|---|---|
| Source | `packages/context-cli/src/cli.ts` through Bun | Whichever dependency the workspace already declares | Fast CLI debugging without replacing the global command |
| Link dev | Built `packages/context-cli/dist/cli.js` through the global `context` link | Local `@c4a/context` resolved by `context init --dev` | Normal local development and real agent integration |
| Published npm | Installed registry package, executed by Node | Versioned npm dependency | End-user installation smoke testing |
| Local pack | Installed prepared tarball, executed by Node | SDK artifact installed beside that CLI, selected through `--dev` | Pre-publish artifact smoke testing |

Use link dev for end-to-end work. It exercises the built CLI, the local SDK,
and the same bundled plugin tree that is shipped to users.

## Prerequisites

- Bun for installing workspace dependencies, building, and running tests.
- Node.js and npm for the globally linked or published CLI surface.
- Claude Code or Codex only when testing the corresponding agent plugin.

From the repository root:

```bash
bun install
```

Project build, test, typecheck, and lint commands must use Bun. npm is used only
for npm installation, linking, packing, and publishing surfaces.

## Source Mode

Run a command directly from the checkout:

```bash
./start.sh context --version
./start.sh context plugin path
```

`./start.sh context` runs with the CLI package as its working directory. It is
therefore best for commands that do not need to discover a separate Context
project. To run source code against a scratch project, invoke the source entry
from that project directory:

```bash
cd /path/to/scratch-context
bun run /path/to/context/packages/context-cli/src/cli.ts status
```

Source mode does not update the global `context` command or installed agent
plugin. Use link dev when an agent must invoke the local implementation.

## Link Dev Mode

From the repository root:

```bash
./start.sh link
context --version
context plugin path
```

`./start.sh link`:

1. builds `@c4a/context-cli` and `@c4a/context`;
2. replaces an existing global `context` installation after confirmation and
   links `packages/context-cli/dist` as the global command;
3. registers the local `@c4a/context` package with Bun for direct Bun link use;
4. refreshes the available Claude and Codex plugins. A plugin refresh failure
   is reported without rolling back a successful CLI/SDK link.

For non-interactive execution, `start.sh` accepts the link replacement without
prompting. An agent should report this global-environment change before running
it unless the user has already requested link mode.

### Create A Scratch Workspace

Keep development workspaces under this repository's ignored `.tmp/` directory:

```bash
context init .tmp/dev-context --name dev-context --dev
cd .tmp/dev-context
bun install
context status
```

The generated `package.json` should point at the SDK resolved beside the active
local CLI, for example:

```json
{
  "dependencies": {
    "@c4a/context": "file:/path/to/context/packages/context"
  }
}
```

`--dev` changes the generated SDK dependency. It does not select the CLI; the
CLI still comes from the global link created by `./start.sh link`.

Do not use a customer workspace for destructive development checks. Do not add
`@c4a/context-cli` to the scratch project's dependencies: project workspaces
consume the global CLI and keep only the SDK dependency.

## Refresh After A Change

| Changed files | Required refresh |
|---|---|
| CLI or SDK TypeScript | Run `./start.sh link` again |
| `packages/context-cli/plugin/` | Run `./start.sh link` |
| Agent commands, skills, or manifests | Reinstall the plugin and restart the agent session |
| Generated project templates owned by the SDK | Run `./start.sh link`, then initialize a fresh scratch workspace |

Never edit `packages/*/dist` or `packages/context-cli/dist/plugins` directly.
They are generated outputs. Plugin source is maintained under
`packages/context-cli/plugin/`.

Codex plugin refreshes use the version declared by the bundled plugin manifest
for both link dev and npm/pack installs. Reinstalling the same dev version fully
replaces that version's cache; after the new cache is ready, `local` aliases and
older version directories are removed. A new agent session therefore resolves
the same versioned Skill path in both modes.

## Agent Debug Contract

Before diagnosing local behavior, an agent should record:

```bash
command -v context
context --version
context plugin path
context plugin status
```

It should also inspect the scratch project's `package.json` to distinguish a
linked SDK from a published dependency. This prevents results from mixing a
local CLI with an old SDK, or a new CLI with stale agent commands.

Agents may execute normal build, link, plugin refresh, scratch initialization,
and verification steps when those actions are already in scope. They must not
silently replace a user's global CLI, test inside a real customer workspace, or
publish packages.

## Npm And Pack Smoke Testing

Npm-mode testing validates a different boundary from link mode: the CLI runs
with Node and must resolve only files included in the package artifact.

Use an isolated npm prefix or disposable environment for installation whenever
possible. Global installation refreshes available agent plugins automatically.
Set `CONTEXT_CLI_SKIP_PLUGIN_INSTALL=1` when an artifact-only smoke test must not
change user-level agent configuration. Verify at least:

```bash
context --version
context plugin path
context plugin status
context init /path/to/npm-smoke --name npm-smoke
```

If the automatic refresh reports a warning, run `context plugin install`
manually after fixing the reported agent CLI issue.

For an exact published npm smoke test, omit `--dev`; the initialized workspace
must resolve the SDK version from the registry.

For a local pack whose matching `@c4a/context` version is not published yet,
initialize the scratch workspace in dev mode:

```bash
context init /path/to/pack-smoke --name pack-smoke --dev
```

This keeps the globally installed CLI on the packed Node artifact and writes a
`file:` dependency to the SDK package installed beside that active CLI. It does
not switch the CLI back to link mode or require a Bun link registration. After
initialization, install dependencies and run `context status` from the new
workspace.

The publish helper prepares package metadata inside `dist/`, including replacing
the CLI's `workspace:*` SDK dependency with a release version. A local pack test
must pack those prepared publish directories, not the source package directories;
packing `packages/context-cli` directly does not represent the published
artifact. If no prepared local artifact is available, test the exact published
version instead of approximating the package layout.

## Verification

Run focused package checks while developing:

```bash
bun run --filter @c4a/context-cli typecheck
bun run --filter @c4a/context-cli lint
bun run --filter @c4a/context-cli test
```

Run the repository gates before handing off a completed change:

```bash
./start.sh verify
./start.sh verify:full
```

`verify` runs typecheck, lint, and unit/integration tests. `verify:full` also
runs the Context CLI end-to-end suite.

## Cleanup And Restore

Remove the local global CLI link and Bun SDK registration with:

```bash
./start.sh unlink
```

Unlink does not restore a previously installed npm version. After unlinking,
either install the intended published version explicitly or rerun
`./start.sh link` to return to local development. Refresh the plugin after the
CLI mode changes so its installed commands and skills match the active package.

Scratch workspaces may be removed from `.tmp/` after testing.

## Common Problems

- **Changes do not appear:** rebuild with `./start.sh link`; the global command
  runs bundled `dist/`, not TypeScript source.
- **Agent behavior is stale:** reinstall the plugin and restart the agent
  session.
- **Wrong CLI is running:** compare `command -v context`, `context --version`,
  and `context plugin path` with the intended mode.
- **Local SDK changes do not appear:** initialize the scratch workspace with
  `--dev`, confirm its `@c4a/context` dependency is a `file:` path to the local
  SDK, then rerun `bun install` in that workspace.
- **Published npm smoke differs from link:** confirm the test used the exact
  published CLI and SDK versions and omitted `--dev`.
- **Local pack cannot install the SDK:** if the matching SDK version is not in
  the registry, ensure the prepared CLI artifact includes that SDK dependency
  and initialize the scratch workspace with `--dev`.

Package-specific plugin build details are documented in
[`packages/context-cli/DEVELOPMENT.md`](./packages/context-cli/DEVELOPMENT.md).
