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
2. **Starts with `http://` or `https://`** → `/context-capture $ARGUMENTS`.
3. **Ends in `.md` and is explicitly presented as source material to ingest/capture** → `/context-capture $ARGUMENTS`.
   Driver documents such as run instructions, handbooks, READMEs, plans, feedback issues, corpus/index/manifests, and batch lists are not capture targets unless the user explicitly asks to ingest them. Capture only ingest targets that are already explicit in the user request; if they are missing, ask one clarification.
4. **Equals `--inbox` or `--refresh`** → `/context-capture $ARGUMENTS`.
5. **Matches `init`, `initialize`, `new workspace`, or looks like a plain workspace name** → `/context-init $ARGUMENTS`.
6. **Mentions `code` or source-code capture** → `/context-capture --code $ARGUMENTS`.
7. **Mentions `aspect` without a concrete supported capture flag** → ask one clarification; code aspect capture is exposed as `/context-capture --code`.
8. **Matches `align`, `structure`, `plan`, `node tree`** → `/context-align $ARGUMENTS`.
9. **Matches `compile`, `recompile`, `synthesize`, or `build knowledge`** → `/context-compile $ARGUMENTS`.
10. **Matches `drop`, `retract`, `delete source`, or passes a known source-id pattern (`feishu:*` / `local:*` / `aspect:*` / `oncall:*` / `meeting:*`)** → `/context-drop $ARGUMENTS`.
11. **Matches `purge`, `clear archive`, `delete archive`, or `清理归档`** → `/context-purge $ARGUMENTS`.
12. **Equals `status`, `health`, `overview`, `summary`, or asks for workspace/cache/plugin health** → `/context-status`.
13. **Anything else** (likely a knowledge question) → `/context-query $ARGUMENTS`.

If multiple rules apply, pick the most specific (URL beats word match). When in doubt, ask one clarifying question before dispatching.
Never use Read / Glob / Grep / Write against `WORKSPACE_DIR`; route to packaged `/context-*` commands and skills instead of opening plugin or workspace files manually.
Never use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect or preprocess `WORKSPACE_DIR`, `.context`, or `/tmp` workflow artifacts.
Do not use `context workspace` search/read as this router's knowledge fallback; route likely knowledge questions to `/context-query` so the query skill owns retrieval and citations.
