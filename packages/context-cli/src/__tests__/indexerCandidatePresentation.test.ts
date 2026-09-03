import { describe, expect, test } from "bun:test";
import {
  indexerCandidateSummary,
  indexerCandidateTitle,
} from "../project/indexerCandidateCompileActions.js";

describe("Indexer Candidate presentation", () => {
  test("prefers a document heading for the review title", () => {
    expect(indexerCandidateTitle(
      "# Account lifecycle\n\nExplains the stable account boundary.",
      "knowledge/codeindex/service/domain-account-content.md",
      "content",
    )).toBe("Account lifecycle");
  });

  test("derives a readable title from the semantic output path", () => {
    expect(indexerCandidateTitle(
      "Explains the stable account boundary.",
      "knowledge/codeindex/service/domain-account-content.md",
      "content",
    )).toBe("Domain account");
  });

  test("uses the first reader paragraph instead of internal Artifact metadata", () => {
    expect(indexerCandidateSummary(
      "# Account lifecycle\n\nAccount updates enter through the public handler.\n\nInternal detail.",
      "Account lifecycle",
    )).toBe("Account updates enter through the public handler.");
  });
});
