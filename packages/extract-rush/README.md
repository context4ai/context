# Rush Workspace Structure for Context

[简体中文](./README.zh-CN.md)

`@c4a/extract-rush` creates a deterministic structural index of a Rush
workspace. It reports project identity, tags, subspaces, publish intent, entry
signals, local dependency edges, decoupled dependencies, and nearest `OWNERS`
boundaries.

The index is evidence for a Context knowledge project; it is not a product
taxonomy. A project decides which facts matter to its audience and maps them to
candidates through `extractCustom()`. Context continues to own source identity,
candidate freshness, review, approved knowledge, and package output.

## Place in the knowledge workflow

```text
confirmed Rush repository boundary
              ↓
rush.json + package.json + OWNERS facts
              ↓
project-owned candidate mapping
              ↓
reviewed architecture / ownership / package knowledge
```

## Usage

```ts
import { indexRushWorkspace } from "@c4a/extract-rush";

const facts = await indexRushWorkspace(repositoryRoot, {
  tags: ["frontend"],
});
```

With no tag filter, all projects are selected. `includeAll: true` explicitly
selects every project. Results are sorted and stable, making them suitable for
source fingerprints and repeatable candidate generation.

The index includes:

- Rush and package-manager versions;
- package names and whether `package.json` identity matches `rush.json`;
- project folders, subspaces, tags, and publish flags;
- `main`, `module`, `types`, `exports`, and `bin` entry signals;
- local dependency kinds and specifiers, including decoupled edges;
- nearest repository-relative `OWNERS` file and normalized reviewers.

This optional package does not add a public Agent entry or Context lifecycle
phase. It remains a reusable structural library for project adapters.

## Development

```bash
bun run --filter @c4a/extract-rush build
bun run --filter @c4a/extract-rush typecheck
bun run --filter @c4a/extract-rush test
bun run --filter @c4a/extract-rush lint
```
