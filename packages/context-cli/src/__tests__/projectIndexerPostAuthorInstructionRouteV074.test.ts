import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildIndexerPostAuthorFragmentRequest,
  canonicalIndexerNodeRef,
  indexerProtocolDigest,
  planIndexerPostAuthorComposition,
  resolveEffectiveIndexerComposers,
} from "@c4a/context";
import { buildIndexerPostAuthorAgentStepRoute } from "../project/indexerAgentStepRoute.js";
import type { IndexerInstructionMaterializationRequest } from "../project/indexerInstructionMaterialization.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const SUBJECT_KEY = {
  protocol: "context.subject-key/v1" as const,
  namespace: "sample-package",
  kind: "component",
  local_key: "public-button",
};
const NODE_REF = canonicalIndexerNodeRef(SUBJECT_KEY);

function postAuthorRequest() {
  const composers = resolveEffectiveIndexerComposers({
    selections: [{
      id: "public-contract",
      provider: "sample-extension",
      composer_selection_entry_digest: digest("1"),
    }],
    manifest_layers: [{
      provider: "sample-extension",
      layer_ref: "provider:sample-extension#layer:supporting",
      layer_integrity: digest("2"),
      bundle_digest: digest("3"),
      composers: [{
        id: "public-contract",
        supported_profiles: ["component-library"],
      }],
    }],
    current_profiles: ["component-library"],
  });
  const plan = planIndexerPostAuthorComposition({
    effective_composer_set: composers,
    author_workset_digest: digest("4"),
    primary_result_digest: digest("5"),
    primary_facts: [{
      fact_ref: "fact:component-summary",
      subject_key: SUBJECT_KEY,
      fact_kind: "component-summary",
      value: { summary: "public control" },
      evidence_refs: [{
        ref: "evidence:component-source",
        kind: "code",
        source_digest: digest("6"),
      }],
    }],
    primary_artifacts: [{
      artifact_ref: "artifact:component-overview",
      subject_key: SUBJECT_KEY,
      artifact_kind: "overview",
      artifact_policy_variant: "standard",
      variables: { title: "Public button" },
      evidence_refs: [{
        ref: "evidence:component-source",
        kind: "code",
        source_digest: digest("6"),
      }],
    }],
    validator_contract_digest: digest("7"),
    current_profile_binding_digest: digest("8"),
    allowed_target_refs: [NODE_REF],
  });
  if (plan.state !== "pending") throw new Error("expected pending post-author plan");
  return {
    request: buildIndexerPostAuthorFragmentRequest({
      workset: plan.worksets[0]!,
      primary_result_view: plan.primary_result_view,
    }),
    primaryResultView: plan.primary_result_view,
  };
}

function instructionRequest(
  worksetDigest: string,
): IndexerInstructionMaterializationRequest {
  const input = {
    protocol: "context.indexer.materialize-request/v1" as const,
    handler: "context.materialize-indexer-instructions/v1" as const,
    resource_id: "resolved-indexer-instructions" as const,
    indexer_id: "sample-indexer",
    provider_id: "sample-extension",
    provider_fingerprint: digest("9"),
    provider_integrity: digest("2"),
    manifest_digest: digest("a"),
    requirement_set_digest: digest("b"),
    workset_ref: `post-author-workset:${worksetDigest}`,
    workset_digest: worksetDigest,
    profile: "component-library",
    composer_id: "public-contract",
    instruction_set_digest: digest("c"),
    customization_fingerprint: digest("d"),
  };
  return {
    ...input,
    request_digest: indexerProtocolDigest(input),
  };
}

describe("project Indexer post-author instruction Route", () => {
  test("gives the selected composer instruction and the same PrimaryResultView to the Agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-indexer-post-author-route-"));
    const postAuthor = postAuthorRequest();
    const instructions = instructionRequest(postAuthor.request.workset.workset_digest);
    const route = await buildIndexerPostAuthorAgentStepRoute({
      fragment_request: postAuthor.request,
      instruction_request: instructions,
      workspaceRoot: root,
    });

    expect(route.route.action).toMatchObject({
      id: "run-indexer-post-author-composer",
      runner: "agent",
      input: postAuthor.request,
    });
    expect(route.step_input.primary_result_view).toEqual(postAuthor.primaryResultView);
    expect(route.route.resources.required.find((resource) =>
      resource.id === "resolved-indexer-instructions"
    )).toMatchObject({
      read_state: "read-required",
      materialize: {
        handler: "context.materialize-indexer-instructions/v1",
        input: { value: instructions },
        output_schema: "context.indexer.materialized-resource/v1",
      },
    });
    expect(route.instruction_location.materialize.input.value).toEqual(instructions);
    expect(JSON.stringify(route.route)).not.toContain("__runtime__");
  });
});
