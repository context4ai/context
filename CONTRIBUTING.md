# Contributing to Context

Thank you for helping improve Context. Contributions can include bug reports,
documentation, Indexer Skills, extraction adapters, workflow contracts, tests,
SDK changes and CLI behavior.

## Ways to contribute

- **Report a defect** with a minimal, sanitized reproduction through the
  [issue templates](https://github.com/context4ai/context/issues/new/choose).
- **Improve the documentation.** User documentation lives on the
  [documentation site](https://context4ai.org/context/), which is built from
  [context4ai/portal](https://github.com/context4ai/portal); package references
  live in this repository.
- **Share an Indexer.** Indexer Skills teach Context how to read a new kind of
  source. See [Creating an Indexer](https://context4ai.org/context/pages/ea58e96a208549b9844ac19839769dcc.html)
  and [Community Indexers](https://context4ai.org/context/pages/00a7aadc3fbf4dfcf516eb65a16fd711.html).
- **Add a language extractor** under `packages/extract-*`, following the
  protocol in [`@c4a/extract`](./packages/extract/README.md).
- **Change the workflow, SDK or CLI** after the discussion described below.

The site's [Contributing](https://context4ai.org/context/pages/dc922b367e72f93b71f40058a6059300.html)
page gives the same overview across the Context projects.

## Before opening a pull request

- Search existing Issues and Discussions first.
- Discuss changes to workspace protocols, lifecycle ordering, public CLI JSON,
  or package layout in an Issue or Discussion before implementation.
- Small documentation fixes and isolated bug fixes can go directly to a pull
  request.
- Report security vulnerabilities privately by following [SECURITY.md](./SECURITY.md).

## Development setup

Context uses Bun for dependency management, builds, linting and tests.
Published runtime code must remain compatible with Node.js 20 and newer.

```bash
git clone https://github.com/context4ai/context.git
cd context
bun install
bun run build
bun run verify
```

[DEVELOPMENT.md](./DEVELOPMENT.md) covers the repository layout, running a
local CLI and plugin, verification scopes and releases.
[Module Layout](https://context4ai.org/context/pages/48ba914060b8913ca26c053abac47fac.html)
shows which package a change belongs to.

## Pull request expectations

A change is ready for review when:

- `bun run verify:full` passes;
- lifecycle behavior includes route and recovery coverage;
- the CLI does not make semantic decisions that belong to the Agent or user;
- tests use neutral fixtures rather than business-specific content;
- English and Simplified Chinese user documentation remain behaviorally
  equivalent;
- user-visible changes have an entry under the next version in
  [CHANGELOG.md](./CHANGELOG.md);
- generated `dist/`, workspace data, snapshots, credentials and private source
  material are not committed.

Keep pull requests focused. Explain the problem, observable behavior,
compatibility impact and verification evidence.

## Commit messages

Use an English conventional commit that names the target version:

```text
feat(v0.7.60): add multilingual knowledge websites
fix(v0.7.62): exempt More menu targets from knowledge map coverage
docs(v0.7.62): link the README to the documentation site
```

## Releases

Maintainers release by creating a GitHub Release whose tag matches the package
version; the publish workflow verifies and publishes every package through npm
Trusted Publishing. See [Release Automation](./DEVELOPMENT.md#release-automation).

## Conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
