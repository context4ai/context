# Contributing to Context

Thank you for helping improve Context. Contributions can include bug reports, documentation, extraction adapters, workflow contracts, tests, SDK changes, and CLI behavior.

## Before opening a pull request

- Search existing Issues and Discussions first.
- Discuss changes to workspace protocols, lifecycle ordering, public CLI JSON, or package layout before implementation.
- Small documentation fixes and isolated bug fixes can go directly to a pull request.
- Report security vulnerabilities privately by following [SECURITY.md](./SECURITY.md).

## Development setup

Context uses Bun for dependency management, builds, linting, and tests. Published runtime code must remain compatible with Node.js 20 and newer.

```bash
git clone https://github.com/context4ai/context.git
cd context
bun install
bun run verify:full
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for source, link, pack, plugin, verification, and release workflows.

## Pull request expectations

A change is ready for review when:

- `bun run verify:full` passes;
- lifecycle behavior includes route and recovery coverage;
- the CLI does not make semantic decisions that belong to the Agent or user;
- tests use neutral fixtures rather than business-specific content;
- English and Simplified Chinese user documentation remain behaviorally equivalent;
- generated `dist/`, workspace data, snapshots, credentials, and private source material are not committed.

Keep pull requests focused. Explain the problem, observable behavior, compatibility impact, and verification evidence.

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
