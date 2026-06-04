---
description: "Run operational package tasks such as local build/export, with future publish commands kept under the same entry."
argument-hint: "build [--format llms|skills]"
allowed-tools: Bash(context:*)
---

Run operational package tasks such as local build/export, with future publish kept under one entry.

---

## Workflow

Run operational tasks for the current context workspace. This command owns packaging/export work and is the future home for platform publish. It does not capture, align, compile, query, drop, or purge knowledge.

Supported subcommands:

- `build`: build a local knowledge package by running `context build`.

Unsupported but reserved subcommands:

- `publish`: reserved for future platform publish. Do not invent a CLI command for it.
- `package`: reserved for future offline package-only publish flow. Do not invent a CLI command for it.

### Build

If `$ARGUMENTS` is empty, treat it as `build --format skills`.

If `$ARGUMENTS` starts with `build`, run `context build` with the requested format:

- `build --format skills` -> `context build --format skills`
- `build --format llms` -> `context build --format llms`
- `build skills` -> `context build --format skills`
- `build llms` -> `context build --format llms`
- `build` -> `context build --format skills`

If the user asks for both formats, run the two CLI commands separately:

1. `context build --format skills`
2. `context build --format llms`

Do not pass unsupported flags to `context build`. If the user supplies an unknown build format, explain that the supported formats are `skills` and `llms`, then stop.

Before running build, do not inspect workspace files with generic tools. The CLI performs workspace verification and prints blocking issues if the workspace is not ready.

After build succeeds, surface the CLI output verbatim, especially the package path under `output/skills-pkg/` or `output/llms-pkg/`. If build fails because verification failed, relay the error and let the CLI's issue list drive remediation; do not inspect `raw/`, `knowledge/`, or `output/` yourself.

### Reserved Publish

If `$ARGUMENTS` starts with `publish`, `package`, `deploy`, or `release`, do not run any command. Explain briefly that platform publish/package-only is reserved under `/context-ops` but not implemented yet. For now, the available operational command is `/context-ops build`.

Language policy: CLI stdout/stderr stays verbatim. Any explanation you add follows the user's conversation language; command names, flags, paths, package formats, and issue codes stay as printed.
