# Article template validation

The provider resources describe 42 article families with profile-specific bindings.
The number of generated files counts bindings, not independent writing strategies.
Repeated structures across profiles are intentional; the generator is maintained in
[generate-article-templates.ts](../../packages/context-cli/scripts/generate-article-templates.ts)
with shared [writing slots](../../packages/context-cli/scripts/indexerArticleBlueprints.ts).

## What is tested

- Resource registration, selected guidance delivery and executable rendering:
  [program tests](../../packages/context-cli/src/__tests__/indexerArticlePrograms.test.ts).
- Authorized deterministic contract tables for page tasks, service APIs, public
  capabilities and components, plus omission without contract evidence:
  [contract bindings](../../packages/context-cli/src/__tests__/articleContractBindings.test.ts).
- Capture, recorded Author input, review, close and package output:
  [scenario runner](../../packages/context-cli/src/__tests__/articleScenarioWorkflow.fixture.ts),
  [code inputs](../../packages/context-cli/src/__tests__/articleCodeScenarios.fixture.ts),
  [document inputs](../../packages/context-cli/src/__tests__/articleDocumentScenarios.fixture.ts).
- Source-bound field rendering and advisory writing diagnostics:
  [template tests](../../packages/context-cli/src/__tests__/indexerPageTemplateV076.test.ts).

These are controlled replays. Passing them does not establish autonomous model
planning, writing quality or real application acceptance. Those evaluations require
separately recorded source scope, model/task conditions, outputs and human assessment.
No article family is marked autonomously quality-approved by these tests alone.

## Contract boundaries

`question_ref` in a template labels a section's writing responsibility; it is not a
new user-question coverage registry. Accepted article `question_targets` are the
single-primary coverage authority, validated by
[indexerArticlePlan.ts](../../packages/context/src/indexerArticlePlan.ts).
Missing suggested outline sections produce warnings; unknown evidence, conflicting
ownership and unplanned required artifacts remain structural errors.

Deterministic blocks render supported contract facts, not inferred business
relationships. Domain entities and state transitions still need source-grounded
Author reasoning. Do not create a renderer simply to increase a block count.

Runtime logs and workspaces are temporary. This checked-in-source-eligible summary,
anonymous fixtures and tests preserve the reproduction method without depending on
local logs. Historical logs are not overwritten or relabeled as fresh results.
Internal application sources, prompts and output samples do not belong here.

## Retained anonymous output samples

These generated package snapshots are controlled replays, not autonomous model-quality approvals. Their source and Author inputs are in the linked fixtures.

- [Page task](samples/page-task.md): access, selected contracts, interaction and next inspection.
- [Regression baseline](samples/regression-baseline.md): smoke selection, change impact, prerequisites and separate recorded outcomes.
- [Incident review](samples/incident-review.md): trigger, evidenced cause, repair verification and prevention.

Validation recorded on 2026-09-10: initial related run 40 passed; after enriching document/variant fixtures, 21 related tests passed; after source selection and cache changes, 22 output/contract/title/cache tests passed. These overlapping runs are not summed into a unique count. CLI build, typecheck and lint succeeded; lint retains existing warnings. Node CLI help smoke succeeded. Full workspace tests, registry installation, downstream distribution and autonomous writing were not run as part of this correction.
