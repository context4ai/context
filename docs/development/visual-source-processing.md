# Source visual processing

Author can convert an authorized captured visual to Mermaid or a Markdown table, or retain its original resource. The Agent decides fidelity and whether its host can read images. CLI performs resource/reference/hash bookkeeping; conversion capability is not a new lifecycle gate.

Workspace initialization writes `package.json` → `context.convertVisuals: true`. Missing configuration means enabled. Current explicit user instructions override the preference without silently changing the saved configuration. Existing AGENTS.md is preserved; new workspaces receive editable minimal diagram styling guidance (approximately 1px lines, theme-default text/strokes, no decorative palette). Exact styling support depends on the downstream viewer.

The common Provider reference is `references/visual-source-processing.md`, maintained in Code and projected into Markdown, Note and Sessions by the article resource generator. Manifest instructions include it for every profile; the Graph Author/Review skill references the selected copy. Company-specific extensions reuse primary instructions.

Captured document views expose authorized visual resources and their actual content hashes. Optional `sections[].visuals` identifies a main `resource`, any `also_read` resources, literal source `context`, effective `requirements`, disposition and format. Author may provide conversion Markdown or omit it to reuse a unique matching approved result. Supporting resources must be in the section's cited document scope. Unavailable conversions retain original links with an advisory. Unknown refs do not authorize access.

A compact `context:visual` comment carries source identity and input hashes with the accepted section. Reuse reads current approved Markdown and requires its approved-content digest to match the stored snapshot. Source bytes, associated context and content requirements determine reuse; output formatting does not. A resource's raw structure and preview can be used independently or together; `also_read` ensures a changed preview invalidates interpretation when it was actually used. Presentation-only changes still affect file-integrity and build digests. Cross-document moves are conservatively rechecked.

Templates render before visual blocks are attached, so a template-variable replacement cannot discard the figure. Successfully converted references are removed from that section. A whiteboard's raw structure and preview share the captured locator for replacement/retention. Captured originals remain immutable. Close removes unreferenced knowledge assets even when no new asset link needed projection; shared references prevent removal. Package projection keeps Mermaid/tables and strips processing comments; the existing referenced-asset packaging path remains in use.

Local file capture currently registers linked assets under its existing `assets/` boundary. Unregistered arbitrary image paths are not expanded into new read authority by this feature. Source capture and required-evidence failures keep their existing recovery paths.

## Validation

Behavior tests: [visual decisions and resources](../../packages/context-cli/src/__tests__/visualSourceProcessing.test.ts) and [capture-to-package delivery](../../packages/context-cli/src/__tests__/visualSourceDelivery.integration.test.ts). The delivery fixture uses an explicitly supplied conversion against anonymous captured material: it proves schema, resource delivery, template preservation, Review, close and package behavior; it does not score autonomous image interpretation. Existing knowledge-asset, package-asset, article-template and instruction-materialization regressions supplement it.
