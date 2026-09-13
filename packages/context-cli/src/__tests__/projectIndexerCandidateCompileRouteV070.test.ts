import { describe,expect,test } from "bun:test";
import { buildProjectIndexerCandidateCompileFromRecords } from "../project/indexerCandidateCompileActions.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

describe("Indexer Candidate compile Route", () => {

  test("rejects a caller-supplied Result ref that is absent from the accepted store", () => {
    expect(() => buildProjectIndexerCandidateCompileFromRecords({
      value: {
        protocol: "context.indexer.candidate-compile-input/v1",
        accepted_result_refs: [{
          workset_digest: digest("1"),
          execution_request_digest: digest("2"),
          acceptance_digest: digest("3"),
          artifact_result_digest: digest("4"),
        }],
        layout_proposal_set: {},
        layout_transition: {},
        layout_change_confirmations: [],
        rendered_artifacts: [],
      },
      records: [],
      operator_contract: {},
      profile_contract: {},
    })).toThrow(/exact current accepted Result set/);
  });

});
