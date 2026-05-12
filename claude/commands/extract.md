---
description: "Debug helper: run extraction against a path and print structured results (no files written)."
argument-hint: "<path> [--format json|jsonl|pretty]"
allowed-tools: Bash(context:*)
---

## Your task

Run `context extract $ARGUMENTS` and stream the CLI's stdout back to the user.

- The command is **state-required**: it runs only from inside an initialized context workspace. Outside a workspace the CLI exits with a workspace-not-found error — relay it and suggest `/context:init`, do not try to guess a workspace location.
- It is strictly read-only — never writes into workspace files.
- Default format is `json`; `--format jsonl` is line-delimited per entity; `--format pretty` is human-readable.
- Useful for inspecting what `/context:capture --code` would capture without creating a bucket.

If the user wants to persist the extraction as a raw snapshot, redirect them to `/context:capture --code`.

Language policy: stream CLI stdout/stderr verbatim. Any explanation you add follows the user's conversation language; paths, JSON keys, command names, flags, and error tokens stay as printed.
