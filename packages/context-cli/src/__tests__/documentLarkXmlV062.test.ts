import { describe, expect, test } from "bun:test";
import { projectLarkDocxXml } from "../lib/larkDocxXml.js";

function expectClosedCounts(report: ReturnType<typeof projectLarkDocxXml>["fidelity"]): void {
  for (const [blockType, discovered] of Object.entries(report.discovered)) {
    const skipped = report.skipped
      .filter((item) => item.block_type === blockType)
      .reduce((sum, item) => sum + item.count, 0);
    expect((report.converted[blockType] ?? 0) + skipped).toBe(discovered);
  }
}

describe("Lark Docx XML readable projection", () => {
  test("preserves rich blocks as readable Markdown and structured resource descriptors", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/source-token",
      xml: [
        "<title>Integration Guide</title>",
        '<p>Read <cite doc-id="reference-token" file-type="docx" title="Reference Guide"/> before continuing.</p>',
        '<img token="image-token" alt="Architecture diagram" href="https://example.test/drive-stream/download?authcode=secret"/>',
        '<source token="video-token" type="video" name="Walkthrough"/>',
        '<whiteboard board-token="board-token" type="mermaid">flowchart LR\nA--&gt;B</whiteboard>',
        '<base_refer token="base-token" table-id="table-token" view-id="view-token" title="Records"/>',
        '<table><tr><td><ul><li><a href="https://example.test/guide">Nested link</a></li></ul></td></tr></table>',
      ].join("\n"),
    });

    expect(projection.title).toBe("Integration Guide");
    expect(projection.markdown).toContain("[Reference Guide](https://example.larkoffice.com/docx/reference-token)");
    expect(projection.markdown).toContain("> Image: Architecture diagram (lark:image:image-token)");
    expect(projection.markdown).toContain("> Video: Walkthrough (lark:video:video-token)");
    expect(projection.markdown).toContain("```mermaid\nflowchart LR\nA-->B\n```");
    expect(projection.markdown).toContain("> Records — table-token / view-token (lark:base:base-token#table-token#view-token)");
    expect(projection.markdown).toContain("[Nested link](https://example.test/guide)");
    expect(projection.resources.map((resource) => resource.kind).sort()).toEqual([
      "base",
      "cite",
      "image",
      "video",
      "whiteboard",
    ]);
    expect(projection.auditXml).not.toContain("authcode=secret");
    expect(projection.auditXml).toContain("[redacted-transient-url]");
    expect(projection.rawContentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(projection.fidelity.status).toBe("complete");
    expectClosedCounts(projection.fidelity);
  });

  test("distinguishes inline and token-backed diagrams without guessing from prose", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/docx/source-token",
      xml: [
        "<title>Diagrams</title>",
        '<diagram type="graph">node-a -&gt; node-b</diagram>',
        '<readonly-block type="diagram" token="diagram-token"/>',
      ].join(""),
    });

    expect(projection.markdown).toContain("```graph\nnode-a -> node-b\n```");
    expect(projection.markdown).toContain("> Diagram: lark:diagram:inline-");
    expect(projection.markdown).toContain("> Diagram: lark:diagram:diagram-token");
    expect(projection.resources).toEqual([
      expect.objectContaining({
        kind: "diagram",
        locator: expect.stringMatching(/^lark:diagram:inline-[a-f0-9]{64}$/u),
        inline_content: true,
      }),
      expect.objectContaining({ kind: "diagram", locator: "lark:diagram:diagram-token" }),
    ]);
    expect(projection.fidelity.status).toBe("complete");
    expectClosedCounts(projection.fidelity);
  });

  test("projects unknown non-empty blocks generically without treating renderer coverage as evidence loss", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/docx/source-token",
      xml: '<title>Guide</title><future_block id="block-1" style="wide" href="https://example.test/drive-stream/download?authcode=secret"><p>Preserve this evidence.</p></future_block><empty_future/>',
    });

    expect(projection.markdown).toContain("Lark block (generic projection): `future_block`");
    expect(projection.markdown).toContain("Preserve this evidence.");
    expect(projection.markdown).toContain('Exported attributes: {"href":"[redacted-transient-url]","id":"block-1","style":"wide"}');
    expect(projection.markdown).not.toContain("authcode=secret");
    expect(projection.resources).toContainEqual(expect.objectContaining({
      kind: "embed",
      locator: expect.stringMatching(/^lark:block:future_block:[a-f0-9]{12}$/u),
      title: "future_block",
    }));
    expect(projection.fidelity.status).toBe("warning");
    expect(projection.fidelity.evidence_status).toBe("complete");
    expect(projection.fidelity.projection_status).toBe("generic");
    expect(projection.fidelity.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warning",
        impact: "projection",
        code: "lark.capture.generic-projection",
        block_type: "future_block",
      }),
      expect.objectContaining({
        severity: "warning",
        block_type: "empty_future",
        reason: "unknown empty block omitted",
      }),
    ]));
    expectClosedCounts(projection.fidelity);
  });

  test("registers unresolved external resources and reports a fidelity error", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/docx/source-token",
      xml: '<title>Guide</title><img alt="Diagram" href="https://example.test/drive-stream/download?authcode=secret"/>',
    });

    expect(projection.resources).toHaveLength(1);
    expect(projection.resources[0]?.locator).toMatch(/^lark:image:unresolved:[a-f0-9]{12}$/u);
    expect(projection.resources[0]?.attributes.href).toBeUndefined();
    expect(projection.fidelity.status).toBe("error");
    expectClosedCounts(projection.fidelity);
  });

  test("counts table containers exactly once across multiple and nested colgroups", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/docx/source-token",
      xml: [
        "<title>Table Guide</title>",
        "<table>",
        "  <colgroup><col/><col/></colgroup>",
        "  <colgroup><col/></colgroup>",
        "  <tbody>",
        "    <tr><td>Outer</td><td><table><colgroup><col/></colgroup><tr><td>Nested</td></tr></table></td></tr>",
        "  </tbody>",
        "</table>",
      ].join(""),
    });

    expect(projection.fidelity.status).toBe("complete");
    expect(projection.fidelity.discovered.colgroup).toBe(3);
    expect(projection.fidelity.converted.colgroup).toBe(3);
    expect(projection.fidelity.discovered.col).toBe(4);
    expect(projection.fidelity.converted.col).toBe(4);
    expectClosedCounts(projection.fidelity);
  });

  test("preserves ordered sub-page references as deterministic document resources", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/parent-token",
      xml: [
        "<title>Document index</title>",
        '<sub-page-list space-id="space-token" wiki-token="parent-token">',
        '  <sub-page doc-id="document-alpha" file-type="docx" title="Alpha guide"/>',
        '  <sub-page doc-id="document-beta" file-type="docx" title="Beta guide"/>',
        "</sub-page-list>",
      ].join(""),
    });

    const alpha = "- [Alpha guide](https://example.larkoffice.com/docx/document-alpha) <!-- lark:document:document-alpha -->";
    const beta = "- [Beta guide](https://example.larkoffice.com/docx/document-beta) <!-- lark:document:document-beta -->";
    expect(projection.markdown).toContain(alpha);
    expect(projection.markdown).toContain(beta);
    expect(projection.markdown.indexOf(alpha)).toBeLessThan(projection.markdown.indexOf(beta));
    expect(projection.resources).toEqual([
      expect.objectContaining({ kind: "document", locator: "lark:document:document-alpha", title: "Alpha guide" }),
      expect.objectContaining({ kind: "document", locator: "lark:document:document-beta", title: "Beta guide" }),
    ]);
    expect(projection.fidelity.discovered).toMatchObject({ "sub-page-list": 1, "sub-page": 2 });
    expect(projection.fidelity.converted).toMatchObject({ "sub-page-list": 1, "sub-page": 2 });
    expect(projection.fidelity.status).toBe("complete");
    expectClosedCounts(projection.fidelity);
  });

  test("blocks a sub-page without a stable document identity", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/parent-token",
      xml: '<title>Document index</title><sub-page-list><sub-page title="Unresolved guide"/></sub-page-list>',
    });

    expect(projection.markdown).toContain("Unresolved guide");
    expect(projection.fidelity.status).toBe("error");
    expect(projection.fidelity.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        block_type: "sub-page",
        reason: "sub-page has no doc-id or token",
      }),
    ]));
    expectClosedCounts(projection.fidelity);
  });

  test("does not report an unresolved empty sub-page list as complete", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/parent-token",
      xml: '<title>Document index</title><sub-page-list space-id="space-token" wiki-token="parent-token"></sub-page-list>',
    });

    expect(projection.markdown).toBe("# Document index");
    expect(projection.resources).toEqual([]);
    expect(projection.fidelity.status).toBe("error");
    expect(projection.fidelity.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "lark.capture.sub-page-list-empty",
        block_type: "sub-page-list",
      }),
    ]));
    expectClosedCounts(projection.fidelity);
  });

  test("preserves bookmarks and synced references as traceable external resources", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/docx/current-document",
      xml: [
        "<title>Reference index</title>",
        '<bookmark name="Release calendar" href="https://calendar.example.com/shared/schedule"></bookmark>',
        '<synced_reference src-token="source-document" src-block-id="source-block"></synced_reference>',
      ].join(""),
    });

    expect(projection.markdown).toContain(
      "[Release calendar](https://calendar.example.com/shared/schedule)",
    );
    expect(projection.markdown).toContain(
      "[Synced reference](https://example.larkoffice.com/docx/source-document#source-block)",
    );
    expect(projection.resources).toEqual([
      expect.objectContaining({
        kind: "bookmark",
        locator: "https://calendar.example.com/shared/schedule",
        title: "Release calendar",
      }),
      expect.objectContaining({
        kind: "synced-reference",
        locator: "lark:synced-reference:source-document#source-block",
        title: "Synced reference",
      }),
    ]);
    expect(projection.fidelity.discovered).toMatchObject({ bookmark: 1, synced_reference: 1 });
    expect(projection.fidelity.converted).toMatchObject({ bookmark: 1, synced_reference: 1 });
    expect(projection.fidelity.status).toBe("complete");
    expectClosedCounts(projection.fidelity);
  });

  test("blocks bookmark and synced reference nodes without stable identities", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/docx/current-document",
      xml: [
        "<title>Reference index</title>",
        '<bookmark name="Missing link"></bookmark>',
        '<synced_reference src-token="source-document"></synced_reference>',
      ].join(""),
    });

    expect(projection.fidelity.status).toBe("error");
    expect(projection.fidelity.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        block_type: "bookmark",
        reason: "bookmark has no stable non-transient URL",
      }),
      expect.objectContaining({
        severity: "error",
        block_type: "synced_reference",
        reason: "synced_reference requires both src-token and src-block-id",
      }),
    ]));
    expectClosedCounts(projection.fidelity);
  });

  test("preserves checked and unchecked checklist blocks without guessing their state", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/source-token",
      xml: [
        "<title>Checklist</title>",
        '<checkbox done="true">Completed <b>item</b></checkbox>',
        '<checkbox done="false">Open item</checkbox>',
        '<todo checked="true">Legacy checked item</todo>',
      ].join(""),
    });

    expect(projection.markdown).toContain("- [x] Completed **item**");
    expect(projection.markdown).toContain("- [ ] Open item");
    expect(projection.markdown).toContain("- [x] Legacy checked item");
    expect(projection.fidelity.status).toBe("complete");
    expect(projection.fidelity.discovered).toMatchObject({ checkbox: 2, todo: 1 });
    expect(projection.fidelity.converted).toMatchObject({ checkbox: 2, todo: 1 });
    expectClosedCounts(projection.fidelity);
  });

  test("warns without blocking when a checklist projection has no unambiguous boolean state", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/source-token",
      xml: [
        "<title>Checklist</title>",
        "<checkbox>Missing state</checkbox>",
        '<todo done="true" checked="false">Conflicting state</todo>',
      ].join(""),
    });

    expect(projection.markdown).toContain("- [?] Missing state");
    expect(projection.markdown).toContain("- [?] Conflicting state");
    expect(projection.fidelity.status).toBe("warning");
    expect(projection.fidelity.evidence_status).toBe("complete");
    expect(projection.fidelity.projection_status).toBe("warning");
    expect(projection.fidelity.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "lark.capture.checkbox-state-invalid",
        block_type: "checkbox",
      }),
      expect.objectContaining({
        code: "lark.capture.checkbox-state-invalid",
        block_type: "todo",
      }),
    ]));
    expectClosedCounts(projection.fidelity);
  });

  test("preserves a named Lark poll as a stable non-interactive resource", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/source-token",
      xml: '<title>Testing guide</title><poll id="poll-block-token" name="When to write tests"></poll>',
    });

    expect(projection.markdown).toContain(
      "> Lark poll (non-interactive): When to write tests <!-- lark:poll:poll-block-token -->",
    );
    expect(projection.markdown).toContain("Options and results are not present in the exported XML.");
    expect(projection.resources).toEqual([expect.objectContaining({
      kind: "poll",
      locator: "lark:poll:poll-block-token",
      title: "When to write tests",
      attributes: { id: "poll-block-token", name: "When to write tests" },
    })]);
    expect(projection.fidelity.status).toBe("complete");
    expect(projection.fidelity.discovered.poll).toBe(1);
    expect(projection.fidelity.converted.poll).toBe(1);
    expect(projection.fidelity.skipped).toEqual([]);
    expectClosedCounts(projection.fidelity);
  });

  test("mechanically preserves exported poll options, links, state, and counts", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/source-token",
      xml: [
        '<poll id="poll-block-token" name="Release window" status="closed" href="https://example.test/polls/1">',
        '  <option id="option-a" label="Morning" votes="3"/>',
        '  <poll-option id="option-b" status="winner">Afternoon</poll-option>',
        "</poll>",
      ].join(""),
    });

    expect(projection.markdown).toContain(
      "> Lark poll (non-interactive): [Release window](https://example.test/polls/1)",
    );
    expect(projection.markdown).toContain("> Exported attributes: status=closed");
    expect(projection.markdown).toContain("- Morning (votes=3)");
    expect(projection.markdown).toContain("- Afternoon (status=winner)");
    expect(projection.fidelity.status).toBe("complete");
    expect(projection.fidelity.discovered).toMatchObject({ poll: 1, option: 1, "poll-option": 1 });
    expect(projection.fidelity.converted).toMatchObject({ poll: 1, option: 1, "poll-option": 1 });
    expectClosedCounts(projection.fidelity);
  });

  test("warns for an entirely empty poll and blocks a named poll without stable identity", () => {
    const projection = projectLarkDocxXml({
      sourceUrl: "https://example.larkoffice.com/wiki/source-token",
      xml: '<title>Polls</title><poll/><poll name="Unresolved poll"/>',
    });

    expect(projection.markdown).toContain("Lark poll (non-interactive): Unresolved poll");
    expect(projection.fidelity.status).toBe("error");
    expect(projection.fidelity.skipped).toContainEqual({
      block_type: "poll",
      count: 1,
      reason: "empty poll omitted because the export contains no identity or content",
    });
    expect(projection.fidelity.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        block_type: "poll",
        reason: "resource has no stable token, source id, or non-transient URL",
      }),
      expect.objectContaining({
        severity: "warning",
        block_type: "poll",
        reason: "empty poll omitted because the export contains no identity or content",
      }),
    ]));
    expectClosedCounts(projection.fidelity);
  });
});
