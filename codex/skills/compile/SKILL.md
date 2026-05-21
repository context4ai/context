---
name: compile
description: >
  Compile the confirmed align plan into knowledge articles: draft, semantic reconciliation, apply, then close. Equivalent to Claude /context:compile; use the local `context` CLI for workspace writes.
tools:
  - Bash
---

# Compile

Public C4A Context entry for agents that expose skills instead of Claude slash commands.

- Public entry: `compile`
- Claude equivalent: `/context:compile`
- CLI primitive prefix: `context ...`
- Internal procedures live under `references/internal-procedures/`; read each referenced file in full before following that step.

---

<!--
This command is slightly over the 30-line default because it carries
the default-mode vs `--plan`-mode comparison inline; the mode contrast
belongs here rather than split across skill references.
The agent protocol itself still delegates to internal packaged procedures.
-->

## Workflow

Synthesise the finalized align plan into knowledge through semantic CLI operations. If the user explicitly authorized托管/全自动/delegated mode at the start of this conversation, create the compile workflow with `--delegated`; otherwise stay in manual/default mode. The agent produces compile draft JSON per Node; the CLI owns storage, rendering, verification, and workflow payload persistence. Read workflow payloads with `context workflow show`; write through `context compile`, `context reconcile`, and `context mdrive` operations, never through direct workspace file tools.

Naming convention:

- `/context:*` names user slash commands.
- `context ...` names CLI primitives.
- Internal packaged procedures invoked by slash workflows are not user slash commands. Do not invent extra slash-command entrypoints for draft or close stages.

Modes:

- **Default (no flag)** — draft plan + semantic reconciliation + apply writes + close.
- **`--plan`** (opt-in when `$ARGUMENTS` contains `--plan`) — per Node, run `context compile --draft <slug> --input - --plan` so the CLI validates stdin draft content without writing active knowledge; surface a user-facing change list (new knowledge, replaced knowledge, unchanged knowledge, and why) while keeping internal Section ids / source refs in details only when needed, then **stop at the end of the per-Node loop — do NOT run close**. The user re-runs `/context:compile` without `--plan` to apply; that run does the real writes + close.
- **`--code [slug]`** — run the CLI-owned code projection route directly with `context compile --code [slug]`, report its output, then stop. This route does not enter doctor/draft/reconcile and uses the same deterministic implementation as `context align --code`. It materializes code snapshots into package/category/symbol Nodes; run `context compile --close` afterward only when the CLI asks for close.

Delegated workflow mode:

- If the user explicitly authorized托管/全自动/delegated mode at the start of this conversation, add `--delegated` to the first compile workflow-creating command, preferably `context compile --scan-changes --delegated --format json`. Do not add it for vague "continue" / "继续" permission.
- `--delegated` is a workflow-level authorization, not a per-review override. It only lets the CLI auto-accept low-risk weak lexical support when `source_support.missing_hard_terms` is empty; missing hard facts, type drift, schema errors, ownership/structure challenges, and destructive gates still block.
- Never hand-author `decided_by: delegated_agent`; the CLI injects it only inside a delegated compile workflow.

Language policy: your explanatory prose and final reports follow the user's conversation language. Node titles, summaries, and user-facing draft explanations follow `NodeContext.generation_policy.language` when the CLI provides it. Source-bound compile draft `content` should stay close to the cited source language when it differs from the workspace language; do not translate cited English facts into Chinese just to match the workspace. Section `summary` is a compact reader/query aid derived from `content`; source_support hard-term matching checks `content`, not `summary`. Preserve product names, code identifiers, CLI flags, slugs, `block_id` / `source_ref` tokens, and exact quoted evidence as printed. CLI stdout/stderr, the canonical `processing <slug>` lines, paths, slugs, block ids, source refs, issue codes, flags, and command names stay as printed.

Stable prompt/output policy: keep fixed protocol, schema, mount matrix, and workspace lookup context before per-Node payloads. For repeated Nodes, use the same command order and consume CLI JSON as-is. Do not add current timestamps, random ids, storage paths, or host absolute paths to draft payloads or reports unless the CLI explicitly returned them as semantic workspace facts.

Preflight:

1. Run `context doctor`; output-align group must be green. If it reports missing aligned knowledge, tell the user to run `/context:align` and stop. Incremental cache group warnings are informational here; only output-align errors block compile.
2. Run `context mdrive workspace stats --format json`, `context source list --format json`, and `context status --format json`; record the before counts and `STATUS.semantic.refreshed_source_pending_compile.source_ids[]`. This status means newer raw snapshots exist; it does not mean finalized ownership or `node.sources[]` are already refreshed.
3. Run `context compile --scan-changes --format json` and parse the JSON as `COMPILE_WORKSET`. If delegated workflow mode is explicitly authorized, run `context compile --scan-changes --delegated --format json` for this first scan instead. `--scan-changes` is the only workset scan flag; `--plan` is reserved for draft validation.
   - If `context workflow status --format json` has `current: null` but `last_published` is present, continue with `context compile --scan-changes`; the published finalized ownership is still the workspace structure truth. Use `context workflow list --format json` only when you need lineage/history diagnostics.
   - Compile JSON may include `source_finalize`; use it as lineage for the finalized ownership that produced the current Node set and citation ownership.
   - If `COMPILE_WORKSET.reason` is `no-changed-nodes` and there are no refreshed sources pending compile, report `no changed nodes`; stop before invoking the draft procedure, running any draft command, or running close.
   - If `COMPILE_WORKSET.status` is `unknown-input`, continue conservatively using the Nodes listed in `COMPILE_WORKSET.nodes`; keep the `unknown_inputs[]` reasons in the final report.
   - Otherwise process only `COMPILE_WORKSET.nodes`, preserving the CLI order. Per-Node `processing <slug>` echoes must match this order.

Review input rule: normal compile flow reads the current prepare payload automatically: pass decisions with `context reconcile review --decisions - --view status`. Add `--prepare-digest` only when you intentionally want an explicit stale guard. Never pass prepare files or hand-edited review output to apply; once review writes a ready artifact for the current workflow scope, plain `context reconcile apply` consumes it.

Semantic decision schema discovery: run `context schema semantic-decisions` for JSON, or `context schema semantic-decisions --format yaml` for readable YAML. Do not infer it from memory, and do not hand-edit review output; once `context reconcile review` writes a ready review artifact for the current workflow scope, plain `context reconcile apply` consumes it without re-reading any decisions file.

`source_ref` values are opaque citation tokens. Copy them from CLI payloads into draft/reconcile decisions exactly as printed; do not parse, normalize, or dereference them as file paths.

Do not use Python, Node.js, shell, or other ad-hoc scripts to preprocess, filter, summarize, or inspect ReconcileContext / review payloads. Do not use `ls`, `find`, `rg`, `cat`, or similar ad-hoc commands to inspect workspace storage or temporary workflow artifacts. Consume the structured output from `context reconcile prepare` and `context reconcile review` directly, and pass agent-authored draft/decision payloads through stdin rather than scratch files. Never extract `review.apply_document` manually; the CLI applies the ready review artifact stored under the current workflow scope.

Refreshed-source loop:

1. If `STATUS.semantic.refreshed_source_pending_compile.source_ids[]` is non-empty, process each source id before the per-Node draft loop. Compile context refreshes deterministic stale source ownership when possible; if the CLI reports `source-ownership-stale`, rerun `context align --scan` and finalize before compiling that source.
2. Run `context reconcile prepare --mode refresh --source <source-id> --format json`. Feed stdout to the procedure in `references/internal-procedures/skill-semantic-reconcile.md` (read it in full first if you have not already); the output includes `workflow_payload.digest` for review. Do not reconstruct the semantic decision shape from memory.
   - The prepare output omits refresh sections whose evidence block hash is unchanged. If it returns a single `status: "unchanged"` / `change_status: "unchanged"` item, report that no semantic refresh decisions are needed for that source and continue with the filtered compile workset.
3. Pass the skill output to `context reconcile review --decisions - --view status`. Use stdout for readiness/issues/questions; apply reads the ready review artifact from the workflow scope. Resolve questions exactly like the per-Node loop, including `support_confirmation`, `scope_review_required`, and `omit_confirmation` handling.
4. Default mode only: run plain `context reconcile apply` after `context reconcile review` returns `ready_to_apply: true`; the CLI loads the unique ready review for the current workflow scope. If questions were answered, rerun review on the updated decisions to refresh the ready artifact, then run `context reconcile apply` again. In `--plan` mode, stop after review and report the not-written refresh decisions.
5. After all refreshed sources are applied in default mode, run `context compile --scan-changes --format json --ignore-source <source-id>` with one `--ignore-source` flag for each refresh-applied source. Use that filtered result for the per-Node loop. This does not rebuild section fingerprints early; it only removes Nodes whose remaining changed blocks came entirely from sources already handled by refresh reconciliation. If a Node still has changed blocks from other sources, unknown inputs, or full-context reasons, keep it in the ordinary per-Node loop.

Per-Node loop:

Process Nodes sequentially. `/context:compile` may cover a multi-Node workset, but each Node must finish its own `context → draft → prepare → review → apply` loop before you apply another Node. Do not run multiple Node draft/reconcile/apply chains in parallel or bury several Node failures inside one shell batch. Capture/align can be broad; compile write decisions must be per-Node and complete.

1. For every workset Node, run `context compile --context <slug> --format json`. If the refreshed-source loop applied any source, append the same `--ignore-source <source-id>` flags used for the filtered workset. The JSON stdout is a compact summary with workflow payload handles; do not extract digests by hand. First inspect citation handles with `context compile --context <slug> --view source-refs --token-budget 2000 --format json` or `context workflow show --payload node-context --view source-refs --token-budget 2000 --unwrap --format json`; this source-refs view is only a projection of `NodeContext.raw_snippets[]`, not a separate data source. If it returns `truncated: true`, follow `how_to_explore[]` to narrow by `--source` / `--heading` or expand the budget. Only expand the durable NodeContext when you are ready to pass its returned `.value` object to the draft skill. NodeContext is derived only from finalized ownership: `primary_evidence` and citation-eligible `shared_evidence` may be cited; `context_only` and every secondary shared snippet are background only and must not be cited. If NodeContext includes `generation_policy`, apply it to generated titles, summaries, and user-facing explanations; for source-bound draft `content`, prefer the cited source language when it differs. Do not default Node titles/summaries to English scaffolding such as "How-To", "Strategy", or "Architecture" when the workspace language is not English. `context compile --context <slug> --request-full-text <block_id> --format json` may expose visible evidence text for inspection, including primary evidence; read expanded page text from `request_full_text.pages[].text`. Long blocks are returned as line-bounded pages with `request_full_text.pages[].next_command`; follow that command to continue reading the same block. `raw_snippets[].quote` mirrors the same page text beside source_ref metadata, but `request_full_text.pages[]` is the explicit page API. Do not use file tools to bypass the page. Full-text inspection does not promote secondary shared evidence into citation eligibility; if the block should support this Node, emit `pending_ownership_challenge` or `structure_challenge` instead of writing a Section. When the workset requires full context, the NodeContext payload has `incremental.status: "full-context"` with the `unknown_inputs[]` reasons from the same entrypoint. `incremental.locator_only_changes[]` entries with `agent_action: "none"` are close-time maintenance only; do not draft them. The CLI stores the durable NodeContext and coverage candidates as workflow payloads, not root scratch files. Do not expand the context with direct file tools; the NodeContext payload is the evidence boundary. Prefer citation-eligible refs for citeable evidence and treat `context_only` as background. Do not repeatedly slice saved NodeContext JSON manually; use source-refs, coverage-summary, coverage detail filters, and returned `how_to_explore[]`.
2. Read `references/internal-procedures/skill-compile-draft.md` in full and follow it to emit draft JSON. Do not reconstruct the draft shape or Section classification rules from memory; the draft skill carries the canonical kind priority, mount matrix, examples, and reflection gates. Section writes use `content` plus optional `summary`; new Sections do not need `section_id`, and the op is exactly `op: "add"` because compile-draft `actions[]` already targets Sections. Do not use align-style op names such as `add_section` or `propose_section`. Cite raw via `source_refs: [...]` chosen from `raw_snippets[].source_ref`; use a single-element array for one citation, and use multiple refs only when the Section content actually consumes all of them. The CLI may auto-narrow over-wide citations and leaves removed refs uncovered. The CLI rejects retired `body` / `detail` / `raw`, singular `source_ref`, and quoted-evidence fields with canonical repair hints. If a note or changed raw snippet should be reviewed but intentionally not written, emit `op: "skip"` with the relevant `source_refs: [...]`; a bare skip is only for deterministic no-op cases. If a NodeContext contains only navigation or placeholder evidence (`Parent` / `Children` / `Related` / `Relations`, "no detailed content", etc.), emit `skip`; do not create a low-value `description` Section from that navigation line just to satisfy the workflow.
3. Fast path: pass the draft to `context compile --node-cycle <slug> --input - --accept-safe-defaults --format json`. This validates the draft, prepares reconcile, reviews mechanically safe defaults, and applies only when no semantic judgment remains. If stdout returns `status: "applied"`, continue to the next Node. If it returns `status: "partial-applied"` or `status: "review-required"`, use the returned `prepare` / `review` handles and continue with the manual path below for only the remaining questions/issues; do not rerun the earlier context/source-ref reads. When you need to patch a remaining action after prepare, run `context compile --draft-status <slug> --format json`; each action backed by the latest prepare payload includes `reconcile_item_id` and `source_support`, so use that claim id instead of guessing.
4. Manual path: pass the draft to `context compile --draft <slug> --input - --plan --prepare --format json`. This validates schema, source refs, and mount matrix, stores the compile draft as a workflow payload, and prepares the semantic reconcile payload without writing active knowledge. Default stdout is a compact prepare summary; use it to inspect readiness. If semantic judgment is needed, load the full prepare payload with `context workflow show --payload prepare --unwrap --format json` and feed that full payload to the procedure in `references/internal-procedures/skill-compile-judge.md` (read it in full first if you have not already). The judge output is the decision input for `context reconcile review`; keep `skill-semantic-reconcile` for refresh/drop or non-compile reconcile flows. For triage-only inspection, use `context workflow show --payload prepare --view issues --unwrap --format json`; add `--status unsupported`, `--status weak`, `--item-id <claim-id>`, or `--page-size <n>` instead of expanding huge prepare payloads. If all pending items are mechanically safe defaults, prefer `context reconcile review --accept-safe-defaults --view status` instead of invoking the skill. If most items are safe and only a few need explicit decisions, combine `--accept-safe-defaults` with `--decisions -` and submit only those explicit decisions. If the CLI returns draft revision hints, use `context compile --draft-status <slug> --format json` and `context compile --draft-patch <slug> --input - --plan` so only the affected action is revised; draft-status includes the action `reconcile_item_id` after prepare, plus `source_support`, so `act_005` and `claim-005` stay mechanically linked. Draft-patch `schema_version` may be omitted, or use `patch_schema_version` from draft-status if you include it. Then rerun `context compile --draft <slug> --plan --prepare --format json` with no `--input`; it reloads the saved patched draft. On hard rejection after a draft session is saved, read `context compile --draft-status <slug> --format json`, patch only the failed actions, and retry.
5. Review the prepared context before accepting defaults. Treat lexical `source_support` as a diagnostic; final support and relation judgment belong to `references/internal-procedures/skill-compile-judge.md`, which must compare only listed candidates and include the same-source-ref multi-kind semantic-role check. Do not copy raw text merely to raise matched-term counts; there is no separate default `evidence-echo` warning, and preserved prose/bullets are valid only when they are active user-facing knowledge. Treat `temporal_prior` and candidate `temporal_disposition` as context for your rationale only; they do not change `default_decision` or make merge/supersede mechanically safe. If the prepare output has `items: []`, use its `next_decisions_template` as the decisions document for review; do not pass the whole prepare context as `--decisions`.
   - If `agent_hints[]` contains `compact-source-low-coverage` or `dense-source-low-coverage`, return to the same compile draft and add actions for the suggested uncovered evidence before semantic review. Treat the reported coverage count (`covered/total`, remaining snippets) as a required self-check, not polish. A supported first quote only proves that one action is valid; it does not prove the Node is complete.
   - If close later reports unresolved coverage, first inspect `context workflow show --payload coverage-candidates --view coverage-summary --token-budget 2000 --unwrap --format json`. Use `available_actions[]` and, when needed, narrow with `context workflow show --payload coverage-candidates --view coverage --type <issue-type> --token-budget 2000 --unwrap --format json` or `--node <slug>`. Then use `context compile --context <slug> --cover-uncovered-only --format json` to start a targeted repair draft, or `context compile --coverage-skip-unresolved --coverage-disposition-node <slug> --reason "<reason>"` only when all unresolved candidates for that node are intentionally excluded for the same reason. Use targeted `coverage-disposition` only when candidates need different outcomes.
6. Pass the judge skill output to `context reconcile review --decisions - --view status`. Use stdout for compact readiness/issues/questions. If questions are returned, ask the user in business language and convert unresolved `ask_user` items into final actions before applying. For `support_confirmation`, use `question.group_key` when present: group only questions that share that key and are all ordinary content-compression checks; ask once with a compact list of claims and cited evidence. If the user confirms the group, keep each final write action and add `decided_by: user`. Do not group questions that add new facts, have missing hard facts, or have different source/evidence boundaries. If review reports unsupported evidence, revise the draft or rerun the judge with corrected source_refs rather than forcing a decision. For `scope_review_required`, consult the procedure in `references/internal-procedures/skill-semantic-reconcile.md` once more over the prepare context and current decisions before asking the user; if it still cannot resolve the scope, ask the user. For `omit_confirmation`, ask the user; only a confirmed no-write answer may become `action: omit` with `decided_by: user`. Never mark `decided_by: user` on your own; auto mode or permission to continue is not user confirmation.
7. Default mode only: run plain `context reconcile apply` after `context reconcile review --view status` returns `ready_to_apply: true`; the CLI applies the unique ready review for the current workflow scope. If questions were answered, rerun review on the updated decisions, then run `context reconcile apply` again. This writes active knowledge, verifies, and records the semantic ledger. In `--plan` mode, stop after review and report the not-written decisions.
8. Persistent failure → stop and surface the full rejection list; never edit rendered files to bypass.

Close (default mode only — skip entirely in `--plan` mode):

1. Read `references/internal-procedures/skill-compile-close.md` in full and follow it; it triggers `context compile --close`, which refreshes locator-only evidence, canonicalizes source refs, compacts derived knowledge files, verifies the final workspace, rebuilds section fingerprints, and refreshes the incremental cache.
2. Run `context verify` as a second pass if the skill escalated any issue. Run `context mdrive workspace stats --format json` and `context source list --format json` and diff against the before counts.
3. Run `context mdrive node list --format json` to collect semantic node handles for the final report. Use `node_class` to keep concrete entities, term definitions, domains, and actions visibly separated. If the user explicitly asks for file links, use an explicit human/report view when available; those links are user inspection aids, not workflow inputs.

`context compile --close` may archive explicit debug scratch files through the CLI-owned output lifecycle. Normal compile state lives in workflow-scoped payloads. Current align state is internal CLI state, not a file protocol. Do not move, delete, or archive workspace output files yourself; the CLI owns that lifecycle.

Close only projects finalized Nodes that materialize as a CLI-written knowledge article or as an explicit no-write placeholder declared by align with `planned_sections: []`. A compile skip action records reviewed no-write evidence, but it does not by itself turn an arbitrary finalized Node into a placeholder.

In plan mode, your final report is the aggregated user-facing change list across all Nodes + "re-run `/context:compile` without `--plan` to apply"; do not run `context compile --close` or `context verify` (they only make sense against a real write).

Never claim success unless `context compile --close` exited 0 and `context verify` is green. The only exception is the `no-changed-nodes` gate, where you report that compile stopped before draft and no files were written. Never hand-write rendered knowledge, index, or changelog files — the CLI is the sole writer.
Never use Read / Glob / Grep / Write against workspace storage; use `context workflow`, `context compile`, `context reconcile`, `context source`, `context query`, and `context mdrive`.
For large draft payloads, feed stdin directly into the `context compile` command with a heredoc. Do not pipe a heredoc through another command and do not redirect generated content into workspace files. Do not pipe `context ... --format json` through `python3`, `node`, `jq`, `sed`, `cat`, `2>&1`, or shell fallback wrappers. For draft schema discovery, run `context schema compile-draft` for readable YAML or `context schema compile-draft --format json` for machine-readable JSON:

```bash
context compile --draft billing-api --input - --plan --prepare --format json <<'JSON'
{
  "schema_version": "compile.draft.v2",
  "target_node": "billing-api",
  "actions": [
    {
      "op": "add",
      "kind": "description",
      "content": "Billing API exposes invoice lookup and payment capture endpoints.",
      "source_refs": ["src-1#billing-api L10-18@7a6f4c9d2e10"]
    }
  ]
}
JSON
```

For reviewed no-write material, keep the evidence in the skip action so semantic review can record it:

```bash
context compile --draft billing-api --input - --plan --prepare --format json <<'JSON'
{
  "schema_version": "compile.draft.v2",
  "target_node": "billing-api",
  "actions": [
    {
      "op": "skip",
      "reason": "reviewed; intentionally not written",
      "source_refs": ["src-1#reviewed-note L12-14@7a6f4c9d2e10"]
    }
  ]
}
JSON
```

For navigation-only or placeholder-only context, no active Section is the correct result:

```bash
context compile --draft billing-api --input - --plan --prepare --format json <<'JSON'
{
  "schema_version": "compile.draft.v2",
  "target_node": "billing-api",
  "actions": [
    {
      "op": "skip",
      "reason": "navigation-only context; align graph already preserves parent/child/related structure"
    }
  ]
}
JSON
```

Final report contract (default mode):

- Report in the user's conversation language.
- Keep a stable structure with these semantic sections; translate section headings into the user's conversation language instead of copying these English labels verbatim:
  1. Completion headline.
  2. Semantic apply table. Include refreshed-source rows first in source-id order when the refreshed-source loop ran, then one row per Node in align frontmatter order. Columns: target (source id or Node title/slug), type (`refresh` or Node type), and the `context reconcile apply --format json` counts: `applied`, `skipped`, `merged`, `superseded`, `kept_separate`, `omitted`, and `questions_resolved`. Include `reanchored`, `removed_unsupported`, and `split_then_reanchored` only when non-zero.
  3. Close stage with `context compile --close` result, final node/section totals, verify status, changelog stamp, incremental counts (`recompiled`, `locator_updates`, `canonical_source_ref_updates`, `rebuilt`), section fingerprint rebuild count, and archive status / archived file count when reported by CLI. Do not use close output as the semantic apply summary; aggregate the per-Node `context reconcile apply` results from Step 6.
  4. Before/after status diff table with at least total nodes, node counts by type, total sections, and last compile time.
  5. Knowledge objects by semantic handle. Include every Node slug and `node_class` returned by `context mdrive node list --format json`; group or label term definitions separately from concrete entities when useful. Include human-readable links only when an explicit human/report view returns them, and state that they are not workflow inputs.
  6. Optional next step only when there is a concrete useful follow-up (for example recapture stale material or run `/context:align` to revise structure).
- Do not say the user can inspect files without providing links.

Final report contract (`--plan` mode):

- Use the same stable shape where possible, but make the headline clearly indicate that this was a plan-only run.
- Replace the close-stage section with a not-written section and tell the user to re-run `/context:compile` without `--plan` to apply.
- Do not include knowledge file links for files that were not written.
