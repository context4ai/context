import { describe, expect, test } from "bun:test";
import YAML from "yaml";
import {
  packageKnowledgeMetadata,
  parseKnowledgeFrontmatter,
  projectPackageKnowledgeMarkdown,
} from "../project/packageKnowledgeProjection.js";

function frontmatter(content: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(content);
  if (match?.[1] === undefined) throw new Error("expected projected frontmatter");
  return YAML.parse(match[1]) as Record<string, unknown>;
}

describe("package knowledge consumer projection", () => {
  test("keeps reader metadata while moving graph and provenance metadata out of pages", () => {
    const input = [
      "---",
      "title: Example Guide",
      "type: Guide",
      "node_ref: entity/example",
      "view_ref: architecture:entity/example",
      "structure_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "node_type: entity",
      "generated: parent_index",
      "children:",
      "  - view_ref: architecture:entity/child",
      "    path: architecture/example/child.md",
      'description: "Example navigation. Reachable edges: contains -> architecture:entity/child."',
      "tags:",
      "  - docs",
      "  - prose",
      "  - parent-index",
      "  - entity",
      "  - batch/example",
      "node_tags:",
      "  - system",
      "timestamp: 2026-01-01T00:00:00.000Z",
      "resource: file:batch/example/page.md",
      "sources:",
      "  - file:batch/example/page.md",
      "visibility: exported",
      "code_symbols:",
      "  - module|Example|function",
      "relationship_mode: source-backed-ast",
      "code_edges: []",
      "candidate_fingerprint: sha256:example",
      "---",
      "",
      "# Example Guide",
      "",
      "<!-- context:section id=\"intro\" source_ref=\"src-1#span:intro L1-2@abcdef12\" -->",
      "",
      "<!-- context:summary",
      '{"text":"Internal section summary."}',
      "/context:summary -->",
      "",
      "Body remains byte-for-byte visible.",
      "",
      "<!-- /context:section -->",
      "",
    ].join("\n");

    const projected = projectPackageKnowledgeMarkdown(input);
    const output = frontmatter(projected);
    expect(output).toMatchObject({
      title: "Example Guide",
      type: "Guide",
      description: "Example navigation.",
      tags: ["entity", "system"],
    });
    for (const field of [
      "node_ref",
      "view_ref",
      "structure_digest",
      "node_type",
      "node_tags",
      "generated",
      "children",
      "visibility",
      "code_symbols",
      "relationship_mode",
      "code_edges",
      "candidate_fingerprint",
      "resource",
      "sources",
    ]) {
      expect(output).not.toHaveProperty(field);
    }
    expect(projected).not.toContain("context:section");
    expect(projected).not.toContain("context:summary");
    expect(projected).toContain("Body remains byte-for-byte visible.");

    expect(packageKnowledgeMetadata(parseKnowledgeFrontmatter(input))).toMatchObject({
      node_type: "entity",
      generated: "parent_index",
      visibility: "exported",
      code_symbols: ["module|Example|function"],
      candidate_fingerprint: "sha256:example",
    });
  });

  test("leaves markdown without valid frontmatter unchanged", () => {
    const input = "# Plain Markdown\n\nNo frontmatter.\n";
    expect(projectPackageKnowledgeMarkdown(input)).toBe(input);
  });

  test("drops descriptions that only contain generated relationship navigation", () => {
    const input = [
      "---",
      "title: Access rules",
      "type: Rule",
      'description: "Reachable edges: contains <- standards:domain/access-rules."',
      "---",
      "",
      "# Access rules",
      "",
    ].join("\n");

    const projected = projectPackageKnowledgeMarkdown(input);
    expect(frontmatter(projected)).not.toHaveProperty("description");
    expect(projected).toContain("# Access rules");
  });
});
