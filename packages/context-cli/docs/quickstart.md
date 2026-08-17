# CLI Quickstart

This file is shipped with the installed CLI at `dist/docs/quickstart.md`.
It is for users who have installed the `context` executable and need the next
step before an agent plugin or project workspace is ready.

## 1. Install Agent Plugin Entry Points

Install the bundled agent plugin first:

```bash
context plugin install
```

The plugin adds the user-facing agent entries for workspace initialization and
continuation. Exact command names depend on the host agent, but the intended
flow is:

- initialize a Context workspace through the plugin entry when available;
- continue work through the plugin entry after a workspace exists;
- let the agent follow `context status`, CLI diagnostics, and human gates.

If the host agent has not loaded the plugin yet, restart or refresh that agent
after installation.

## 2. Create a Project Workspace

Create a standalone workspace:

```bash
context init context
```

Choose the generated workspace and starter-template language explicitly when
needed; the CLI does not infer it from terminal locale or conversation text:

```bash
context init context --language zh-CN
```

Then enter it and install dependencies:

```bash
cd context
bun install
```

After initialization, read the workspace guidance:

```text
AGENTS.md
```

`AGENTS.md` explains the current project, SDK references, installed Agent
entry, and safe workflow contract. It is the project-local starting point after
`context init`.

## 3. Work Through an Agent

Inside the workspace, ask the installed agent plugin to continue the workflow.
The agent should:

1. read `AGENTS.md`;
2. run `context status --format json`;
3. treat `workflow.current` as the current-step authority, read each
   `resources.required` item, and execute only the returned command or
   configuration action;
4. at a Gate, load an `inspection_action` Skill or Schema only for
   pre-decision inspection and a `resolution_action` Skill or Schema only
   after confirmation;
5. stop at human gates such as source scope, structure confirmation, review,
   and package decisions.

The CLI performs mechanical work such as source registration, capture,
validation, review application, verify, close, and build. The agent performs
semantic judgment only when the workflow asks for it.

When the user explicitly requests fully managed operation, the Agent starts with
`context run --managed --until blocked-or-complete --format json` to collapse
consecutive deterministic routes. The CLI re-evaluates every revision and
stops before semantic reads, configuration, missing authority, diagnostics, or
multiple commands.

## 4. Manual Orientation

When operating without an agent plugin, start with:

```bash
context status
```

If the command reports that no workspace exists, run `context init` first. If a
workspace exists, prefer the next action reported by `context status` instead of
guessing lower-level phase commands.

Project-local SDK documentation is installed under:

```text
node_modules/@c4a/context/docs/README.md
```

Use those SDK docs when editing `src/index.ts` or package templates. For normal
workflow operation, prefer the agent plugin and the workspace `AGENTS.md`.
