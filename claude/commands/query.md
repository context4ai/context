---
description: "Answer a local knowledge question through context query hit/miss/select results and cited supplemental views."
argument-hint: "<question>"
allowed-tools: Bash(context:*)
---

## Your task

Naming convention:

- `/context:*` names user slash commands.
- `context ...` names CLI primitives.
- Internal packaged procedures invoked by slash workflows are not user slash commands.

Use packaged `context:skill-context-query` end to end for `$ARGUMENTS`.

This command is intentionally a thin entrypoint. Do not duplicate the query protocol here; the skill owns the hit/miss/select handling, supplemental lookup, citation, gap, and broad-query rules.
The packaged skill also owns scoped orientation filters such as `context query --intent orientation --tag <tag>` / `--domain <slug>` and Node keyword lookup through `context query --intent node_search --query "<keyword>"`.

Never use direct workspace file tools for local knowledge. Workspace evidence must come from `context query` commands only; the packaged skill may run its documented `context query --intent orientation` or empty `context query` command before querying, but that output is not evidence.
Never use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect `WORKSPACE_DIR`, `.context`, or `/tmp` workflow artifacts while answering a query.
Use the default `context query` text output. Cite returned `node` and `section` handles; do not invent source provenance or inspect workspace files.
