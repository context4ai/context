---
context_resource: semantic/compile/close-gate
id: context.semantic.compile.close-gate
kind: procedure
media-type: text/markdown
applies-to:
  - close
  - verify
  - structure
  - edge_projection
name: close-gate
description: >
  Internal procedure invoked by the current compile/continue flow; not a user
  slash command. Runs after review apply. Triggers `context close --format json`,
  which derives knowledge/structure.yaml, projects approved edges, and runs the
  final verify gate. Agent intervention is limited to interpreting CLI output
  and routing verify errors back to source capture, align structure, compile
  actions, or review as appropriate. The Agent never hand-edits rendered
  knowledge.
tools:
  - Bash
---

# close-gate — approved structure projection + final verify

Close a compile run. The CLI does the work; the Agent reads the
CLI's output and routes any failure back to the correct upstream
command. It does not hand-edit rendered knowledge.

## TL;DR — Non-negotiables

- CLI-driven. `context close --format json` derives `knowledge/structure.yaml`,
  projects approved edges, and verifies the final workspace including edge
  source refs. Use the command's stdout + exit code; that's the close's full
  output.
- **Agent NEVER edits rendered knowledge from the close stage.** The CLI is the
  sole writer for approved structure projection. If verify reports an error
  here, route it back, not around:
  - Content / Section issues → re-run the current compile gate for the affected
    node after fixing compile actions.
  - Structural issues → return to the align structure gate and reconfirm.
  - Source/evidence issues → recapture the affected source, then rerun align or
    compile as status instructs.
- Exit 0 → summarise approved node count, approved edge count, structural edge
  contract status, and verify status. References, changelog, package index,
  section fingerprints, and full incremental cache rebuilds are not current
  close output.
- Exit 2 → report the full issue list verbatim + point at the right re-entry command above. Do not hand-open the affected rendered article.
- Materialized knowledge means approved Markdown plus its approved
  `knowledge/structure.yaml` projection. A compile skip action records reviewed
  evidence, but it does not by itself materialize an arbitrary finalized Node.
- Never re-run compile actions from close to paper over verify failures. Draft
  failures belong in the compile loop.
- Do not use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect `sources/`, `knowledge/`, `dist/`, or `.tmp/context-runtime/lifecycle/` files.
- Current close can self-heal stale or malformed `knowledge/structure.yaml`
  projection by deriving it again from approved Markdown and approved edge
  sources. It must not rewrite verbatim section body.
- LLM-assisted repair (`--fix-with-llm`) is not a current close action.
- Output language: summary prose matches the user's language; CLI output, issue codes, file paths stay as printed.
- Current align state is internal CLI state, not a file protocol. The CLI owns
  this lifecycle — the agent must not move, delete, or archive workspace output
  files by hand.
- Semantic decisions are applied and recorded before close. Compile-close does
  not judge or rewrite semantic decisions; it only verifies the already-applied
  workspace and rebuilds approved structure projection.

<reference>

## Stages inside `context close --format json`

Close is one in-process command with one exit code:

1. **Approved knowledge scan** — reads approved Markdown only through CLI
   project readers.
2. **Structure projection** — writes deterministic `knowledge/structure.yaml`
   with nodes, approved edge projection, input hash, and structural edge
   contract status.
3. **Workspace verify** — runs the final verify gate. Any error prevents close
   readiness.
4. **Status receipt** — reports whether close is ready and which upstream gate
   owns any failure.

## Outcome routing

| Outcome | Agent action |
|---|---|
| Ready, verify pass | Summarise approved nodes, approved edges, structural edge contract, and verify status. Stop. |
| Ready, verify warnings only | Summarise warning codes and state that build may proceed when warnings are allowed by status/build gate. |
| Verify error in approved section content/evidence | Surface the issue list and route back to compile actions or source recapture as indicated by status. Do not edit approved Markdown. |
| Verify error in approved structure projection | Run `context close --format json` once more only when status says the projection is close-repairable; otherwise return to align structure. |
| Source/evidence stale or missing | Route to source capture/refresh, then rerun align/compile as status instructs. |

The close stage never edits rendered knowledge on the agent side. Every verify
error routes back to the correct upstream gate (source capture, align
structure, compile actions, or review), never sideways into a hand Edit. Use
the CLI issue code and hint printed by `context close --format json` for the
error→command mapping.

References, changelog, section fingerprints, and package index rebuilds are not
current close outputs.

</reference>

<procedures>

### Step 1 — Invoke close

Run `context close --format json`. The caller may have already invoked it;
check for existing output before re-running.

### Step 2 — Interpret

Use stdout + stderr. The exit code selects the path via [Outcome routing](#outcome-routing).

### Step 3 — Route errors to the correct upstream command

For each error in the CLI's report, classify via [Outcome routing](#outcome-routing) and name the re-entry command in your report. Do NOT hand-edit rendered knowledge — that violates the CLI-sole-writer principle and masks the real upstream fix. Specifically:

- Section / content issue → rerun the current compile gate for that node.
- Structure issue → return to align structure and user confirmation.
- Source/evidence issue → recapture the affected source, then rerun align or
  compile as status instructs.

One pass. If the CLI reports multiple errors, list them all and let the user choose the order; do not loop the close stage itself.

### Step 4 — Report

Summarise in the user's language:

- Approved node count.
- Approved edge count and structural edge contract status.
- Verify result: pass / pass-with-unverifiable-evidence / fail, with issue
  codes verbatim.

Stop. Do not auto-invoke follow-on commands.

### Step 5 — Final guardrails

Run close once, surface every error with its re-entry command, and never inspect or edit rendered knowledge outside the CLI.

</procedures>
