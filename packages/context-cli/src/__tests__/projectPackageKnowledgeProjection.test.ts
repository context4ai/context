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
      "![Architecture](../assets/image/example.png) <!-- lark:image:example-token -->",
      "",
      "[Reference](https://example.test) <!-- lark:cite:reference-token -->",
      "",
      "<!-- reader:keep-this-comment -->",
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
    expect(projected).not.toContain("lark:image:");
    expect(projected).not.toContain("lark:cite:");
    expect(projected).toContain("Body remains byte-for-byte visible.");
    expect(projected).toContain("![Architecture](../assets/image/example.png)");
    expect(projected).toContain("[Reference](https://example.test)");
    expect(projected).toContain("<!-- reader:keep-this-comment -->");

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

  test("replaces generated relationship navigation with a reader description", () => {
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
    expect(frontmatter(projected)).toHaveProperty("description", "Access rules");
    expect(projected).toContain("# Access rules");
  });

  test("keeps Indexer recovery bindings out of reader packages", () => {
    const input = [
      "---",
      "title: Toggle",
      "type: Wiki",
      "description: content Artifact from tux-code-indexer.",
      "tags:",
      "  - indexer",
      "  - content",
      "  - tux-code-indexer",
      "timestamp: 2026-09-02T00:00:00.000Z",
      "candidate_fingerprint: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "indexer_compile_digest: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "indexer_file_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "indexer_artifact_ref: artifact:subject:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "indexer_section_refs:",
      "  - section:subject:sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "indexer_source_ref: repo:sample",
      "---",
      "",
      "# Toggle",
      "",
      "Reader content.",
      "",
    ].join("\n");

    const output = frontmatter(projectPackageKnowledgeMarkdown(input));
    expect(output).toEqual({
      title: "Toggle",
      type: "Wiki",
      description: "Reader content.",
      timestamp: "2026-09-02T00:00:00.000Z",
    });
  });

  test("adds a visible title when an approved page only declares it in frontmatter", () => {
    const projected = projectPackageKnowledgeMarkdown([
      "---",
      "title: Reader-visible title",
      "type: Wiki",
      "---",
      "",
      "Reader content.",
      "",
    ].join("\n"));

    expect(projected).toContain("\n---\n\n# Reader-visible title\n\nReader content.");
    expect(projected.match(/^# Reader-visible title$/gmu)).toHaveLength(1);
  });
});
