# @c4a/extract-rush

Deterministic Rush workspace indexing for package identity, tags, subspaces,
entry signals, local dependency edges, decoupled dependencies, and nearest
`OWNERS` boundaries. Product-specific categories remain the consumer's concern.

```ts
import { indexRushWorkspace } from "@c4a/extract-rush";

const facts = await indexRushWorkspace(repositoryRoot, { tags: ["frontend"] });
```

This optional package does not add a Context CLI phase. A knowledge project can
map the returned facts to candidates in its own `extractCustom()` callback.
