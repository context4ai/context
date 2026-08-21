# Start Context through an Agent

[简体中文](./quickstart.zh-CN.md)

This file ships with the installed runtime. Context is designed to be used from
its Agent entry: the user states a knowledge goal, and the Agent follows the
current workflow Route. The low-level CLI exists to execute that workflow; it
is not the first interface users need to learn.

## 1. Install the Agent integration

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

Restart or refresh the Agent host so it discovers the installed entry.

## 2. Invoke the single entry

Use `/c4a:context` for both new and existing workspaces. Describe the source
material, intended audience, and desired output in normal language:

```text
/c4a:context Build a traceable Agent knowledge package from the Markdown in
docs/ and the exported APIs in packages/example. Ask me before approving the
knowledge structure.
```

The entry first runs the read-only `context entry --format json` resolver. It
will either:

- propose initialization at a concrete project path;
- relocate into an existing Context workspace; or
- return the current `workflow.current` Route.

Initialization writes a new workspace and therefore remains explicit. Entering
or evaluating an existing workspace is read-only and does not need a second
confirmation.

## 3. Follow the conversation

The Agent will guide the knowledge production round through source permission,
capture or code extraction, structure design, candidate compilation, review,
close, verification, and package output. At each step it should explain:

- what has already been established from workspace facts;
- what decision is needed now and what that decision changes;
- which evidence or report supports the decision;
- what will happen after confirmation.

The Agent reads Route-selected resources and executes exact Route-selected
commands. Users should not need to translate placeholders such as `<phase-id>`
or `<collection>` into internal CLI arguments.

## 4. Choose a conversation mode

Ordinary mode is the default. It exposes review decisions and HTML inspection
reports so the user can adjust intermediate content.

Fully managed mode must be explicitly authorized in the current conversation.
It lets the Agent collapse deterministic work and delegated review surfaces,
while preserving permissions, evidence checks, validation, and verification.
The Agent still stops whenever it needs semantic reading, project
configuration, external authority, or diagnostic repair.

## 5. Understand the workspace

After initialization, the project-local `AGENTS.md` is the entry contract for
the Agent. `src/index.ts` declares the project; `sources/` keeps captured
evidence; `knowledge/` keeps approved knowledge; `dist/` contains reproducible
outputs; `.tmp/context-runtime/` contains disposable runtime state.

Do not edit CLI-owned lifecycle files to force progress. If work is blocked,
the current Route or diagnostic provides the canonical recovery action.

## Maintainer orientation

If an Agent integration is unavailable, `context status --format json` exposes
the same current Route for manual inspection. Use `context <command> --help`
for exact flags, and prefer commands returned by `workflow.current` over
examples copied from documentation.

The SDK reference installed in a workspace starts at:

```text
node_modules/@c4a/context/docs/README.md
```

Use it when a Route asks for project configuration or package-template work.
