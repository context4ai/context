# @c4a/dev-cli

Developer menu for the standalone Context workspace.

It provides build, verification, versioning, publishing, and global link
operations for the standalone Context workspace. Hosted server and web runtime
operations are outside this repository.

```bash
bun run --filter @c4a/dev-cli start
bun run --filter @c4a/dev-cli start build
bun run --filter @c4a/dev-cli start verify
bun run --filter @c4a/dev-cli start link
bun run --filter @c4a/dev-cli start unlink
bun run --filter @c4a/dev-cli start bump <version>
bun run --filter @c4a/dev-cli start publish <version>
```
