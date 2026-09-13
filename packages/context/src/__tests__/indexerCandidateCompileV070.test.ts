import { describe, expect, test } from "bun:test";
import {
  buildIndexerApprovedLayoutProjection,
  buildIndexerCandidateCompile,
  materializeIndexerStructuredContent,
  buildIndexerLayoutChangeConfirmation,
  buildIndexerLayoutProposalSet,
  buildIndexerLayoutTransition,
  buildIndexerSharedArtifactFingerprint,
  indexerProtocolDigest,
  validateIndexerCandidateCompile,
} from "../index.js";
import {
  candidateCompileFixture,
  candidateCompileMultiSectionFixture,
  candidateCompilePostAuthorFixture,
  candidateCompileTemplateFixture,
} from "./indexerCandidateCompileV070.fixture.js";

function compile(fixture: ReturnType<typeof candidateCompileFixture>) {
  return buildIndexerCandidateCompile({
    layout_proposal_set: fixture.layoutSet,
    layout_transition: fixture.transition,
    accepted_results: [fixture.accepted],
    profile_contract: fixture.profiles,
    operator_contract: fixture.operators,

  });
}

describe("explicit IndexerResult Candidate compile", () => {
  test("keeps each writing block's regions and stable identity rather than capping a chapter", () => {
    const sample = candidateCompileFixture(result => {
      const article = result.artifacts[0]!;
      if (article.representation !== "sections") throw new Error("Expected structured fixture");
      const section = article.sections[0]!;
      const original = section.blocks[0]!;
      section.blocks = ["first", "second"].map((block_id, offset) => ({
        ...original, block_id, markdown: `${block_id} paragraph`,
        references: [1, 2, 3].map(line => ({ source_ref: result.source_ref,
          locator: { path: "src/toggle.ts", start_line: offset * 3 + line, end_line: offset * 3 + line },
          content_digest: indexerProtocolDigest({ line, offset }) })),
      }));
    });
    const file = compile(sample).files[0]!;
    expect(file.sections.map(section => section.section_key)).toEqual(["summary", "summary--second"]);
    expect(file.sections.map(section => section.references.length)).toEqual([3, 3]);
    expect(file.markdown).toBe("first paragraph\n\nsecond paragraph");
  });

  test("compiles only an accepted author Result and preserves its complete authority binding", () => {
    const fixture = candidateCompileFixture();
    const result = compile(fixture);
    expect(result).toMatchObject({
      protocol: "context.indexer.candidate-compile/v1",
      layout_proposal_set_digest: fixture.layoutSet.set_digest,
      layout_transition_digest: fixture.transition.transition_digest,
      result_bindings: [{
        workset_digest: fixture.result.author_workset_digest,
        acceptance_digest: fixture.accepted.accepted_record.acceptance_digest,
        artifact_result_digest: fixture.result.output_digest,
        run_envelope_digest: fixture.accepted.run_envelope.envelope_digest,
        shared_artifact_fingerprint:
          fixture.accepted.run_envelope.shared_artifact_fingerprint,
        indexer_id: fixture.result.indexer_id,
        provider_integrity: fixture.result.provider_integrity,
        provider_bundle_digest: fixture.result.provider_bundle_digest,
        config_fingerprint: fixture.result.config_fingerprint,
      }],
      files: [{
        output_path: fixture.proposal.artifacts[0]!.output_path,
        acceptance_digest: fixture.accepted.accepted_record.acceptance_digest,
        artifact_result_digest: fixture.result.output_digest,
        shared_artifact_fingerprint_digest:
          fixture.accepted.run_envelope.shared_artifact_fingerprint
            .fingerprint_digest,
        markdown: "# Toggle\n\nAnonymous capability evidence.",
      }],
      physical_artifact_audit: { state: "passed" },
    });
    expect(validateIndexerCandidateCompile({
      compile: result,
      layout_proposal_set: fixture.layoutSet,
      layout_transition: fixture.transition,
      accepted_results: [fixture.accepted],
      profile_contract: fixture.profiles,
      operator_contract: fixture.operators,

    })).toEqual(result);
  });

  test("uses the exact rendered template Artifact from the same Result", () => {
    const fixture = candidateCompileTemplateFixture();
    const result = buildIndexerCandidateCompile({
      layout_proposal_set: fixture.layoutSet,
      layout_transition: fixture.transition,
      accepted_results: [fixture.accepted],
      profile_contract: fixture.profiles,
      operator_contract: fixture.operators,

    });
    expect(result.files[0]!.markdown).toBe("# Toggle template\n\nRendered evidence.");

    const missingRendered = { ...fixture.accepted, rendered_artifacts: [] };
    expect(() => buildIndexerCandidateCompile({
      layout_proposal_set: fixture.layoutSet,
      layout_transition: fixture.transition,
      accepted_results: [missingRendered],
      profile_contract: fixture.profiles,
      operator_contract: fixture.operators,

    })).toThrow(/must be rendered before layout/);
  });

  test("compiles a current post-author derived Artifact without creating a second Result", () => {
    const fixture = candidateCompilePostAuthorFixture();
    const result = compile(fixture);
    expect(result.result_bindings).toHaveLength(1);
    expect(result.result_bindings[0]).toMatchObject({
      artifact_result_digest: fixture.result.output_digest,
      post_author_composition_fingerprint: fixture.envelope.composition_fingerprint,
    });
    expect(result.files.map((file) => ({
      artifact_kind: file.artifact_kind,
      output_path: file.output_path,
    }))).toEqual([{
      artifact_kind: "examples",
      output_path: "knowledge/codeindex/anonymous-revision/component-toggle-examples.md",
    }, {
      artifact_kind: "overview",
      output_path: "knowledge/codeindex/anonymous-revision/component-toggle.md",
    }]);
    expect(result.files[0]!.markdown).toContain("Use the public Toggle capability.");

    const withoutEnvelope = { ...fixture.accepted, post_author_envelope: null };
    expect(() => buildIndexerCandidateCompile({
      layout_proposal_set: fixture.layoutSet,
      layout_transition: fixture.transition,
      accepted_results: [withoutEnvelope],
      profile_contract: fixture.profiles,
      operator_contract: fixture.operators,

    })).toThrow(/stale|forged/);
  });

  test("keeps Section refs in the same reader order as compiled Sections", () => {
    const fixture = candidateCompileMultiSectionFixture();
    const result = compile(fixture);
    expect(result.files[0]!.section_refs).toEqual(
      result.files[0]!.sections.map((section) => section.section_ref),
    );
    expect(result.files[0]!.markdown).toBe(
      "# Toggle\n\nAnonymous capability evidence.\n\n" +
        "## Dependency handoff\n\nAnonymous dependency evidence.",
    );
  });

  test("rejects missing, forged, stale, or layout-unbound Results", () => {
    const fixture = candidateCompileFixture();
    const input = {
      layout_proposal_set: fixture.layoutSet,
      layout_transition: fixture.transition,
      profile_contract: fixture.profiles,
      operator_contract: fixture.operators,

    };
    expect(() => buildIndexerCandidateCompile({
      ...input,
      accepted_results: [],
    })).toThrow(/at least one explicit accepted IndexerResult/);

    const forged = structuredClone(fixture.accepted);
    forged.accepted_record.acceptance_digest = fixture.result.output_digest;
    expect(() => buildIndexerCandidateCompile({
      ...input,
      accepted_results: [forged],
    })).toThrow(/accepted author record/);

    const stale = structuredClone(fixture.accepted);
    stale.run_result.result.result.output_digest = fixture.result.input_digest;
    expect(() => buildIndexerCandidateCompile({
      ...input,
      accepted_results: [stale],
    })).toThrow(/current explicit ArtifactResult digest/);

    const forgedEnvelope = structuredClone(fixture.accepted);
    forgedEnvelope.run_envelope.provider_integrity = fixture.result.input_digest;
    const { envelope_digest: _envelopeDigest, ...envelopePayload } =
      forgedEnvelope.run_envelope;
    void _envelopeDigest;
    forgedEnvelope.run_envelope.envelope_digest = indexerProtocolDigest(envelopePayload);
    forgedEnvelope.accepted_record.run_envelope_digest =
      forgedEnvelope.run_envelope.envelope_digest;
    const { acceptance_digest: _acceptanceDigest, ...acceptancePayload } =
      forgedEnvelope.accepted_record;
    void _acceptanceDigest;
    forgedEnvelope.accepted_record.acceptance_digest =
      indexerProtocolDigest(acceptancePayload);
    expect(() => buildIndexerCandidateCompile({
      ...input,
      accepted_results: [forgedEnvelope],
    })).toThrow(/run envelope does not bind its ArtifactResult/);

    const staleFingerprintProposal = structuredClone(fixture.proposal);
    staleFingerprintProposal.shared_artifact_fingerprint =
      buildIndexerSharedArtifactFingerprint({
        indexer_id: fixture.result.indexer_id,
        program_digest: null,
        instructions_digest: fixture.result.input_digest,
        template_set_digest: fixture.result.provider_integrity,
      });
    for (const artifact of staleFingerprintProposal.artifacts) {
      artifact.shared_artifact_fingerprint_digest =
        staleFingerprintProposal.shared_artifact_fingerprint.fingerprint_digest;
    }
    const { proposal_digest: _proposalDigest, ...proposalPayload } =
      staleFingerprintProposal;
    void _proposalDigest;
    staleFingerprintProposal.proposal_digest = indexerProtocolDigest(proposalPayload);
    const staleFingerprintSet = buildIndexerLayoutProposalSet([
      staleFingerprintProposal,
    ]);
    const staleFingerprintTransition = buildIndexerLayoutTransition({
      layout_proposal_set: staleFingerprintSet,
      base_projections: [],
    });
    expect(() => buildIndexerCandidateCompile({
      ...input,
      layout_proposal_set: staleFingerprintSet,
      layout_transition: staleFingerprintTransition,
      accepted_results: [fixture.accepted],
    })).toThrow(/layout fingerprint is stale for its run envelope/);

    expect(() => buildIndexerCandidateCompile({
      ...input,
      accepted_results: [fixture.accepted, fixture.accepted],
    })).toThrow(/one accepted IndexerResult per layout proposal/);
  });

  test("requires the exact nondelegable confirmation before compiling a changed layout", () => {
    const base = candidateCompileFixture();
    const target = candidateCompileFixture();
    const previous = buildIndexerApprovedLayoutProjection(base.proposal);
    previous.artifacts[0]!.collection = "architecture";
    previous.artifacts[0]!.output_path = previous.artifacts[0]!.output_path
      .replace("knowledge/codeindex/", "knowledge/architecture/");
    const { projection_digest: _digest, ...previousPayload } = previous;
    void _digest;
    previous.projection_digest = indexerProtocolDigest(previousPayload);
    const transition = buildIndexerLayoutTransition({
      layout_proposal_set: target.layoutSet,
      base_projections: [previous],
    });
    expect(transition.requires_confirmation).toBe(true);
    expect(() => buildIndexerCandidateCompile({
      layout_proposal_set: target.layoutSet,
      layout_transition: transition,
      accepted_results: [target.accepted],
      profile_contract: target.profiles,
      operator_contract: target.operators,

    })).toThrow(/requires the exact layout change confirmation/);

    const confirmation = buildIndexerLayoutChangeConfirmation({
      report: transition.change_reports[0]!,
      actor_ref: "user:layout-reviewer",
    });
    expect(buildIndexerCandidateCompile({
      layout_proposal_set: target.layoutSet,
      layout_transition: transition,
      layout_change_confirmations: [confirmation],
      accepted_results: [target.accepted],
      profile_contract: target.profiles,
      operator_contract: target.operators,

    }).files).toHaveLength(1);
  });
});

test("command render memo preserves authority checks and refreshes link projection without mutating cached sections", () => {
  const fixture = candidateCompileFixture();
  const render_cache = new Map<string, ReturnType<typeof materializeIndexerStructuredContent>>();
  const input = { layout_proposal_set: fixture.layoutSet, layout_transition: fixture.transition,
    accepted_results: [fixture.accepted], profile_contract: fixture.profiles,
    operator_contract: fixture.operators, render_cache };
  const first = buildIndexerCandidateCompile(input);
  expect(render_cache.size).toBe(0);
  const originalCache = structuredClone([...render_cache]);
  const projected = buildIndexerCandidateCompile({ ...input, markdown_projection: ({ markdown }) => markdown + "\nChanged navigation." });
  expect(projected.files[0]!.markdown).toContain("Changed navigation.");
  expect([...render_cache]).toEqual(originalCache);
  expect(buildIndexerCandidateCompile(input)).toEqual(first);
  const broken = structuredClone(fixture.accepted);
  broken.accepted_record.acceptance_digest = `sha256:${"0".repeat(64)}`;
  expect(() => buildIndexerCandidateCompile({ ...input, accepted_results: [broken] })).toThrow();
});
