# Context

[简体中文](./README.zh-CN.md)

**Context** is a local knowledge assistant for Coding Agents. It helps turn code
repositories, local documents, and Lark documents into reviewable, traceable,
maintainable knowledge, then builds that knowledge into reusable packages for
Agents.

You can start before you know the final taxonomy or package structure. Tell the
Agent where the source material lives and what you hope to use it for. Context
guides the conversation through source scope, extraction, classification,
review, verification, and package output.

## What Context Does

- Creates a project-local Context workspace instead of hiding state in a remote
  job.
- Captures document evidence and extracts structured information from code.
- Keeps generated knowledge tied to source evidence for review and later
  updates.
- Stops for user decisions at source scope, structure, review, and package
  output gates.
- Builds approved knowledge into an Agent knowledge-base package or another
  declared output.

Compared with one-shot or remote distillation, Context behaves more like a
knowledge assistant working beside you. It is useful when you know where the
knowledge is but still need help deciding how to extract, organize, and publish
it.

## Quick Start

Install the CLI and Agent plugin:

```bash
npm install -g @c4a/context-cli
context plugin install
```

Restart the Agent after installation, then use:

- `/context:init` to create a workspace.
- `/context:continue` to load an existing workspace and continue from its
  current state.

The Agent will explain the next decision instead of asking you to operate the
low-level CLI directly. For installation details and CLI behavior, read the
[Context CLI guide](./packages/context-cli/README.md).

## Workspace At A Glance

```text
context/
|-- AGENTS.md
|-- README.md
|-- package.json
|-- src/          # project configuration and package templates
|-- sources/      # source registries and captured evidence
|-- knowledge/    # durable knowledge, structure, and rejected fingerprints
|-- dist/         # generated packages (ignored)
`-- .tmp/         # disposable lifecycle state (ignored)
```

The workspace is ordinary project state that can be inspected, reviewed, and
versioned. `src/index.ts` describes the knowledge build, while the other
directories record evidence and durable knowledge. Active candidates and staged
structures live only under the ignored `.tmp/context-runtime/lifecycle/`; a
successful close removes that completed runtime state. The CLI owns state changes;
the Agent owns explanation, configuration, and semantic judgment; the user owns
the important decisions.

## Packages

- [`packages/context`](./packages/context/README.md) is the declarative SDK used
  by `src/index.ts`. Its guide covers sources, phases, knowledge collections,
  package declarations, templates, and custom processing.
- [`packages/context-cli`](./packages/context-cli/README.md) provides the
  `context` executable and Agent plugin installer. Its guide covers installation,
  workspace operations, command groups, and workflow rules.
- [`packages/extract-ts`](./packages/extract-ts/README.md),
  [`packages/extract-go`](./packages/extract-go/README.md), and
  [`packages/extract-rush`](./packages/extract-rush/README.md) provide reusable
  structural facts. Only TypeScript is wired into the built-in CLI lifecycle;
  projects opt into Go and Rush from `extractCustom()`.

The SDK manuals under [`packages/context/docs`](./packages/context/docs/README.md)
contain the detailed project API and package-template references. The CLI also
ships a concise [quickstart](./packages/context-cli/docs/quickstart.md).

## Ask The Agent

> The Context plugin includes thin Agent entries backed by route-selected
> workflow resources and manuals. Once Context has loaded the workspace, ask the
> Agent about anything that is unclear or share any idea you want to explore.
> The Agent can use the current evidence and project state to turn that
> conversation into reviewable, usable knowledge.

## Repository Development

For source, link, Agent plugin, and npm-mode development, see
[`DEVELOPMENT.md`](./DEVELOPMENT.md).

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run lint
bun run verify
```

Link the local CLI:

```bash
./start.sh link
```

## Community

- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)
- [Security policy](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Release history](./CHANGELOG.md)
