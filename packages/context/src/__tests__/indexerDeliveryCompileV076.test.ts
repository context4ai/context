import { expect, test } from "bun:test";
import { buildIndexerCandidateCompile, buildIndexerLayoutProposalSet,
  buildIndexerLayoutTransition, resolveIndexerLayout, validateIndexerCandidateCompile } from "../index.js";
import { candidateCompilePostAuthorFixture } from "./indexerCandidateCompileV070.fixture.js";

test("one accepted Result and its Composer pages compile in separate batches with the same final paths and content", () => {
  const fixture = candidateCompilePostAuthorFixture();
  const compile = (ids?: string[]) => {
    const proposal = resolveIndexerLayout({ artifact_result: fixture.result,
      post_author_envelope: fixture.envelope, profile: "component-library",
      profile_contract: fixture.profiles, operator_contract: fixture.operators,
      subject_key_schema_set: fixture.subjectKeySchemaSet,
      shared_artifact_fingerprint: fixture.accepted.run_envelope.shared_artifact_fingerprint,
      ...(ids === undefined ? {} : { delivery_artifact_ids: ids }),
    });
    const layout = buildIndexerLayoutProposalSet([proposal]);
    const input = { layout_proposal_set: layout,
      layout_transition: buildIndexerLayoutTransition({ layout_proposal_set: layout, base_projections: [] }),
      accepted_results: [fixture.accepted], profile_contract: fixture.profiles,
      operator_contract: fixture.operators, subject_key_schema_set: fixture.subjectKeySchemaSet };
    const result = buildIndexerCandidateCompile(input);
    expect(validateIndexerCandidateCompile({ ...input, compile: result })).toEqual(result);
    return result.files;
  };
  const full = compile();
  expect(full).toHaveLength(2);
  const batches = fixture.proposal.artifacts.flatMap((artifact) => compile([artifact.artifact_id]));
  const pages = (files: typeof full) => files.map((file) => ({ path: file.output_path, markdown: file.markdown }))
    .sort((a, b) => a.path.localeCompare(b.path));
  expect(pages(batches)).toEqual(pages(full));
  expect(() => compile(["unaccepted-page"])).toThrow();
});
