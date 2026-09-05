import { describe, expect, test } from "bun:test";
import {
  indexerEvidenceAdapterFactRef,
  indexerEvidenceAdapterFileRef,
  indexerProtocolDigest,
  type IndexerParserFact,
  type IndexerParserFactView,
} from "@c4a/context";
import { selectProjectIndexerAuthorRelationFacts } from
  "../project/indexerAuthorDependencyView.js";

const SOURCE_REF = "repo:sample";

function parserFact(input: {
  path: string;
  qualified_item_path: string;
  kind: string;
  payload: IndexerParserFact["payload"];
  denominator?: IndexerParserFact["denominator"];
}): IndexerParserFact {
  const locator = {
    source_ref: SOURCE_REF,
    module_ref: null,
    normalized_path: input.path,
    qualified_item_path: input.qualified_item_path,
    signature_digest: indexerProtocolDigest(input.payload),
  };
  return {
    fact_ref: indexerEvidenceAdapterFactRef({ ...locator, kind: input.kind }),
    kind: input.kind,
    locator,
    payload: input.payload,
    payload_digest: indexerProtocolDigest(input.payload),
    denominator: input.denominator ?? "none",
  };
}

function parserFile(input: {
  path: string;
  facts: IndexerParserFact[];
}): IndexerParserFactView["files"][number] {
  return {
    file_ref: indexerEvidenceAdapterFileRef({
      source_ref: SOURCE_REF,
      module_ref: null,
      normalized_path: input.path,
    }),
    source_ref: SOURCE_REF,
    module_ref: null,
    normalized_path: input.path,
    disposition: "analyzed",
    facts: input.facts,
  };
}

describe("project Author relation selection", () => {
  test("projects relations by source ownership without leaking another group", () => {
    const path = "src/app.ts";
    const alpha = parserFact({
      path,
      qualified_item_path: "symbol:function:Alpha@1",
      kind: "code-symbol",
      payload: { name: "Alpha", line: 1, endLine: 10 },
      denominator: "symbol",
    });
    const beta = parserFact({
      path,
      qualified_item_path: "symbol:function:Beta@12",
      kind: "code-symbol",
      payload: { name: "Beta", line: 12, endLine: 20 },
      denominator: "symbol",
    });
    const fileImport = parserFact({
      path,
      qualified_item_path: "relation:imports:src/app.ts->dep@1",
      kind: "code-relation",
      payload: { from: path, to: "dep", type: "imports", line: 1 },
    });
    const alphaCall = parserFact({
      path,
      qualified_item_path: "relation:calls:Alpha->useAlpha@5",
      kind: "code-relation",
      payload: { from: "Alpha", to: "useAlpha", type: "calls", line: 5 },
    });
    const betaCall = parserFact({
      path,
      qualified_item_path: "relation:calls:Beta->useBeta@15",
      kind: "code-relation",
      payload: { from: "Beta", to: "useBeta", type: "calls", line: 15 },
    });
    const unresolvedCall = parserFact({
      path,
      qualified_item_path: "relation:calls:Nested->hidden@7",
      kind: "code-relation",
      payload: { from: "Nested", to: "hidden", type: "calls", line: 7 },
    });
    const file = parserFile({
      path,
      facts: [alpha, beta, fileImport, alphaCall, betaCall, unresolvedCall],
    });

    expect(selectProjectIndexerAuthorRelationFacts({
      files: [file],
      owned_member_ids: new Set([file.file_ref, alpha.fact_ref]),
    }).map((fact) => fact.fact_ref).sort()).toEqual([
      alphaCall.fact_ref,
      fileImport.fact_ref,
    ].sort());
    expect(selectProjectIndexerAuthorRelationFacts({
      files: [file],
      owned_member_ids: new Set([beta.fact_ref]),
    }).map((fact) => fact.fact_ref)).toEqual([betaCall.fact_ref]);
  });

  test("rejects an ambiguous same-name relation split across groups", () => {
    const path = "src/overloads.ts";
    const first = parserFact({
      path,
      qualified_item_path: "symbol:function:run@1",
      kind: "code-symbol",
      payload: { name: "run", line: 1, endLine: 4 },
      denominator: "symbol",
    });
    const second = parserFact({
      path,
      qualified_item_path: "symbol:function:run@6",
      kind: "code-symbol",
      payload: { name: "run", line: 6, endLine: 9 },
      denominator: "symbol",
    });
    const ambiguous = parserFact({
      path,
      qualified_item_path: "relation:calls:run->target",
      kind: "code-relation",
      payload: { from: "run", to: "target", type: "calls" },
    });
    const file = parserFile({ path, facts: [first, second, ambiguous] });

    expect(selectProjectIndexerAuthorRelationFacts({
      files: [file],
      owned_member_ids: new Set([first.fact_ref]),
    })).toEqual([]);
    expect(selectProjectIndexerAuthorRelationFacts({
      files: [file],
      owned_member_ids: new Set([first.fact_ref, second.fact_ref]),
    }).map((fact) => fact.fact_ref)).toEqual([ambiguous.fact_ref]);
  });
});
