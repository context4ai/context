import { describe, expect, test } from "bun:test";
import {
  approvedKnowledgeMetadataIndex,
  compactApprovedKnowledgeMarkdown,
  hydrateApprovedKnowledgeMarkdown,
} from "../project/approvedKnowledgeMetadata.js";
import {
  inferDocumentRevisionReplacements,
  type DocumentOptimizationSectionState,
} from "../project/documentOptimizationModel.js";

const SOURCE_REF = "src-1#span:1-1@sha256:test";

function page(body: string): string {
  return [
    "---",
    "title: Example",
    "node_ref: entity/example",
    "node_type: entity",
    "view_ref: faq:entity/example",
    "sources:",
    "  - file:docs/guide.md",
    "code_symbols:",
    "  - example|run|function",
    "---",
    "",
    `<!-- context:section id="intro" kind="description" content_mode="verbatim" source_ref="${SOURCE_REF}" -->`,
    body,
    "<!-- /context:section -->",
    "",
  ].join("\n");
}

describe("0.7.0 document optimization hydration regression", () => {
  test("treats compact-close hydration as semantically equal frontmatter", () => {
    const original = page("Hello  world.");
    const compact = compactApprovedKnowledgeMarkdown(original);
    const metadata = approvedKnowledgeMetadataIndex({
      views: [{
        path: "faq/example.md",
        view_ref: "faq:entity/example",
        node_type: "entity",
        machine: { code_symbols: ["example|run|function"] },
      }],
      edges: [],
    });
    const hydrated = hydrateApprovedKnowledgeMarkdown({
      content: compact,
      relPath: "faq/example.md",
      metadata,
    });
    expect(hydrated).not.toBe(original);

    const state: DocumentOptimizationSectionState = {
      input_digest: "a".repeat(64),
      context_digest: "b".repeat(64),
      policy_digest: "c".repeat(64),
    };
    const replacements = inferDocumentRevisionReplacements({
      file: {
        relPath: "faq/example.md",
        absPath: "/virtual/faq/example.md",
        content: hydrated,
      },
      revisionContent: page("Hello world."),
      revisionSections: new Map([["intro", state]]),
    });
    expect(replacements).not.toBeNull();
    expect([...replacements!.values()].map((value) => value.trim())).toEqual(["Hello world."]);
  });
});
