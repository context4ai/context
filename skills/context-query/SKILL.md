---
name: context-query
description: >
  Answer a local knowledge question through context query hit/miss/select results and cited supplemental views. Equivalent to Claude /context:query; use the local `context` CLI for workspace writes.
tools:
  - Bash
---

# Query

Public C4A Context entry for agents that expose skills instead of Claude slash commands.

- Public entry: `context-query`
- Claude equivalent: `/context:query`
- CLI primitive prefix: `context ...`
- Internal procedures live under `references/internal-procedures/`; read each referenced file in full before following that step.

---

## Workflow

Naming convention:

- `/context:*` names user slash commands.
- `context ...` names CLI primitives.
- Internal packaged procedures invoked by slash workflows are not user slash commands.

Read `references/internal-procedures/skill-context-query.md` in full and follow it end to end for `$ARGUMENTS`.

This command is intentionally a thin entrypoint. Do not duplicate the query protocol here; the skill owns the hit/miss/select handling, supplemental lookup, citation, gap, and broad-query rules.

Never use direct workspace file tools for local knowledge. Workspace evidence must come from `context query` commands only; the packaged skill may run its documented `context query --intent orientation` or empty `context query` command before querying, but that output is not evidence.
Never use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect `WORKSPACE_DIR`, `.context`, or `/tmp` workflow artifacts while answering a query.
Use the default `context query` text output. Cite returned `node` and `section` handles; do not invent source provenance or inspect workspace files.
