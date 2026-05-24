---
description: "Initialize a context workspace in the current directory."
argument-hint: "[name] [--layout embedded|root] [--language <text>] [--with-aspects <names>] [--with-all-aspects] [--minimal|--no-aspects] [--focus <text>]"
allowed-tools: Bash(context:*)
---

<!--
This command has no companion skill. Its protocol (the focus multi-choice
UX before `context init` runs) lives inline here per the slash-command
length exemption for self-contained slash commands.
-->

## Your Task

Initialize a context workspace, including layout, default-language, and focus confirmation before creating it.

Language rule: ask every question, option label, option description, and final summary in the user's current conversation language. The English question blocks below are semantic templates, not text to copy unless the conversation itself is English. Keep CLI tokens, file paths, aspect names, and stored values such as `Chinese`, `English`, `embedded`, and `root` unchanged.

### Step 1 — Ask about workspace layout (unless `$ARGUMENTS` already has `--layout`)

Use the host's native multi-choice tool when available (Claude Code `AskUserQuestion`, Codex `ask_user_question`, Cursor Plan Mode `AskQuestion`); fall back to markdown choices otherwise.

Question shape. Do not expose `embedded` / `root` as user-facing option labels; those are CLI tokens only. Translate the user-facing labels and descriptions:

```
Q. Where should C4A store this workspace?
  A. Default (.context/) — create a `.context/` data directory inside the current project. (Recommended)
  B. Current directory — use the current directory itself as the C4A data root.
```

Explain the tradeoff in the user's conversation language before asking:
- Default (`.context/`) is for normal code repositories; C4A files live under `.context/`.
- Current directory is only for a dedicated knowledge repository. The current directory must not already contain `.context/`, `config.yaml`, `raw/`, `knowledge/`, `output/`, `aspects/`, or `inbox/`. Existing `AGENTS.md` / `CLAUDE.md` in the selected C4A data root are kept rather than overwritten.

Map the answer to CLI flags:
- Default (`.context/`) → pass `--layout embedded`
- Current directory → pass `--layout root`

### Step 2 — Ask about default language (unless `$ARGUMENTS` already has `--language`)

Ask one multi-choice question in the user's conversation language:

```
Q. What default language should agents use for user-facing replies in this workspace?
  A. 中文 — maps to `Chinese`
  B. English
  C. Other — please describe.
```

The option label must be localized, but the stored CLI value should remain stable. Pass the answer as `--language "Chinese"`, `--language "English"`, or the user's custom text.

### Step 3 — Ask about workspace focus (unless user already passed `--focus`)

Before running `context init`, ask the user **one** multi-choice question about the workspace's focus (the primary intent of this knowledge base). Use the host's native multi-choice tool when available (Claude Code `AskUserQuestion`, Codex `ask_user_question`, Cursor Plan Mode `AskQuestion`); fall back to markdown `A/B/C/D` choices otherwise. Keep it to one question with 2–4 options plus "Other" escape hatch; never dump 5+ at once.

The question shape (translate all user-facing text to the user's conversation language; keep machine tokens English):

```
Q. What will this workspace mainly hold?
  A. Business product/R&D knowledge base — business architecture, requirements,
     technical architecture, business modules and their supporting tech.         (Recommended)
  B. Team technical knowledge base — tech stack, infra tools, conventions,
     operations, decisions, on-call memos, etc.
  C. Product / project user manual — user-facing intro, guides, handbook, Q&A.
  D. Research / learning library on a topic — framework comparisons, selection
     notes, wiki-style reading notes.
  E. Other — please describe.
```

Interpret the answer:
- Chose A–D → generate a 2–3 line focus description in the user's language. Phrase it as
  "primarily X; supporting materials such as Y may also be filed here" rather than exclusion
  language — workspaces absorb auxiliary material in practice. Show the exact generated focus
  text to the user and ask for one confirmation before running `context init`. If the user
  approves, pass it as `--focus "..."`; if the user edits it, pass the edited text as
  `--focus "..."`; if the user declines or says to skip, run without `--focus`.
- Chose E or described freely → pass the user's text verbatim as `--focus "..."`.
- User says "skip" / "don't care" → run `context init` without `--focus`.
- `$ARGUMENTS` already contains `--focus "..."` → skip this step entirely.

### Step 4 — Choose aspects (unless `$ARGUMENTS` already has aspect flags)

Skip this step if `$ARGUMENTS` already includes `--with-aspects`, `--with-all-aspects`, `--minimal`, or `--no-aspects`.

If the user request names specific aspects, map that directly:
- "only code aspect" / "仅启用 code aspect" → append `--with-aspects code`
- "all aspects" / "全部 aspect" → append `--with-all-aspects`
- "no aspects" / "不安装 aspect" / "minimal" → append `--no-aspects`

Otherwise ask **one** multi-select question. The first option **must** be a `skip` choice so the user can always submit (host multi-choice tools such as Claude Code `AskUserQuestion` refuse to submit when zero boxes are checked). Pre-check `code` as the recommended default.

```
Q. Which aspects should be installed? (multi-select)
  A. skip — install no aspects now; add later with `context init --with-aspects <name>`
  B. code — scripted local source-code capture. (Recommended; pre-checked)
  C. design-system — placeholder aspect template.
  D. openapi — placeholder aspect template.
  E. graphql — placeholder aspect template.
```

Hard rules when mapping into the host UI:

- The `skip` option **must** be present as the **first** choice. Do not relabel it `Other`, do not omit it, do not assume the host's auto-injected `Other` covers it. `Other` (if present) is a free-text escape hatch and is unrelated to "skip".
- Pre-check `code` so the user can submit immediately to get the recommended setup.
- The user cannot submit zero boxes — they always pick at least `skip` or one aspect. If they pick `skip` together with any aspect, treat `skip` as the winner and ignore the others.

Map the answer:

- `skip` selected → append `--no-aspects`.
- One or more aspects selected (without `skip`) → append `--with-aspects <comma-separated names>`, e.g. `--with-aspects code,openapi`.
- Host auto-injected `Other` selected → ignore it, fall back to the recommended default `--with-aspects code`.

Do not silently install all aspects when the user asked for a code-only workspace.

### Step 5 — Run init

Run `context init $ARGUMENTS` with the selected `--layout`, `--language`, `--focus`, and aspect flags appended when those flags were not already present. The CLI handles skeleton build, `.gitignore`, `AGENTS.md`, `CLAUDE.md -> AGENTS.md`, and aspect templates inside the selected C4A data root.

If the CLI errors (e.g. an existing workspace without `--with-aspects`, or root layout blockers), surface the error and the CLI's remediation hint.

To add aspects later in an existing workspace, run `context init --with-aspects <name>` from the workspace root. Use comma-separated names for multiple aspects, for example `context init --with-aspects code,openapi`. Append mode only copies missing aspect templates and does not rewrite workspace config, raw data, or knowledge.

### Step 6 — Summarize

Briefly state in the user's conversation language:
- Workspace name
- Layout and data root
- Default language
- Installed aspects
- Whether `AGENTS.md` was created and whether `CLAUDE.md` was linked
- Whether focus was recorded (show the first line if yes; mention the user can edit `config.yaml` later if not)
- If the CLI prints a Claude local permission hint, tell the user that `Bash(context:*)` is the recommended scoped allow for heredoc-heavy context workflows. Do not edit `.claude/settings.local.json` unless the user explicitly asks.
- Suggest `/context:capture` as the natural next step

CLI output, file paths, aspect names, flags, and command names stay as printed.

Do NOT read, write, link, or edit workspace files yourself during init — the CLI is the sole writer for skeleton files, `AGENTS.md`, and `CLAUDE.md`.
