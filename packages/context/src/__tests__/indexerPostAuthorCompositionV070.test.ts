import { describe, expect, test } from "bun:test";
import {
  acceptIndexerPostAuthorRun,
  buildIndexerPostAuthorFragmentRequest,
  canonicalIndexerNodeRef,
  composeIndexerPostAuthorEnvelope,
  failIndexerPostAuthorRun,
  initializeIndexerPostAuthorRunLedger,
  indexerLayerFragmentDigest,
  indexerProtocolDigest,
  materializeIndexerPrimaryResultView,
  observeIndexerPostAuthorState,
  planIndexerPostAuthorComposition,
  recoverIndexerPostAuthorRunLedger,
  resolveEffectiveIndexerComposers,
  startIndexerPostAuthorRun,
  validateIndexerPostAuthorFragmentResult,
  validateIndexerPrimaryResultView,
  type IndexerEffectiveComposerSet,
  type IndexerLayerFragment,
  type IndexerLayerFragmentRunResult,
  type IndexerPostAuthorFragmentRequest,
  type IndexerPostAuthorPlan,
  type IndexerPostAuthorRunLedger,
  type IndexerPrimaryArtifactView,
  type IndexerPrimaryFactView,
  type IndexerSubjectKey,
} from "../index.js";

const AUTHOR_WORKSET_DIGEST = `sha256:${"1".repeat(64)}`;
const PRIMARY_RESULT_DIGEST = `sha256:${"2".repeat(64)}`;
const VALIDATOR_DIGEST = `sha256:${"3".repeat(64)}`;
const PROFILE_BINDING_DIGEST = `sha256:${"4".repeat(64)}`;
const INPUT_VIEW_DIGEST = `sha256:${"5".repeat(64)}`;
const LAYER_INTEGRITY = `sha256:${"6".repeat(64)}`;
const BUNDLE_DIGEST = `sha256:${"7".repeat(64)}`;
const SELECTION_A_DIGEST = `sha256:${"8".repeat(64)}`;
const SELECTION_B_DIGEST = `sha256:${"9".repeat(64)}`;
const SUBJECT_KEY: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "sample-package",
  kind: "component",
  local_key: "public-button",
};
const NODE_REF = canonicalIndexerNodeRef(SUBJECT_KEY);

function facts(summary = "public control"): IndexerPrimaryFactView[] {
  return [{
    fact_ref: "fact:component-summary",
    subject_key: SUBJECT_KEY,
    fact_kind: "component-summary",
    value: { summary },
    evidence_refs: [{
      ref: "evidence:component-source",
      kind: "code",
      source_digest: `sha256:${"a".repeat(64)}`,
    }],
  }];
}

function artifacts(): IndexerPrimaryArtifactView[] {
  return [{
    artifact_ref: "artifact:component-overview",
    subject_key: SUBJECT_KEY,
    artifact_kind: "overview",
    artifact_policy_variant: "standard",
    variables: { title: "Public button" },
    evidence_refs: [{
      ref: "evidence:component-source",
      kind: "code",
      source_digest: `sha256:${"a".repeat(64)}`,
    }],
  }];
}

function effectiveSet(ids: readonly ("examples" | "reference")[]): IndexerEffectiveComposerSet {
  return resolveEffectiveIndexerComposers({
    selections: ids.map((id) => ({
      id,
      provider: "sample-extension",
      composer_selection_entry_digest:
        id === "examples" ? SELECTION_A_DIGEST : SELECTION_B_DIGEST,
    })),
    manifest_layers: [{
      provider: "sample-extension",
      layer_ref: "provider:sample-extension#layer:supporting",
      layer_integrity: LAYER_INTEGRITY,
      bundle_digest: BUNDLE_DIGEST,
      composers: [{
        id: "examples",
        supported_profiles: ["component-library"],
      }, {
        id: "reference",
        supported_profiles: ["component-library"],
      }],
    }],
    current_profiles: ["component-library"],
  });
}

function plan(ids: readonly ("examples" | "reference")[]): IndexerPostAuthorPlan {
  return planIndexerPostAuthorComposition({
    effective_composer_set: effectiveSet(ids),
    author_workset_digest: AUTHOR_WORKSET_DIGEST,
    primary_result_digest: PRIMARY_RESULT_DIGEST,
    primary_facts: facts(),
    primary_artifacts: artifacts(),
    validator_contract_digest: VALIDATOR_DIGEST,
    current_profile_binding_digest: PROFILE_BINDING_DIGEST,
    allowed_target_refs: [NODE_REF],
  });
}

function requirePending(value: IndexerPostAuthorPlan) {
  if (value.state !== "pending") throw new Error("expected pending plan");
  return value;
}

function proposalFragment(
  request: IndexerPostAuthorFragmentRequest,
  variableValue = "example",
): IndexerLayerFragment {
  const payload: Omit<IndexerLayerFragment, "fragment_digest"> = {
    protocol: "context.indexer.layer-fragment/v1",
    workset_digest: request.workset.workset_digest,
    layer_ref: request.target_layer_ref,
    layer_integrity: request.target_layer_integrity,
    composer_ref: request.composer_ref,
    phase: "post-author",
    kind: "derived-artifact-proposal",
    target_refs: [NODE_REF],
    payload: {
      protocol: "context.indexer.fragment.derived-artifact-proposal/v1",
      proposals: [{
        composer_ref: request.composer_ref,
        target_node_ref: NODE_REF,
        artifact: {
          artifact_id: "primary-example",
          artifact_kind: "example",
          artifact_policy_variant: "standard",
          representation: "sections",
          sections: [{
            section_key: "example",
            owner_indexer_id: "sample-indexer",
            document_kind: "guide",
            reader_goal: "use-example",
            artifact_kind: "example",
            blocks: [{
              block_id: "example",
              layer: "semantic-prose",
              markdown: variableValue,
              evidence_refs: ["evidence:component-source"],
            }],
          }],
        },
        evidence_refs: [{
          ref: "evidence:component-source",
          kind: "code",
          source_digest: `sha256:${"a".repeat(64)}`,
        }],
      }],
    },
  };
  return {
    ...payload,
    fragment_digest: indexerLayerFragmentDigest(payload),
  };
}

function runResult(
  request: IndexerPostAuthorFragmentRequest,
  fragments: readonly IndexerLayerFragment[],
): IndexerLayerFragmentRunResult {
  const payload = {
    protocol: "context.indexer.layer-fragment-result/v1" as const,
    request_digest: request.request_digest,
    composer_ref: request.composer_ref,
    consumed_primary_result_view_digest: request.primary_result_view.view_digest,
    fragments: [...fragments],
  };
  return {
    ...payload,
    result_digest: indexerProtocolDigest(payload),
  };
}

function acceptComposer(input: {
  currentPlan: IndexerPostAuthorPlan;
  ledger: IndexerPostAuthorRunLedger;
  composerRef: string;
  withProposal?: boolean;
}): IndexerPostAuthorRunLedger {
  const started = startIndexerPostAuthorRun({
    plan: input.currentPlan,
    ledger: input.ledger,
    composer_ref: input.composerRef,
  });
  return acceptIndexerPostAuthorRun({
    plan: input.currentPlan,
    ledger: started.ledger,
    composer_ref: input.composerRef,
    result: runResult(
      started.request,
      input.withProposal ? [proposalFragment(started.request)] : [],
    ),
    validator_contract_digest: VALIDATOR_DIGEST,
  });
}

describe("PrimaryResultView and effective composers", () => {
  test("binds an optional composer contract into the effective set and workset", () => {
    const contract = {
      instruction: "references/composers/examples.md",
      primary_requirements: {
        fact_kinds: ["example-candidate"],
        artifact_kinds: ["overview"],
      },
      derived_artifact_policy: {
        fragment_protocol: "context.indexer.layer-fragment/v1" as const,
        fragment_kind: "derived-artifact-proposal" as const,
        artifact_policy_variant: "standard",
        artifact_kinds: ["example"],
      },
      empty_result: {
        result_protocol: "context.indexer.layer-fragment-result/v1" as const,
        behavior: "empty-fragment-set" as const,
      },
    };
    const effective = resolveEffectiveIndexerComposers({
      selections: [{
        id: "examples",
        provider: "sample-extension",
        composer_selection_entry_digest: SELECTION_A_DIGEST,
      }],
      manifest_layers: [{
        provider: "sample-extension",
        layer_ref: "provider:sample-extension#layer:supporting",
        layer_integrity: LAYER_INTEGRITY,
        bundle_digest: BUNDLE_DIGEST,
        composers: [{
          id: "examples",
          supported_profiles: ["component-library"],
          contract,
        }],
      }],
      current_profiles: ["component-library"],
    });
    expect(effective.entries[0]?.composer_contract_digest).toBe(
      indexerProtocolDigest(contract),
    );
    const currentPlan = planIndexerPostAuthorComposition({
      effective_composer_set: effective,
      author_workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: PRIMARY_RESULT_DIGEST,
      primary_facts: facts(),
      primary_artifacts: artifacts(),
      validator_contract_digest: VALIDATOR_DIGEST,
      current_profile_binding_digest: PROFILE_BINDING_DIGEST,
      allowed_target_refs: [NODE_REF],
    });
    expect(requirePending(currentPlan).worksets[0]?.composer_contract_digest).toBe(
      indexerProtocolDigest(contract),
    );
  });

  test("materializes consumable primary facts and artifacts with a bound receipt", () => {
    const view = materializeIndexerPrimaryResultView({
      workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: PRIMARY_RESULT_DIGEST,
      facts: facts(),
      artifacts: artifacts(),
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(view.facts[0]?.value).toEqual({ summary: "public control" });
    expect(view.artifacts[0]?.variables).toEqual({ title: "Public button" });
    expect(validateIndexerPrimaryResultView(view)).toEqual(view);
  });

  test("computes only registry-selected, manifest-declared, profile-applicable composers", () => {
    const selected = effectiveSet(["examples"]);
    expect(selected.entries.map((item) => item.composer_id)).toEqual(["examples"]);
    expect(() => resolveEffectiveIndexerComposers({
      selections: [{
        id: "not-selected-capability",
        provider: "sample-extension",
        composer_selection_entry_digest: SELECTION_A_DIGEST,
      }],
      manifest_layers: [{
        provider: "sample-extension",
        layer_ref: "provider:sample-extension#layer:supporting",
        layer_integrity: LAYER_INTEGRITY,
        bundle_digest: BUNDLE_DIGEST,
        composers: [{ id: "examples", supported_profiles: ["component-library"] }],
      }],
      current_profiles: ["component-library"],
    })).toThrow(/indexer-composer-not-enabled/);
  });

  test("does not materialize a view or envelope work when selection is empty", () => {
    const empty = plan([]);
    expect(empty).toMatchObject({
      state: "not-required",
      primary_result_view: null,
      worksets: [],
      workset_set: { items: [] },
    });
  });
});

describe("post-author composer worksets and invocation", () => {
  test("adding composer B leaves composer A workset identity unchanged", () => {
    const onlyA = requirePending(plan(["examples"]));
    const withB = requirePending(plan(["examples", "reference"]));
    expect(onlyA.worksets[0]?.workset_digest).toBe(withB.worksets[0]?.workset_digest);
    expect(onlyA.workset_set.workset_set_digest).not.toBe(
      withB.workset_set.workset_set_digest,
    );
  });

  test("binds each request/result/receipt to one composer and the complete view", () => {
    const pending = requirePending(plan(["examples"]));
    const request = buildIndexerPostAuthorFragmentRequest({
      workset: pending.worksets[0]!,
      primary_result_view: pending.primary_result_view,
    });
    expect(request.primary_result_view.facts[0]?.value).toEqual({
      summary: "public control",
    });
    const validated = validateIndexerPostAuthorFragmentResult({
      request,
      result: runResult(request, [proposalFragment(request)]),
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(validated.receipt).toMatchObject({
      composer_ref: request.composer_ref,
      primary_result_view_digest: request.primary_result_view.view_digest,
      consumed_primary_result_view_digest: request.primary_result_view.view_digest,
    });
    expect(validated.fragments[0]?.payload).toMatchObject({
      protocol: "context.indexer.fragment.derived-artifact-proposal/v1",
    });
  });

  test("records a valid empty composer result instead of treating it as not run", () => {
    const pending = requirePending(plan(["examples"]));
    const request = buildIndexerPostAuthorFragmentRequest({
      workset: pending.worksets[0]!,
      primary_result_view: pending.primary_result_view,
    });
    const validated = validateIndexerPostAuthorFragmentResult({
      request,
      result: runResult(request, []),
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(validated.fragments).toEqual([]);
    expect(validated.receipt.fragment_digests).toEqual([]);
    expect(validated.receipt.result_digest).toBeDefined();
  });

  test("rejects missing/tampered views and composer impersonation", () => {
    const pending = requirePending(plan(["examples"]));
    const request = buildIndexerPostAuthorFragmentRequest({
      workset: pending.worksets[0]!,
      primary_result_view: pending.primary_result_view,
    });
    const tampered = structuredClone(request);
    tampered.primary_result_view.facts[0]!.value = { summary: "tampered" };
    expect(() => validateIndexerPostAuthorFragmentResult({
      request: tampered,
      result: runResult(request, []),
      validator_contract_digest: VALIDATOR_DIGEST,
    })).toThrow(/request digest|PrimaryResultView digest/);

    const impersonated = runResult(request, []);
    impersonated.composer_ref = `${request.target_layer_ref}#composer:reference`;
    expect(() => validateIndexerPostAuthorFragmentResult({
      request,
      result: impersonated,
      validator_contract_digest: VALIDATOR_DIGEST,
    })).toThrow(/result digest|composer request/);
  });
});

describe("ComposedIndexerResultEnvelope", () => {
  test("publishes only after every effective composer has a receipt", () => {
    const effective = effectiveSet(["examples", "reference"]);
    const pending = requirePending(plan(["examples", "reference"]));
    const invocations = pending.worksets.map((workset) => {
      const request = buildIndexerPostAuthorFragmentRequest({
        workset,
        primary_result_view: pending.primary_result_view,
      });
      return validateIndexerPostAuthorFragmentResult({
        request,
        result: runResult(
          request,
          workset.composer_ref.endsWith(":examples") ? [proposalFragment(request)] : [],
        ),
        validator_contract_digest: VALIDATOR_DIGEST,
      });
    });
    expect(() => composeIndexerPostAuthorEnvelope({
      workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: PRIMARY_RESULT_DIGEST,
      primary_result_view: pending.primary_result_view,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
      effective_composer_set: effective,
      invocations: invocations.slice(0, 1),
    })).toThrow(/one receipt per effective composer/);

    const envelope = composeIndexerPostAuthorEnvelope({
      workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: PRIMARY_RESULT_DIGEST,
      primary_result_view: pending.primary_result_view,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
      effective_composer_set: effective,
      invocations,
    });
    expect(envelope.composer_invocation_receipts).toHaveLength(2);
    expect(envelope.accepted_post_author_fragments).toHaveLength(1);
    expect(envelope.composition_fingerprint).toMatch(/^sha256:/);
  });

  test("primary content changes alter the view, workset, request, and proposal identity", () => {
    const effective = effectiveSet(["examples"]);
    const original = requirePending(plan(["examples"]));
    const changed = planIndexerPostAuthorComposition({
      effective_composer_set: effective,
      author_workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: `sha256:${"b".repeat(64)}`,
      primary_facts: facts("changed public control"),
      primary_artifacts: artifacts(),
      validator_contract_digest: VALIDATOR_DIGEST,
      current_profile_binding_digest: PROFILE_BINDING_DIGEST,
      allowed_target_refs: [NODE_REF],
    });
    const changedPending = requirePending(changed);
    const originalRequest = buildIndexerPostAuthorFragmentRequest({
      workset: original.worksets[0]!,
      primary_result_view: original.primary_result_view,
    });
    const changedRequest = buildIndexerPostAuthorFragmentRequest({
      workset: changedPending.worksets[0]!,
      primary_result_view: changedPending.primary_result_view,
    });
    expect(changedPending.primary_result_view.view_digest).not.toBe(
      original.primary_result_view.view_digest,
    );
    expect(changedRequest.request_digest).not.toBe(originalRequest.request_digest);
    expect(proposalFragment(changedRequest).fragment_digest).not.toBe(
      proposalFragment(originalRequest).fragment_digest,
    );
  });

  test("refuses an envelope for zero effective composer selection", () => {
    const empty = effectiveSet([]);
    const view = materializeIndexerPrimaryResultView({
      workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: PRIMARY_RESULT_DIGEST,
      facts: facts(),
      artifacts: artifacts(),
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(() => composeIndexerPostAuthorEnvelope({
      workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: PRIMARY_RESULT_DIGEST,
      primary_result_view: view,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
      effective_composer_set: empty,
      invocations: [],
    })).toThrow(/not-required/);
  });
});

describe("post-author runtime ledger and completion predicate", () => {
  test("publishes not-required for zero selection without a View or envelope", () => {
    const currentPlan = plan([]);
    const ledger = initializeIndexerPostAuthorRunLedger(currentPlan);
    const observed = observeIndexerPostAuthorState({
      plan: currentPlan,
      ledger,
      effective_composer_set: effectiveSet([]),
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
    });
    expect(observed.status).toMatchObject({
      total_count: 0,
      pending_count: 0,
      post_author_envelope: { state: "not-required", digest: null },
      outcome: "complete",
      can_reconcile: true,
    });
    expect(observed.expected_envelope).toBeNull();
    expect(() => observeIndexerPostAuthorState({
      plan: currentPlan,
      ledger,
      effective_composer_set: effectiveSet(["examples"]),
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
    })).toThrow(/effective composer set/);
    expect(() => observeIndexerPostAuthorState({
      plan: currentPlan,
      ledger,
      effective_composer_set: effectiveSet([]),
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
      current_envelope: {},
    })).toThrow(/must not publish an envelope/);
  });

  test("reuses A while B is pending and exposes only B as the next ref", () => {
    const currentPlan = plan(["examples", "reference"]);
    let ledger = initializeIndexerPostAuthorRunLedger(currentPlan);
    const composerA = currentPlan.worksets[0]!.composer_ref;
    const composerB = currentPlan.worksets[1]!.composer_ref;
    ledger = acceptComposer({
      currentPlan,
      ledger,
      composerRef: composerA,
      withProposal: true,
    });
    const observed = observeIndexerPostAuthorState({
      plan: currentPlan,
      ledger,
      effective_composer_set: effectiveSet(["examples", "reference"]),
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
    });
    expect(observed.status).toMatchObject({
      total_count: 2,
      accepted_count: 1,
      pending_count: 1,
      failed_count: 0,
      stale_count: 0,
      outcome: "index-post-author-workset-pending",
      can_reconcile: false,
    });
    expect(observed.status.next_refs).toEqual([{
      composer_ref: composerB,
      workset_digest: currentPlan.worksets[1]!.workset_digest,
      state: "pending",
    }]);
    expect(observed.ledger.entries.find((entry) =>
      entry.composer_ref === composerA
    )?.state).toBe("accepted");
  });

  test("keeps an accepted composer when another fails and reports one failed outcome", () => {
    const currentPlan = plan(["examples", "reference"]);
    let ledger = initializeIndexerPostAuthorRunLedger(currentPlan);
    const composerA = currentPlan.worksets[0]!.composer_ref;
    const composerB = currentPlan.worksets[1]!.composer_ref;
    ledger = acceptComposer({ currentPlan, ledger, composerRef: composerA });
    const startedB = startIndexerPostAuthorRun({
      plan: currentPlan,
      ledger,
      composer_ref: composerB,
    });
    ledger = failIndexerPostAuthorRun({
      plan: currentPlan,
      ledger: startedB.ledger,
      composer_ref: composerB,
      reason_code: "composer-input-missing",
      dependency_digests: [PRIMARY_RESULT_DIGEST],
    });
    const observed = observeIndexerPostAuthorState({
      plan: currentPlan,
      ledger,
      effective_composer_set: effectiveSet(["examples", "reference"]),
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
    });
    expect(observed.status).toMatchObject({
      accepted_count: 1,
      failed_count: 1,
      outcome: "index-post-author-workset-failed",
      can_reconcile: false,
    });
    expect(observed.status.next_refs).toEqual([{
      composer_ref: composerB,
      workset_digest: currentPlan.worksets[1]!.workset_digest,
      state: "failed",
    }]);
  });

  test("returns an interrupted running item to pending during startup recovery", () => {
    const currentPlan = plan(["examples"]);
    const initialized = initializeIndexerPostAuthorRunLedger(currentPlan);
    const started = startIndexerPostAuthorRun({
      plan: currentPlan,
      ledger: initialized,
      composer_ref: currentPlan.worksets[0]!.composer_ref,
    });
    expect(started.ledger.entries[0]?.state).toBe("running");
    const recovered = recoverIndexerPostAuthorRunLedger({
      plan: currentPlan,
      previous_ledger: started.ledger,
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(recovered.entries[0]?.state).toBe("pending");
  });

  test("marks changed composer worksets stale without discarding current accepted peers", () => {
    const originalPlan = plan(["examples", "reference"]);
    let ledger = initializeIndexerPostAuthorRunLedger(originalPlan);
    for (const workset of originalPlan.worksets) {
      ledger = acceptComposer({
        currentPlan: originalPlan,
        ledger,
        composerRef: workset.composer_ref,
      });
    }
    const changedSet = resolveEffectiveIndexerComposers({
      selections: [{
        id: "examples",
        provider: "sample-extension",
        composer_selection_entry_digest: SELECTION_A_DIGEST,
      }, {
        id: "reference",
        provider: "sample-extension",
        composer_selection_entry_digest: `sha256:${"c".repeat(64)}`,
      }],
      manifest_layers: [{
        provider: "sample-extension",
        layer_ref: "provider:sample-extension#layer:supporting",
        layer_integrity: LAYER_INTEGRITY,
        bundle_digest: BUNDLE_DIGEST,
        composers: [{ id: "examples", supported_profiles: ["component-library"] }, {
          id: "reference",
          supported_profiles: ["component-library"],
        }],
      }],
      current_profiles: ["component-library"],
    });
    const changedPlan = planIndexerPostAuthorComposition({
      effective_composer_set: changedSet,
      author_workset_digest: AUTHOR_WORKSET_DIGEST,
      primary_result_digest: PRIMARY_RESULT_DIGEST,
      primary_facts: facts(),
      primary_artifacts: artifacts(),
      validator_contract_digest: VALIDATOR_DIGEST,
      current_profile_binding_digest: PROFILE_BINDING_DIGEST,
      allowed_target_refs: [NODE_REF],
    });
    const observed = observeIndexerPostAuthorState({
      plan: changedPlan,
      ledger,
      effective_composer_set: changedSet,
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
    });
    expect(observed.status).toMatchObject({
      accepted_count: 1,
      stale_count: 1,
      outcome: "index-post-author-workset-stale",
      can_reconcile: false,
    });
    expect(observed.status.next_refs[0]?.composer_ref).toEndWith(":reference");
  });

  test("requires a matching current envelope after all composers are accepted", () => {
    const currentPlan = plan(["examples", "reference"]);
    let ledger = initializeIndexerPostAuthorRunLedger(currentPlan);
    for (const workset of currentPlan.worksets) {
      ledger = acceptComposer({
        currentPlan,
        ledger,
        composerRef: workset.composer_ref,
        withProposal: workset.composer_ref.endsWith(":examples"),
      });
    }
    const missingEnvelope = observeIndexerPostAuthorState({
      plan: currentPlan,
      ledger,
      effective_composer_set: effectiveSet(["examples", "reference"]),
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
    });
    expect(missingEnvelope.status).toMatchObject({
      accepted_count: 2,
      pending_count: 0,
      outcome: "index-post-author-envelope-stale",
      post_author_envelope: { state: "stale", digest: null },
      can_reconcile: false,
    });
    expect(missingEnvelope.expected_envelope).not.toBeNull();

    const current = observeIndexerPostAuthorState({
      plan: currentPlan,
      ledger: missingEnvelope.ledger,
      effective_composer_set: effectiveSet(["examples", "reference"]),
      validator_contract_digest: VALIDATOR_DIGEST,
      accepted_input_view_digest: INPUT_VIEW_DIGEST,
      current_envelope: missingEnvelope.expected_envelope!,
    });
    expect(current.status).toMatchObject({
      outcome: "complete",
      post_author_envelope: {
        state: "current",
        digest: missingEnvelope.expected_envelope!.composition_fingerprint,
      },
      can_reconcile: true,
    });
  });
});
