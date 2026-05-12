---
description: "Fuzzy router for context operations. Inspect the argument and route to the correct /context-* subcommand."
argument-hint: "<free text | url | source-id | question>"
allowed-tools: Bash(context:*)
---

Route a natural-language C4A request to the right Context command.

---

## Workflow

Inspect `$ARGUMENTS` and delegate to the most appropriate subcommand. Route without running anything of your own first — let the target subcommand drive.

Any prose you speak to the user (clarifying questions, "routing to …" notes) follows the user's conversation language. Sub-command names (`/context-capture`, `/context-compile`), flag names, and source-ids stay English.

Naming convention: `/context-*` names user slash commands and `context ...` names CLI primitives. Internal packaged procedures are workflow-only; this router dispatches only slash commands and does not call packaged procedures directly.

Routing rules (first match wins):

1. **Empty arguments** → run `/context-status`.
2. **Starts with `http://` or `https://`, or ends in `.md`** → `/context-capture $ARGUMENTS`.
3. **Equals `--inbox` or `--refresh`** → `/context-capture $ARGUMENTS`.
4. **Matches `init`, `initialize`, `new workspace`, or looks like a plain workspace name** → `/context-init $ARGUMENTS`.
5. **Mentions `code` or source-code capture** → `/context-capture --code $ARGUMENTS`.
6. **Mentions `aspect` without a concrete supported capture flag** → ask one clarification; code aspect capture is exposed as `/context-capture --code`.
7. **Matches `align`, `structure`, `plan`, `node tree`** → `/context-align $ARGUMENTS`.
8. **Matches `compile`, `recompile`, `synthesize`, or `build knowledge`** → `/context-compile $ARGUMENTS`.
9. **Matches `drop`, `retract`, `delete source`, or passes a known source-id pattern (`feishu:*` / `local:*` / `aspect:*` / `oncall:*` / `meeting:*`)** → `/context-drop $ARGUMENTS`.
10. **Matches `purge`, `clear archive`, `delete archive`, or `清理归档`** → `/context-purge $ARGUMENTS`.
11. **Equals `status`, `health`, `overview`, `summary`, or asks for workspace/cache/plugin health** → `/context-status`.
12. **Anything else** (likely a knowledge question) → `/context-query $ARGUMENTS`.

If multiple rules apply, pick the most specific (URL beats word match). When in doubt, ask one clarifying question before dispatching.
Never use Read / Glob / Grep / Write against `WORKSPACE_DIR`; route to packaged `/context-*` commands and skills instead of opening plugin or workspace files manually.
Never use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect or preprocess `WORKSPACE_DIR`, `.context`, or `/tmp` workflow artifacts.
Do not use `context workspace` search/read as this router's knowledge fallback; route likely knowledge questions to `/context-query` so the query skill owns retrieval and citations.
