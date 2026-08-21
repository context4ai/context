# Context Development Menu

[简体中文](./README.zh-CN.md)

`@c4a/dev-cli` is the repository-maintenance entry for Context contributors.
It groups build, verification, versioning, publishing preparation, and global
link operations behind one interactive or scripted menu.

This package is not part of the end-user knowledge production workflow. Users
work through the Context Agent integration; maintainers use this menu to make
the runtime, SDK, extraction packages, and plugin projections ready for that
experience.

## Responsibilities

```text
source packages
     ↓
build / verify / link / release preparation
     ↓
local development install or publishable artifacts
```

- orchestrate repository build and verification commands;
- link or unlink a local Context runtime for integration testing;
- coordinate version and release preparation across published packages;
- expose an interactive menu built with `@c4a/tui`;
- keep hosted server, storage, and web application operations outside this
  standalone repository.

## Usage

Open the interactive menu:

```bash
bun run --filter @c4a/dev-cli start
```

Run a known operation directly:

```bash
bun run --filter @c4a/dev-cli start build
bun run --filter @c4a/dev-cli start verify
bun run --filter @c4a/dev-cli start link
bun run --filter @c4a/dev-cli start unlink
bun run --filter @c4a/dev-cli start bump <version>
bun run --filter @c4a/dev-cli start publish <version>
```

Real publishing remains governed by the repository release workflow and
requires explicit authorization. A successful local build or link is not proof
that a package was published.

See the repository [Development guide](../../DEVELOPMENT.md) for source,
packaged-install, and release checks.
