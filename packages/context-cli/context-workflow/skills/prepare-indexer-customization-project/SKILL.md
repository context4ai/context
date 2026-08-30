---
name: prepare-indexer-customization-project
description: Resolve the exact validated customization selection and stage its CAS-bound project proposal.
---

# Prepare Indexer customization project

Read
`node_modules/@c4a/context/docs/guides/indexer-provider-and-customization.md`
before staging a project proposal. If validation reports an invalid local
resource or upstream drift, preserve the exact
`indexer-customization-invalid`/`indexer-customization-upstream-changed`
diagnostic and return to reconciliation; do not silently drop or overwrite the
affected override.

Consume only the current `context.indexer.customization-validation-result/v1`.

1. Pass `selection_proposal_input` to `context indexer validate-indexer-selection-proposal`.
2. Resolve every emitted Provider request through `context indexer resolve-indexer-providers`; never scan a
   plugin cache or substitute another version. Stage each resolved Bundle with
   `context indexer stage-indexer-provider-bundle`.
3. Build `context.indexer.customization-project-preparation-input/v1` with the exact validation digest,
   static report, resolved/staged Bundle inputs, and current CLI operator/profile contracts. Run
   `context indexer prepare-indexer-customization-project`.
4. If the result is `program-authorization-required`, stop at the independent program-execution authority.
   Do not invent the authority receipt and do not apply any source file.
5. If the result is `project-confirmation-required`, preserve the returned proposal digest and staging
   validation unchanged for the confirmation/apply route.

Never copy Provider files into the project, widen requirement scope, add dependency intents, or bypass the
content-addressed customization stage.
