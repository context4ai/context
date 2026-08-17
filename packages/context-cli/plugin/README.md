# Context Plugin

> [中文版本](./README_CN.md)

<p align="center"><img src="./assets/logo.svg" alt="C4A Context" width="180"/></p>

Context provides a thin Agent entry for project-local knowledge workspaces. The
plugin does not embed the whole workflow in one prompt. It starts from current
workspace facts, then Context CLI selects the legal route, commands, gates, and
Markdown/schema resources for that step.

## Install

```bash
npm i -g @c4a/context-cli
context plugin install
```

For a source checkout, build the CLI and plugin first:

```bash
bun run --filter @c4a/context-cli build
context plugin install --dev
```

Use `context plugin install --dry-run` to inspect installation and
`context plugin path` to locate the bundled marketplace.

## Agent entry

The public host surface stays small:

- `init` creates a Context workspace;
- `continue` observes and advances an existing workspace.

Continuation starts with:

```bash
context status --format json
```

`workflow.current` is the current-step authority. The Agent reads every required
resource marked `read_state: read-required`, executes only returned commands,
preserves revision and authority flags, and reevaluates status after each
action. Current-conversation read receipts may be passed back through
`context status --resource-receipts @<file>` so unchanged resources are marked
`current`. A dynamic materialization becomes a receipt only after the Agent
reads the complete returned file. `context.source-body/*` resources are source
text; source indexes and heading metadata never replace the body. Long procedures and semantic
judgment rules are published in the Context workflow bundle and loaded only
when the current route or operation selects them.

Gate inspection and resolution Actions keep their own Skill and Schema
locators. The Agent loads those conditional resources only when it enters that
phase; they are not preloaded with the Route's ordinary required resources.

The two entry documents are also the source for hosts that expose Agent Skills
instead of commands. There are no stage-specific skills: source, alignment,
compile, review, and package guidance comes from the route-selected workflow
resources.

## Human gates and managed sessions

Ordinary mode preserves source, read-permission, scope, structure, Review, and
package decisions as explicit gates. Fully managed mode is available only when
the user explicitly requests it in the current conversation:

```bash
context status --managed --format json
```

That session authority is not stored. It cannot choose source boundaries,
authorize unread external content, perform external repository operations, or
bypass validation and verification.

After the initial managed status, consecutive deterministic routes can be
collapsed with:

```bash
context run --managed --until blocked-or-complete --format json
```

The loop stops before any route that needs Agent interpretation, configuration,
additional authority, or diagnostic repair, and returns the current workflow
route for normal progressive loading.

## Workspace and SDK

Run the plugin from the initialized Context project root. Project declarations
live in `src/index.ts`; source state, draft state, approved knowledge, generated
packages, and disposable runtime state remain owned by Context CLI.

After workspace dependency installation, the SDK manual starts at:

```text
node_modules/@c4a/context/docs/README.md
```

The plugin does not expose source deletion, purge, or retraction. It also does
not silently clone, fetch, checkout, install, build, test, or call an LLM.
