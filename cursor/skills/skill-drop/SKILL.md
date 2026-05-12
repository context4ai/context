---
name: skill-drop
description: >
  Internal procedure invoked by `/context-drop`; not a user command. Source retraction through CLI-owned planning and application. The agent
  calls `context drop --plan` for a structured impact plan, presents the
  user-facing summary for confirmation, runs semantic reconciliation when the
  plan archives affected Sections, then calls `context drop --apply-plan` so
  the CLI archives raw and removed knowledge, cleans active knowledge, applies
  source alias reindexing, source stamp, changelog append, consumes the current
  ready immutable review when semantic decisions are required, writes the
  semantic ledger, and runs verify.
  Activates when `/context-drop` is invoked with a source-id or URL.
tools:
  - Bash
---

# skill-drop — retract a source without losing the audit trail

Ask the CLI for a structured cleanup plan, confirm the user-visible impact,
run semantic reconciliation on affected knowledge items when required, then ask
the CLI to apply the plan. Do not inspect or mutate workspace files directly.

## TL;DR — Non-negotiables

- Plan + semantic prepare/review + apply are CLI-owned. The agent only presents the plan, asks semantic questions when required, and waits for confirmation.
- Drop removes affected raw / unsupported knowledge from the active workspace and keeps a CLI-managed restorable archive for audit.
- Do not Read / Glob / Grep / Write workspace storage; all impact analysis and mutation must go through `context drop --plan`, `context reconcile prepare --mode drop`, `context reconcile review`, and `context drop --apply-plan`.
- Do not use Python, Node.js, shell scripts, `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect or preprocess workspace storage or temporary workflow artifacts.
- `context drop --plan <source-id|url> --format json` resolves source-id, computes affected topics / knowledge items, reports alias reindex impact, and stores the exact plan as the current workflow's `drop-plan` payload. `--save-output` is only for an explicit human-readable scratch copy; do not use it as a handoff.
- `context drop --apply-plan --reason "<text>" --yes` reads the current workflow `drop-plan` payload, archives affected active content, consumes the current workflow's ready immutable review when the plan archives Sections, removes unsupported Sections / empty Nodes from active knowledge, applies source alias reindexing, writes the source stamp, changelog append, semantic ledger when decisions exist, and verify. Do not pass plan or decisions files to drop apply.
- User confirmation required unless `--yes` was passed; abort on any non-`y` answer without writing. `--yes` does not skip semantic `ask_user` questions.
- Confirmation prose describes affected topics and claims, not source-ref mechanics.
- Source evidence, section, and verify rule meanings stay anchored to the CLI plan, reconcile, and verify outputs.
- Output language: impact plan + report match the user's language; CLI commands, flag names, source-ids, comment attributes stay English.

<reference>

## Plan fields

The JSON plan has:

| Field | Meaning |
|---|---|
| `source_id` | Canonical source id resolved from user input |
| `resolved_from.kind` | `source-id` or `url` for the production Agent flow |
| `affected_nodes[]` | Topics whose source list contains the dropped source |
| `affected_nodes[].sections[]` | Knowledge items that require semantic reconciliation before the source is dropped |
| `affected_nodes[].reindex_sections[]` | Knowledge items whose internal source alias will be renumbered after the source is removed |
| `affected_nodes[].will_be_sourceless` | Topic has no remaining source ids after cleanup |
| `affected_nodes[].will_be_empty` | Topic has no remaining Section/body/children/contains after cleanup and may be archived even if another source id remains |
| `affected_graph_edges[]` | Explicit graph edges that will be removed if one endpoint is archived by apply |
| `references_will_be_pruned[]` | Surviving Sections whose `refers_to_nodes[]` will lose archived node slugs; the Section itself is not removed |
| `summary` | Counts for confirmation and changelog |

If a non-domain Node would keep an active source id but lose all of its own Sections while still carrying child Nodes, contains links, or body text, do not rely on verify to catch it after mutation. Produce a semantic reanchor/split decision that preserves a supported Section, or expect `drop --apply-plan` to reject before writing.

## User-facing impact summary shape

```
Affected: N topics · M knowledge items

  <topic title>
    "short claim preview" → remove from active knowledge and archive
    "short claim preview" → keep, supported by another source document
  <topic title>
    "short claim preview" → remove from active knowledge and archive

Proceed? [y/N]
```

Keep the internal node slug, Section id, and source-ref patch data in your
working notes for Step 4; show them only if the user asks for implementation
details.

## CLI shapes

```
context drop --plan <source-id|url> --format json
context reconcile prepare --mode drop --format json
context reconcile review --prepare-digest <prepare-digest> --decisions - --view status
context drop --apply-plan --reason "<text>" --yes
```

The apply command writes a source-specific restorable archive,
moves affected raw out of the active source set, consumes the current workflow's ready immutable review for
reanchor / remove_unsupported / split_then_reanchor when affected Sections are archived, removes unsupported
Sections / empty Nodes from active knowledge, flips the source registry entry to
`status: dropped`, stamps `drop_reason`, `dropped_at`, and a semantic archive status,
appends a `[drop]` changelog line, records the semantic ledger when decisions exist,
and runs verify. It exits
non-zero if the source-id is unknown, already dropped, plan shape is invalid,
the plan is stale, semantic decisions are unresolved/invalid, or verify reports errors.
In drop mode, `remove_unsupported` means physical removal from active knowledge
after the archive captures the before snapshot; compile/refresh apply uses the
same action name for Section deprecation.

</reference>

<procedures>

### Step 1 — Parse arguments

From `$ARGUMENTS`: `<source-id|url>` (required), `--reason <text>` (optional), `--yes` (optional). If the target is missing, stop and ask for the source id or URL. If the reason is missing but the user's wording gives a clear reason, infer a concise reason such as `用户主动撤回`; otherwise collect it before Step 4.

### Step 2 — Ask CLI for a plan

Run `context drop --plan <source-id|url> --format json`.
The CLI stores the plan in the current workflow and prints the plan JSON for
the impact summary. Use `--save-output` only when the user explicitly wants a
readable copy; it is not a workflow input.
Do not inspect workspace files yourself. If the CLI reports source-not-found or
source-already-dropped, relay the error and stop.

### Step 3 — Present the impact plan

Render the [User-facing impact summary shape](#user-facing-impact-summary-shape)
from the plan JSON in the user's language. Make clear that dropping a source
removes listed content from active knowledge but keeps it restorable until
`context purge`. Mention conditional graph edge cleanup when
`affected_graph_edges[]` is non-empty; these edges are removed only if the
endpoint leaves active knowledge after reconciliation. Include the reason that will be stamped; if
it is still unknown, ask for the reason before continuing. If `--yes`, log
"auto-confirmed per --yes" and continue. Otherwise wait for `y`; abort on
anything else without writing.

### Step 4 — Reconcile affected knowledge

If the plan summary has `archive_sections: 0`, skip semantic reconcile and continue to Step 5. The apply path is review-free only for this no-op archive case.

Use the current workflow plan created by Step 2. Do not pass a plan file. Then run:

```
context reconcile prepare --mode drop --format json
```

Invoke the packaged semantic reconcile procedure with that prepare payload. Use
stdout `workflow_payload.digest` as `<prepare-digest>`.
Pass the semantic reconcile decision document directly to review, preferably
through stdin:

```
context reconcile review --prepare-digest <prepare-digest> --decisions - --view status
```

The review command persists the ready immutable review artifact for the current
drop workflow scope when `ready_to_apply: true`. Do not extract
`apply_document`, and do not pass the decisions file to drop apply.
If review returns any `questions[]`, ask the user and convert those decisions
from `ask_user` into one of `reanchor`, `remove_unsupported`, or
`split_then_reanchor` before continuing. Do not let `--yes` bypass this step.
Weak evidence support is not a drop safety bypass: `reanchor` and
`split_then_reanchor` still need clearly supported surviving evidence. If
review cannot confirm that support, choose `remove_unsupported` or stop for
user input instead of forcing a weak reanchor.

### Step 5 — Apply the plan

Use the current workflow plan from Step 2. If Step 4 ran semantic review, make
sure the latest `context reconcile review` result returned `ready_to_apply:
true`; the CLI will load that ready review artifact itself. Then call:

```
context drop --apply-plan --reason "<text>" --yes
```

Do not call `context mdrive section ...` or `context mdrive node ...` for the
standard drop flow; `drop --apply-plan` owns cleanup, ledger write when
decisions exist, and verify. If the CLI rejects for missing ready review, rerun
Step 4 and then retry apply without changing the apply command shape.

### Step 6 — Report

The apply command already verifies. Run `context source get <source-id>` and
report in the user's language: topics affected, knowledge items marked
archived/removed from active knowledge, source alias reindex count, archive
status, changelog timestamp.

### Step 7 — Self-verify

- [ ] No Read / Glob / Grep / Write was used against workspace storage — if any was used, restart from **Step 2** with CLI-only flow.
- [ ] No ad-hoc script or shell file traversal was used against workspace storage or temporary workflow artifacts — if any was used, restart from **Step 2** with CLI-only flow.
- [ ] `context drop --plan` succeeded before asking the user — if not, **Step 2**.
- [ ] `context reconcile prepare --mode drop` read the current workflow drop-plan payload — if not, **Step 2**.
- [ ] `context reconcile review` returned zero `questions[]` before apply; if any question remains, ask the user and regenerate the decisions document.
- [ ] User confirmed unless `--yes` was passed — if not, abort without writing.
- [ ] `context drop --apply-plan` exited 0 — if not, surface the CLI error and stop.
- [ ] `context source get <source-id>` shows the source as dropped — if not, surface the mismatch.
- [ ] The reported source entry includes semantic archive status when the source was archived — if missing, surface the mismatch.

</procedures>
