---
context_resource: semantic/align/structure-planning
id: context.semantic.align.structure-planning
kind: procedure
media-type: text/markdown
applies-to:
  - node_type
  - title
  - tags
  - ownership
  - edges
  - structure
name: structure-planning
description: "Internal procedure for the current align gate. Reads CLI-guided align evidence, applies semantic Node classification gates, and emits context.structure.v1 payloads for CLI validation/stage."
---

# Structure Planning Procedure

## TL;DR

Run `context run align:<type>:<source>:<collection> --view read-plan --format json`, follow the top-level `next_action.command` to read the CLI-selected evidence path, produce a `context.structure.v1` structure payload, and continue following top-level `next_action`. The CLI owns route, validation, repair commands, and stage guards; the Agent owns only semantic classification and source-bound structure judgment.

<reference>

## Canonical Data

- The current phase view result is authoritative. Branch on `next_action.kind`,
  execute `next_action.command`, and treat listed views as detail reads rather
  than a checklist.
- `allowed_actions[]` describes capabilities on the current view result; it is
  not a menu of alternate write paths and does not override `next_action`.
- `agent_hints[]`, when present, are diagnostics. Do not prefer them over
  top-level `next_action`.
- Schema names and enum values come from
  `context run align:<type>:<source>:<collection> --view schema --format json`. Use
  that schema as the authoring contract for `context.structure.v1`.
- Existing approved knowledge is the lookup registry exposed by the current
  align `existing-knowledge` View. Do not read `knowledge/**`, guess a top-level
  query command, or create a separate registry file.
- Code projection Nodes are reusable knowledge handles. When document evidence belongs on a code symbol, reuse the code slug instead of creating a parallel document Node.
- Validation diagnostics are the mechanical structure ownership source of
  truth. Non-content spans such as navigation references, placeholders, front
  matter, marker quotes, embed tags, and embedded assets should not become
  reader-facing Sections unless the evidence itself is the cited knowledge.
- When relation hints are present, inspect them before finalizing graph
  structure. Use existing/current matches for typed `edges[]`; keep unresolved
  target ref/title hints deferred in `unresolved[]` and do not write dangling
  parent, child, or edge refs. Ordinary source-bound views require at least one
  source-backed planned section. The only empty-section exception is a generated
  parent index view: it must use `generated: parent_index`, `sections: []`, and
  source-backed `contains` edges to child views. For navigation-only /
  placeholder-only sources, keep useful source/page identities as `unresolved[]`
  notes until there is source-backed section evidence, a supported edge target,
  a valid parent-index container, or a later compile `skip` decision. If a
  placeholder/relation source is skipped entirely, leave its relation clues in
  `unresolved[]` only when they still matter; otherwise omit them.
- `views[]` and diagnostics distinguish citable evidence from supporting context. Do not promote supporting/context-only material into cited Sections unless a later ownership correction makes it citation-eligible.
- Keep cache-friendly prompt order: fixed protocol/schema first, source evidence
  views second, targeted existing-knowledge results third, and the current
  semantic payload last. Preserve CLI JSON order and do not add timestamps,
  random ids, scratch paths, or host paths to generated payloads.
- Structure digests and snapshot hashes are stale guards. Follow returned
  `next_action.command` and do not invent digest values.
- Node type, tag, fake-Entity, `domain`, and `action` gates are in `structure-planning/references/gates.md`.
- Coarse reading density and neutral signal rules are in `structure-planning/references/density-profile.md`.
- Candidate anomaly handling, stable references, duplicate handling, and
  conflict handling are in
  `structure-planning/references/candidate-resolution.md`.

</reference>

<procedures>

Use this only inside the current align gate.

### Step 1 — Start From The Envelope

Run `context run align:<type>:<source>:<collection> --view read-plan --format json`.
Confirm the response is the current prose align view result, then identify
`next_action`, available views, source metadata, and diagnostics.

If the host truncates a view result but the preview includes top-level
`next_action.command`, run that command. If `next_action` is not visible, rerun
the current view command; do not recover host tool-result files.

If no current phase view result is present, stop and surface the CLI output; do
not reconstruct an align route from prior prompt memory.

### Step 2 — Follow The Evidence Read Path

Run the returned `next_action.command`. For structural align work this is
normally `read-plan`; after that, follow the evidence view's `next_action.command`
or `next_command`.

`read-plan` is the navigation surface. It chooses whether the next evidence read
is `source-index`, `span-detail`, `span-text`, or another current evidence view.
Read those views and then author the requested `context.structure.v1` payload
yourself after completing the targeted lookup in Step 3. Never pipe evidence
text into validate.

If an evidence view is truncated, `page.has_more: true`, or the CLI returns a
`next_command`, run that command before authoring.

Read evidence through semantic CLI views, not shell parsing. Follow `page.next_command` for pagination. If the command contains `--read-cursor`, treat it as opaque continuation state and run it exactly; do not replace it with hand-written `--source`, `--heading`, `--window`, or `--range` selectors. Use `--source`, `--heading`, `--window`, `--range`, and `--token-budget` as view filters only. `--unwrap` removes workflow metadata; it does not expand a compact view into full detail.

If an evidence view returns `page.has_more`, `truncated: true`, or a
view-specific incomplete-read diagnostic, treat that response as a partial
read. Do not decide source-wide ownership or dense planned Sections from
headings alone; continue the current detail view only when `page.next_command`
is explicitly needed, otherwise return to the CLI-designated navigation view.

### Step 3 — Reuse Existing Knowledge

After source evidence identifies a candidate title or stable ref, run:

```bash
context run align:<type>:<source>:<collection> --view existing-knowledge --query <title-or-stable-ref> --format json
```

Use the returned pagination command when present. Exact title, NodeRef, or
ViewRef hits should usually reuse the existing Node instead of creating a
duplicate candidate. The lookup returns only the best title/NodeRef/ViewRef
identity tier. Shared tag matches are summarized separately and never require
walking the related subgraph merely to determine whether a root identity
exists. The lookup is deterministic identity discovery; the Agent still
decides whether the source evidence describes the same concept.

When a code projection Node already represents the object, reuse its slug for prose evidence and plan only prose-owned Sections for the current source evidence.

### Step 4 — Route Collection, Then Classify Semantic Structure

Before choosing Node type or Section kind, route each evidence unit to its
internal collection. The phase `<collection>` is only the entry profile for the
current run; it is not a cap on what this structure may contain. A mixed source
can produce multiple `views[]` in one confirmed structure when source evidence
supports them.

Use collection routing first:

- product intent, user story, requirement, roadmap, or product scenario ->
  `product`;
- architecture, service/module/system design, runtime dependency, code-adjacent
  prose -> `architecture`; if an existing code projection already owns the
  object, reuse its NodeRef/ViewRef instead of creating a `codeindex` prose
  view;
- SOP, runbook, operation drill, workflow, or how-to procedure -> `sop`;
- FAQ, question/answer, support notes -> `faq` only when the evidence is an
  independent FAQ page or cross-cutting support knowledge; a single Q&A or
  scattered support note stays as a `faq` Section under the owning view;
- standards, policy, rules, conventions, reusable constraints -> `standards`;
- decision record, trade-off, migration conclusion -> `decision` only when it
  is an independent decision record with owner/date/lifecycle or cross-cutting
  decision scope; one-off conclusions stay as `decision` Sections under the
  owning view;
- incident, postmortem, outage, fault timeline, action item -> `incident` only
  when it has incident identity, timeline, follow-up, or tracking lifecycle;
  isolated warnings/failures/action items stay as `incident` or `warning`
  Sections under the owning view;
- test plan, validation scenario, acceptance case -> `test`;

Do not route prose align views to `codeindex` or `feats`: `codeindex` is
produced by code extraction / AST projection, and `feats` is reserved for the
dedicated feature workflow. For section-vs-collection overlap, keep a local
`faq`, `decision`, or `incident` as a Section kind under the owning view unless
the source is independently queryable across the package and has its own
lifecycle, ownership, timeline, or cross-cutting scope.

After collection routing, apply `structure-planning/references/gates.md` before
authoring Nodes: classify Node type in order (`action` scale + process evidence,
then concrete/term `entity`, then child-bearing `domain`), reject fake Entities
only when at least two suspicious signals match, keep `term` separate from
concrete tags, and provide required gate evidence.

Preserve shared-source intent when the same source span legitimately supports
multiple views. Do not copy the span text into multiple rewritten bodies; cite
the same CLI `source_ref` in each supported view and let structure-summary mark
the shared evidence.

Source titles and headings are ordinary evidence, not structural authority. Choose titles and summaries that fit the final Node type and the CLI-provided generation policy.

Plan source material as Sections first. A source heading only becomes a child
Node/View when the cited evidence names a concrete independent subject, an
atomic term, a gated Action, or a child-bearing Domain. A `contains` edge only
states hierarchy; it does not prove that a thin child page has standalone
retrieval value.

Avoid same-source fragmentation. If one parent would contain many single-section
child Entities from the same source document, keep them as Sections unless each
child has an independent product/code object, atomic term, Action, or Domain
identity. Also avoid copying the parent `system` / `application` scope tag onto
local child aspects; tag a child by what it independently is.

Do not promote a source fragment into a child page solely because it has a
heading or a recognized section kind. Judge every proposed child with the same
source-backed criteria: independent subject identity, sufficient context, and
standalone retrieval value. The CLI may warn about repeated same-source thin
children, but page granularity remains an evidence-backed structure decision
for the review report rather than a content-type-specific hard gate.

For `node.title` and `node.summary`, follow the workspace/source language
surfaced by the current view or the user's instruction. In Chinese workspaces,
translate descriptive scaffold words such as architecture, strategy, lifecycle,
overview, scheduling, high availability, and warning into Chinese while
preserving product names, code identifiers, CLI flags, slugs, source_ref tokens,
and citation tokens exactly when needed. Do not copy an English source title
into `node.title` merely because the source is English.

Do not classify a broad architecture/system/方案 source as `domain` just because the title sounds like a scope. If it has writable Sections but no resolvable current/existing child Nodes, use an `entity` tag such as `system` or `application`; reserve `domain` for grouping child Nodes through typed `edges[]` with supported child targets.

For large or batched payloads, use
`structure-planning/references/density-profile.md` and
`structure-planning/references/candidate-resolution.md` as judgment aids.
They do not create additional workflow stages or alternate payloads.

### Step 5 — Build The Payload Requested By `next_action`

Use `context run align:<type>:<source>:<collection> --view schema --format json` to
shape the payload. Treat that schema as the authoring contract.

Produce one `context.structure.v1` document with semantic Nodes, planned
Sections, typed edges, unresolved items, lifecycle state, sources, and evidence
snapshot hash. Section identities are part of the structure gate: choose stable
section ids such as `overview`, `behavior`, `constraints`, or a source-backed
domain-specific name when the evidence supports it.

For an independent collection entry, omit `containment`; the CLI derives
`<collection>/<slug>.md`. Set `containment` only when the confirmed structure
intentionally places the View under a parent path. Do not add a source/module
wrapper merely to make every page use the same directory depth.

Use only CLI-provided `source_refs[]` for section and edge evidence. Continuity
is a per-Section constraint, not a per-View constraint: one View may contain
many independently retrievable Sections, each with its own continuous mirror.
Do not invent heading/range/window selectors inside the structure. Treat source
heading changes as section-planning signals: sibling sub-headings under a shared parent
may stay in one Section when they form one coherent semantic topic; headings
with no shared parent should usually split unless you intentionally want one
Section to span them. If a semantic section would require non-contiguous or
cross-source evidence, split it during align or return the issue to the
structure gate. Current compile writes approved knowledge by mirroring source
spans; it does not use rewritten multi-ref sections to compress unrelated
evidence.

Validate will surface source mirror blockers before confirmation. Treat
`section.source_mirror_split_required`,
`section.source_mirror_repair_required`, and
`section.source_mirror_source_refs_missing` as structure problems, not compile
drafting problems. Use the returned `repair.suggested_splits[]` when present;
otherwise repair source refs from CLI evidence views or move unsupported
material to `unresolved[]`.

For pure suggested-split repairs, prefer the CLI repair view before hand-editing:
Deterministic source-boundary repairs are applied internally by validate/stage
and are not a separate Agent command.
It splits non-contiguous Section mirrors and can expand a broad cross-heading
Section into Markdown structural groups within the same View. Apply the
non-blocking repair hint when the groups should be independently retrievable;
otherwise keep the Section and explain the grouping in structure review.
Oversized Views still require the Agent to apply the returned child-View and
contains-edge suggestions while classifying every child Node from evidence.
Those suggestions preserve Section order and place adjacent Sections into
bounded groups; `part-N` names are placeholders, not semantic titles. Rename
and classify each child from evidence instead of expanding one child View per
Section or treating the suggested grouping as a content decision. The repair
command does not resolve orphan ownership, unsupported evidence, or competing
semantic groupings.

When the cited source sentence itself is uncertain, preserve that uncertainty on
the edge with `confidence: possible` or `confidence: hypothesis`. This is only
for source-authored uncertainty such as "可能", "疑似", "may", or "might". If
you are unsure whether the source supports the relation, do not add an uncertain
edge; move the relation to `unresolved[]`.

No-write/navigation-only/placeholder-only material should become `unresolved`
at align time when it has retrieval or graph value but lacks source-backed
section evidence. Do not turn relation-only navigation into a factual Section.
Do not submit `sections: []` for an ordinary source-bound view. Use
`sections: []` only for a generated parent index view, and only when it has
`generated: parent_index` plus source-backed `contains` edges to child views.
If the relationship matters but evidence or a target node is missing, keep it
unresolved instead of writing a dangling edge.

Emit `depends_on` edges only when cited source refs explicitly say one Node
consumes, requires, calls, is configured by, or is downstream of another Node as
a prerequisite, capability provider, upstream input, runtime dependency, or
data-flow source. Direction is consumer/downstream -> provider/upstream. Do not
create `depends_on` for parent/child containment, `Related`/`See also` lists,
sibling co-occurrence, shared table membership, name similarity, or a plain
mention without a dependency predicate. `edges[].source_refs[]` must include the
source ref that states the dependency; if the relationship matters but evidence
is missing, leave the edge unresolved instead of guessing.

Prefer the strongest source-backed `section_kind` using the current schema's
`section_kind_priority` and the semantic rules below; avoid planning an entire
dense source as `description` when the evidence clearly contains fenced
examples, comparison tables, Q&A, decisions, specs, warnings, or principles.
Use `example` for fenced command/config/code or literal sample blocks, not
ordinary scenario prose. Use `comparison` for two or more subjects compared
across two or more dimensions. Use `faq` for a question-and-answer pair. Use
`incident` only for dated or timestamped failure evidence with impact scope
plus root cause, mitigation, or handling record. Use `changelog` for a
versioned or dated change record. Use `decision` only when the source surfaces
two or more alternatives or options plus the chosen path and rationale. Use
`spec` for a verifiable rule, threshold, requirement, constraint, or checkable
target; `warning` for an explicit caveat, risk, hazard, or limitation;
`principle` for a stable invariant, design rule, or core mechanism without a
check method; and `description` only as the narrative fallback. Treat kind
precision as a drafting quality preference, not a reason to block an otherwise
source-backed write. Keep only raw-backed semantic decisions in the payload;
leave mechanical repair and patch routing to CLI diagnostics.

There is no parallel candidate-body authoring path. Emit only the
`context.structure.v1` payload accepted by the current schema view.

### Step 6 — Validate And Submit

Before staging, write the `context.structure.v1` payload to the Route-selected `.tmp/agent-payloads/` path and run the returned `context run align:<type>:<source>:<collection> --validate --input <payload-file> --format json` command. The CLI applies deterministic boundary repairs internally and returns only remaining blockers. For oversized Views, apply the returned child-View and contains-edge suggestions while classifying child Nodes from evidence. Resolve other blockers from evidence; ask the user only when evidence supports multiple incompatible semantic choices. Stage only after validation state is `ready`. The stage result opens the final HTML report for the Route-selected structure-confirmation gate. Execute the revision-bound confirmation command returned by `workflow.current`; managed session authority may resolve that gate without another question.

After stage succeeds, do not rerun the same write command to confirm success.
Use `context status --format json` or the returned result for read-only
confirmation; then continue with the returned `next_action.command`, normally
`context run compile:<type>:<source>:<collection> --view read-plan --format json`.

If any write is rejected, follow the returned `next_action` and `reason_code`.
Do not retry by guessing direct/batched stages, forcing route bypasses, or
editing CLI-managed files.

### Step 7 — Self-verify

- [ ] All writes followed top-level `next_action.command`. If not, return to **Step 1**.
- [ ] Evidence was read through returned `next_action.command`, `next_command`, or current CLI schema/view commands only. If not, return to **Step 2**.
- [ ] Node classification used the semantic gates in `structure-planning/references/gates.md`. If not, return to **Step 4**.
- [ ] URL/reference ownership followed CLI diagnostics, not static prompt rules. If not, return to **Step 5**.
- [ ] The requested align payload passed the exact Route-selected `--validate --input <payload-file>` command before stage. If not, return to **Step 6**.
- [ ] No `sources/`, `knowledge/`, `dist/`, `.tmp`, host tool-results, or CLI-managed files were read or written with generic tools. If violated, restart from **Step 1**.

</procedures>
