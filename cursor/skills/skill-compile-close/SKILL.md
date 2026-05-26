---
name: skill-compile-close
description: >
  Internal procedure invoked by `/context-compile`; not a user command. Runs after every draft
  iteration. Triggers `context compile close`, which in one invocation
  refreshes locator-only evidence, canonicalizes source refs, compacts and verifies the final workspace,
  rebuilds the knowledge index, appends a changelog
  entry, rebuilds section fingerprints + incremental cache, and
  archives compile scratch files. Agent intervention is
  limited to interpreting the CLI's output and routing any verify
  error back to its upstream command (`/context-compile` for Section
  issues, `/context-align` for structural issues, `/context-drop`
  for dropped-source references). The skill never hand-edits rendered knowledge.
  Activates once all draft actions are applied and before user-visible
  success is declared.
tools:
  - Bash
---

# skill-compile-close — global verify + index + changelog

Close a compile run. The CLI does the work; the skill reads the
CLI's output and routes any failure back to the correct upstream
command. It does not hand-edit rendered knowledge.

## TL;DR — Non-negotiables

- CLI-driven. `context compile close` performs deterministic close writes first (locator refresh, source_ref canonicalization, compact, index/changelog), verifies the final workspace, then rebuilds section fingerprints + incremental cache and archives compile scratch files. Use the command's stdout + exit code; that's the close's full output.
- **Agent NEVER edits rendered knowledge from the close stage.** The CLI is the sole writer for articles, the index, and the changelog. If verify reports an error here, route it back, not around:
  - Content / Section issues (`invalid-section-mount`, `body-ad-hoc-heading`, `dangling-source-alias`) → user re-runs `/context-compile` (draft loop fixes its own Section actions; the close stage does not patch)
  - Structural issues (`contains-cycle`, `edge-dangling-node`, `duplicate-slug`, `invalid-node-type`, `domain-same-file-child`) → user runs `/context-align` to revise the plan
  - Source issues (`dropped-source-reference`) → user runs `/context-drop <id>` to complete the drop
- Exit 0 → summarise node/section totals, verify, `recompiled`, `locator_updates`, `rebuilt`, fingerprint rebuild count, archive status / archived file count, and any `ready_with_debt` coverage warnings when printed. If the close receipt reports severely low coverage, surface the returned `--cover-uncovered-only` command as the recommended repair before treating the debt as accepted.
- Exit 2 → report the full issue list verbatim + point at the right re-entry command above. Do not hand-open the affected rendered article.
- Coverage warnings are CLI-owned diagnostics. `ready_with_debt` means close succeeded and unresolved coverage remains visible. For severely low coverage, recommend one `--cover-uncovered-only` repair pass unless the user explicitly accepts the debt; otherwise report the warning and follow returned coverage view commands / `available_actions[]` only if the user chooses a repair or skip round.
- Coverage and engagement denominators count primary citable content evidence. URL/reference-only, marker, frontmatter, embed, navigation, and context-only evidence is excluded or bucketed as non-blocking bookkeeping by the CLI.
- User-accepted hard-fact risk is carried as `review_debt`; report it from close/status when present, but do not treat review-debt count as a close failure.
- Materialized knowledge means either a CLI-written knowledge article, or an explicit no-write placeholder from align: `planned_sections: []` plus source/context/graph support. A compile skip action records reviewed evidence, but it does not by itself materialize an arbitrary finalized Node.
- Never re-run `context compile draft` from close to paper over verify failures. Draft failures belong in the draft loop.
- Do not use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect `WORKSPACE_DIR`, `.context`, knowledge files, or `/tmp` workflow artifacts.
- Derivable files self-heal: missing `_index.md` or `changelog.md` is rebuilt inside `context compile close` before the append, locator-only source moves are refreshed, non-canonical but hash-valid `source_ref` locators are canonicalized, and high-signal coverage candidates already backed by active Sections are marked covered. No pre-check needed.
- LLM-assisted repair (`--fix-with-llm`) is not available in the current release.
- Output language: summary prose matches the user's language; CLI output, issue codes, file paths stay as printed.
- Successful close archives CLI scratch artifacts through the output lifecycle and rebuilds the user-level incremental cache. Current align state is internal CLI state, not a file protocol. The CLI owns this lifecycle — the agent must not move, delete, or archive workspace output files by hand.
- Semantic decisions are applied and recorded before close. Compile-close does not judge or rewrite semantic decisions; it only verifies the already-applied workspace and rebuilds derived indexes.

<reference>

## Stages inside `context compile close`

Close is one in-process command with one exit code:

1. **Coverage guard with self-heal** — drops stale candidates and treats high-signal candidates already backed by active Sections as covered.
2. **Locator refresh** — if evidence moved but block hashes are unchanged, updates only section locators.
3. **Source ref canonicalization** — if a Section `source_ref` resolves to the same raw evidence block but has a stale anchor/range rendering, rewrites it to the canonical locator.
4. **Workspace compact** — re-renders every knowledge article canonically (Section order, frontmatter field order, `## Contains` list ordering, heading depth).
5. **Rebuild knowledge index** — regenerates the index from the current workspace state; previous content overwritten.
6. **Append changelog** — appends one compile list item to the changelog; existing entries preserved.
7. **Workspace verify** — runs the full rule set against the final close output. Any error flips exit to 2 and close rolls back its writes.
8. **Rebuild incremental cache** — rebuilds section fingerprints and cache indexes from workspace truth sources.
9. **Archive scratch files** — moves CLI-owned context/draft/prepare/review scratch payloads into the output archive lifecycle.

## Outcome routing

| Outcome | Agent action |
|---|---|
| Exit 0, 0 issues | Summarise those counts in the user's language: Nodes touched; Sections added / updated / superseded / deprecated / skipped; `recompiled`; `locator_updates`; `rebuilt`; verify green. Stop. |
| Exit 0, warnings only | Summarise + list warnings verbatim. For severely low coverage, recommend the CLI-returned `--cover-uncovered-only` repair command before final acceptance; for other coverage warnings, surface returned coverage view commands / `available_actions[]` instead of inventing a local decision matrix. |
| Exit 2, Section / content issue | Surface the full issue list; point the user at re-running `/context-compile` (the draft loop owns Section writes). Do NOT Edit the affected rendered article. |
| Exit 2, `compile-close-finalized-node-missing-knowledge` | If the missing Node has real citation evidence, point the user at `/context-compile` for that Node. If it is intentionally navigation-only or placeholder-only, point the user at `/context-align` to make it explicit no-write with `planned_sections: []` and context-only/ignored relation or placeholder blocks. |
| Exit 2, structural issue (cycle, duplicate slug, `invalid-node-type`, `domain-same-file-child`) | Surface the full issue list; point the user at `/context-align` to revise structure. Do not re-run compile. |
| Exit 2, `dropped-source-reference` | Surface the source-id; point the user at `/context-drop <id>` to complete the drop cleanup. |

The close stage never edits rendered knowledge on the agent side. Every verify error routes back to the correct upstream command (compile / align / drop), never sideways into a hand Edit. Use the CLI issue code and hint printed by `context compile close` for the error→command mapping.

## Changelog entry shape

`context compile close` appends one markdown list item per run to
the changelog with aggregate counts — not a multi-line
block:

```
- [compile] nodes=N sections=M recompiled=R locator_updates=L @ <ISO timestamp>
```

`[drop]` lines from `/context-drop` follow the same single-line list-
item convention (see the drop skill for the exact shape).

</reference>

<procedures>

### Step 1 — Invoke close

Run `context compile close`. The caller (typically `/context-compile`) may have already invoked it; check for existing output before re-running.

### Step 2 — Interpret

Use stdout + stderr. The exit code selects the path via [Outcome routing](#outcome-routing).

### Step 3 — Route errors to the correct upstream command

For each error in the CLI's report, classify via [Outcome routing](#outcome-routing) and name the re-entry command in your report. Do NOT hand-edit rendered knowledge — that violates the CLI-sole-writer principle and masks the real upstream fix. Specifically:

- Section / content issue → user re-runs `/context-compile` (draft loop produces new Section actions; the CLI re-writes).
- `compile-close-finalized-node-missing-knowledge` → content Nodes go back through `/context-compile`; navigation-only or placeholder-only Nodes go back through `/context-align` so they become explicit no-write placeholders.
- Structural issue → user runs `/context-align` (revise the plan; re-compile afterwards).
- `dropped-source-reference` → user runs `/context-drop <id>` to finish drop cleanup.

One pass. If the CLI reports multiple errors, list them all and let the user choose the order; do not loop the close stage itself.

### Step 4 — Report

Summarise in the user's language:

- Nodes touched and counts per op (add / update / supersede / deprecate / skip / locator-only).
- Knowledge index rebuilt / updated; changelog appended at `<timestamp>`.
- Incremental close counts printed by the CLI: `recompiled`, `locator_updates`, `canonical_source_ref_updates`, `rebuilt`, and section fingerprint rebuild count.
- Verify result: green / `<n>` warnings / `<n>` errors (issue codes verbatim).

Stop. Do not auto-invoke follow-on commands.

### Step 5 — Final guardrails

Run close once, surface every error with its re-entry command, and never inspect or edit rendered knowledge outside the CLI.

</procedures>
