import { describe, expect, test } from "bun:test";
import {
  indexerProtocolDigest,
  materializeIndexerEffectiveArtifactSet,
  materializeIndexerPrimaryResultViewFromArtifactResult,
} from "../index.js";
import {
  candidateCompileFixture,
  candidateCompilePostAuthorFixture,
  candidateCompileTemplateFixture,
} from "./indexerCandidateCompileV070.fixture.js";

const VALIDATOR_DIGEST = `sha256:${"3".repeat(64)}`;

describe("post-author Artifact projection", () => {
  test("mechanically projects structured and template Artifacts from the accepted Result", () => {
    const structured = candidateCompileFixture();
    const structuredView = materializeIndexerPrimaryResultViewFromArtifactResult({
      artifact_result: structured.result,
      primary_result_digest: indexerProtocolDigest(structured.result),
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(structuredView).toMatchObject({
      workset_digest: structured.result.author_workset_digest,
      artifacts: [{
        artifact_kind: "overview",
        variables: { representation: "sections" },
        evidence_refs: [{
          ref: structured.result.evidence_bindings[0]!.evidence_ref,
          source_digest: structured.result.evidence_bindings[0]!.content_digest,
        }],
      }],
    });

    const templated = candidateCompileTemplateFixture();
    const templateView = materializeIndexerPrimaryResultViewFromArtifactResult({
      artifact_result: templated.result,
      primary_result_digest: indexerProtocolDigest(templated.result),
      validator_contract_digest: VALIDATOR_DIGEST,
    });
    expect(templateView.artifacts[0]?.variables).toMatchObject({
      representation: "template",
      template_id: "component-guide",
      variables: {},
    });

    const tampered = structuredClone(structured.result);
    tampered.artifacts[0]!.artifact_id = "forged";
    expect(() => materializeIndexerPrimaryResultViewFromArtifactResult({
      artifact_result: tampered,
      primary_result_digest: indexerProtocolDigest(structured.result),
      validator_contract_digest: VALIDATOR_DIGEST,
    })).toThrow(/intact accepted ArtifactResult/);
  });

  test("materializes accepted derived Artifacts without rewriting the primary Result", () => {
    const fixture = candidateCompilePostAuthorFixture();
    const effective = materializeIndexerEffectiveArtifactSet({
      artifact_result: fixture.result,
      post_author_envelope: fixture.envelope,
    });
    expect(fixture.result.artifacts.map((artifact) => artifact.artifact_id)).toEqual([
      "toggle-overview",
    ]);
    expect(effective.artifacts.map((artifact) => artifact.artifact_id)).toEqual([
      "toggle-overview",
      "toggle-examples",
    ]);
    expect(effective.artifact_bundle?.artifacts.find((artifact) =>
      artifact.artifact_id === "toggle-examples"
    )).toMatchObject({
      artifact_id: "toggle-examples",
      purpose: "discretionary",
    });
    expect(effective.composition_fingerprint).toBe(
      fixture.envelope.composition_fingerprint,
    );
  });
});
