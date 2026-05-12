---
description: "Drop a source: CLI plans cleanup, reconciles affected Sections when needed, then applies safely."
argument-hint: "<source-id|url> [--reason <text>] [--yes]"
allowed-tools: Bash(context:*)
---

## Your task

Retract a source without losing the audit trail. The CLI owns source resolution, impact planning, semantic decision application, knowledge cleanup, source stamp, changelog append, and verify; the agent presents the impact plan and waits for confirmation.

Naming convention:

- `/context:*` names user slash commands.
- `context ...` names CLI primitives.
- Internal packaged procedures invoked by slash workflows are not user slash commands.

Use packaged `context:skill-drop` end to end, including the self-verify checklist at the end.

Parse `$ARGUMENTS` for `<source-id|url>`, optional `--reason <text>`, and optional `--yes`. Source validation is done by `context drop --plan`; if absent or already `dropped`, relay the CLI's error and stop. If `--reason` is missing but the user gave a clear natural-language reason, infer a concise reason; otherwise ask for it before applying the plan. `--yes` skips the original drop impact confirmation only; it never skips semantic `ask_user` questions.

Language policy: any prose you speak directly to the user follows the user's conversation language. CLI output, source-ids, command names, file paths, flags, and issue codes stay as printed.

Never Read / Glob / Grep / Write workspace files directly. All workspace access goes through semantic CLI commands such as `context drop --plan`, `context reconcile prepare --mode drop`, `context reconcile review`, `context drop --apply-plan`, and `context source`. If you need the semantic decision shape, run `context schema semantic-decisions` for JSON or `context schema semantic-decisions --format yaml` for readable YAML; do not infer it from memory.
Never use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect or preprocess workspace storage or temporary workflow artifacts. Consume CLI JSON/YAML/text outputs directly. Do not pipe `context ... --format json` through `python3`, `node`, `jq`, `sed`, `cat`, `2>&1`, or shell fallback wrappers.
Plan handoff is workflow-scoped. Run `context drop --plan <target> --format json`; the CLI stores the drop-plan payload in the current workflow. `--save-output` is only for an explicit human-readable scratch copy and must not be passed to later steps.
