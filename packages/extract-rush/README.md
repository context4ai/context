# Rush Workspace Structure for Context

[简体中文](./README.zh-CN.md)

`@c4a/extract-rush` creates a deterministic structural index of a Rush
workspace. It reports project identity, tags, subspaces, publish intent, entry
signals, direct dependency/consumer edges, build phases and commands, release
units, decoupled dependencies, and nearest `OWNERS` boundaries.

The index is evidence for a Context knowledge project; it is not a product
taxonomy. A project decides which facts matter to its audience and maps them to
candidates through `extractCustom()`. Context continues to own source identity,
candidate freshness, review, approved knowledge, and package output.

## Place in the knowledge workflow

```text
confirmed Rush repository boundary
              ↓
rush.json + package.json + Rush config + OWNERS facts
              ↓
project-owned candidate mapping
              ↓
reviewed architecture / ownership / package knowledge
```

## Usage

```ts
import {
  indexRushWorkspace,
  rushWorkspaceIndexToEvidenceAdapterResult,
} from "@c4a/extract-rush";

const facts = await indexRushWorkspace(repositoryRoot, {
  tags: ["frontend"],
});

const evidence = rushWorkspaceIndexToEvidenceAdapterResult(facts, invocation);
```

With no tag filter, all projects are selected. `includeAll: true` explicitly
selects every project. Results are sorted and stable, making them suitable for
source fingerprints and repeatable candidate generation.

The index includes:

- Rush and package-manager versions;
- package names and whether `package.json` identity matches `rush.json`;
- project folders, subspaces, tags, and publish flags;
- the registered subspace catalog and project membership;
- `main`, `module`, `types`, `exports`, and `bin` entry signals;
- local dependency kinds, direct consumers, and specifiers, including
  decoupled edges;
- phased-build dependencies, command-to-phase bindings, and per-project phase
  implementation presence;
- lock-step, individual-policy, and standalone release units;
- nearest repository-relative `OWNERS` file and normalized reviewers.

Build facts retain command and script identity only as content digests. The
index and Evidence ABI never copy raw shell commands or package scripts into
facts.

This optional package does not add a public Agent entry or Context lifecycle
phase. It remains a reusable structural library for project adapters.
The Evidence ABI conversion assigns one primary owner to each `rush.json`,
selected `package.json`, and `OWNERS` input, binds project files to authorized
module refs, and publishes workspace/project/dependency/owner facts as catalog
protocol items. `subspaces.json`, `command-line.json`, and
`version-policies.json` become separately owned evidence files when present.

## Development

```bash
bun run --filter @c4a/extract-rush build
bun run --filter @c4a/extract-rush typecheck
bun run --filter @c4a/extract-rush test
bun run --filter @c4a/extract-rush lint
```
