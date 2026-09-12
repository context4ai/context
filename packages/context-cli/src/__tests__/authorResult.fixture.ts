import { indexerAuthorSemanticInputSchema, validateIndexerArtifactPolicyEligibilityReport } from "@c4a/context";
import type { MainRunSpec } from "../project/indexerMainRunStoreRecords.js";
import { prepareProjectIndexerWorksetViewMaterialization } from "../project/indexerWorksetViewMaterialization.js";
import { buildIndexerAuthorRunResultFromSemantic } from "../project/indexerSemanticAuthorResult.js";
import { fixtureArticleReferences } from "./articleReferences.fixture.js";

/** Exercise the public semantic submission instead of fabricating its internal
 * acceptance envelope, parser facts or retired evidence ledgers. */
export async function authorResultFixture(projectRoot: string, spec: MainRunSpec) {
  const workset = spec.request.workset;
  if (workset.stage !== "author") throw new Error("Expected Author fixture");
  const view = (await prepareProjectIndexerWorksetViewMaterialization({ projectRoot, run_spec: spec })).projection.view;
  const validation = spec.validation as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"];
  const variant = validateIndexerArtifactPolicyEligibilityReport(validation.artifact_policy_eligibility)
    .eligible_variants.find(item => workset.allowed_artifact_policy_variants.includes(item.id));
  const intent = validation.allowed_artifact_intents.find(item => item.artifact_kind === "content");
  if (!variant || !intent) throw new Error("Expected a current content intent and policy");
  const semantic = indexerAuthorSemanticInputSchema.parse({
    stage: "author", group_key: workset.group_key, outcome: "publish", policy: variant.id,
    artifact_intent: [intent.source_role, intent.document_kind, intent.reader_goal, intent.artifact_kind].join("/"),
    title: workset.group_key, summary: "Stable group knowledge.",
    sections: [{ key: "overview", heading: "Overview", markdown: "Stable group knowledge.",
      references: await fixtureArticleReferences(projectRoot, view),
      answers: validation.allowed_question_targets.map(target => target.question_target_key) }],
    member_dispositions: validation.canonical_inventory_members.map(member => ({
      item: member.member_id, state: "covered", section: "overview",
    })),
  });
  const result = buildIndexerAuthorRunResultFromSemantic({ projectRoot, request: spec.request, view, validation, semantic });
  if (result.result.result.protocol !== "context.indexer.artifact-result/v1") throw new Error("Expected article result");
  return { result, artifact: result.result.result };
}
