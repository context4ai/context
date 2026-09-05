import { describe, expect, test } from "bun:test";
import {
  canonicalProjectIndexerSupplementarySources,
  type AuthorSupplementarySource,
} from "../project/indexerCurrentMainRunSpec.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function source(
  overrides: Partial<AuthorSupplementarySource> = {},
): AuthorSupplementarySource {
  return {
    indexer_id: "docs",
    source_ref: "file:docs",
    module_ref: "guide.md",
    profile_contract_digest: digest("a"),
    source_binding_digest: digest("b"),
    ...overrides,
  };
}

describe("0.7.5 supplementary source authority", () => {
  test("deduplicates identical authority and sorts by stable source identity", () => {
    expect(canonicalProjectIndexerSupplementarySources([
      source({ source_ref: "file:z" }),
      source(),
      source(),
    ])).toEqual([
      source(),
      source({ source_ref: "file:z" }),
    ]);
  });

  test("rejects conflicting authority for the same supplementary source", () => {
    expect(() => canonicalProjectIndexerSupplementarySources([
      source(),
      source({ profile_contract_digest: digest("c") }),
    ])).toThrow("has conflicting authority");

    expect(() => canonicalProjectIndexerSupplementarySources([
      source(),
      source({ source_binding_digest: digest("d") }),
    ])).toThrow("has conflicting authority");
  });
});
