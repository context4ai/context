import { describe, expect, test } from "bun:test";
import { EdgeType, Grounding, SymbolKind, Visibility } from "@c4a/core";
import type { ExtractTsPhaseDefinition } from "@c4a/context";
import type { RepositoryExtractionResult } from "@c4a/extract";
import { makeCandidates, renderSymbolMarkdown } from "../project/extractCandidateBuild.js";
import type { RepoSourceRecord } from "../project/repoSources.js";
import { cleanApprovedBody } from "../project/reviewApply.js";

describe("extract candidate markdown rendering", () => {
  test("projects only unambiguous source-backed AST relationships between selected symbols", () => {
    const phase = {
      collection: "codegraph",
      exportedOnly: true,
    } as ExtractTsPhaseDefinition;
    const source = {
      name: "20260809/sample-lib",
      namespace: "20260809",
      module: "sample-lib",
      git: { remote: "https://git.example.com/sample-lib.git", ref: "a1b2c3d4" },
    } satisfies RepoSourceRecord;
    const symbol = (name: string) => ({
      name,
      kind: SymbolKind.Function,
      visibility: Visibility.Exported,
      file: "src/index.ts",
      line: 1,
      endLine: 1,
    });
    const extraction = {
      repoPath: "/tmp/sample-lib",
      moduleErrors: [],
      results: [{
        module: { name: "sample-lib", path: ".", files: ["src/index.ts"], fileCount: 1, totalLines: 10 },
        extraction: {
          package: { name: "sample-lib" },
          symbols: [symbol("render"), symbol("format")],
          relations: [{
            type: EdgeType.Calls,
            from: "render",
            to: "format",
            isExternal: false,
            grounding: Grounding.Code,
            confidence: 1,
            source: "ast",
          }, {
            type: EdgeType.Calls,
            from: "render",
            to: "externalFormat",
            isExternal: true,
            grounding: Grounding.Code,
            confidence: 1,
            source: "ast",
          }],
        },
      }],
    } as unknown as RepositoryExtractionResult;

    const result = makeCandidates({ phase, source, extraction });
    const render = result.candidates.find((candidate) => candidate.review.title === "render");

    expect(result.relationships).toEqual({
      mode: "source-backed-ast",
      detected: 2,
      emitted: 1,
      omitted: {
        external: 1,
        endpointNotSelected: 0,
        ambiguousEndpoint: 0,
      },
    });
    expect(render?.code_edges).toEqual([expect.objectContaining({
      type: "depends_on",
      from: "sample-lib/symbol/render",
      to: "sample-lib/symbol/format",
      relation_type: EdgeType.Calls,
    })]);
  });

  test("renders interface members into reader-visible markdown", () => {
    const markdown = renderSymbolMarkdown({
      name: "CodeEditorProps",
      kind: SymbolKind.Interface,
      visibility: Visibility.Exported,
      file: "src/components/Base/CodeEditor/index.tsx",
      line: 12,
      endLine: 31,
      members: [
        {
          name: "code",
          kind: SymbolKind.Prop,
          visibility: Visibility.Internal,
          file: "src/components/Base/CodeEditor/index.tsx",
          line: 13,
          endLine: 13,
          typeAnnotation: "string",
        },
        {
          name: "onChange",
          kind: SymbolKind.Prop,
          visibility: Visibility.Internal,
          file: "src/components/Base/CodeEditor/index.tsx",
          line: 20,
          endLine: 20,
          typeAnnotation: "(value: string) => void",
          doc: "Called after editor content changes.",
        },
      ],
    });

    expect(markdown).toContain("# CodeEditorProps");
    expect(markdown).toContain("- kind: interface");
    expect(markdown).toContain("- members:");
    expect(markdown).toContain("  - code: prop; string");
    expect(markdown).toContain("  - onChange: prop; (value: string) => void");
    expect(markdown).toContain("    - doc: Called after editor content changes.");
  });

  test("renders component props type into reader-visible markdown", () => {
    const markdown = renderSymbolMarkdown({
      name: "CodeEditor",
      kind: SymbolKind.Component,
      visibility: Visibility.Exported,
      file: "src/components/Base/CodeEditor/index.tsx",
      line: 40,
      endLine: 60,
      typeAnnotation: "FC<CodeEditorProps>",
      propsType: "CodeEditorProps",
    });

    expect(markdown).toContain("- props: CodeEditorProps");
    expect(markdown).toContain("- type: FC<CodeEditorProps>");
  });

  test("renders function signature into reader-visible markdown", () => {
    const markdown = renderSymbolMarkdown({
      name: "getSecondLevelDomain",
      kind: SymbolKind.Function,
      visibility: Visibility.Exported,
      file: "src/get-second-level-domain.ts",
      line: 1,
      endLine: 15,
      signature: "getSecondLevelDomain()",
    });

    expect(markdown).toContain("- signature: getSecondLevelDomain()");
  });

  test("renders enum values into reader-visible markdown", () => {
    const markdown = renderSymbolMarkdown({
      name: "SatisfactionType",
      kind: SymbolKind.Enum,
      visibility: Visibility.Exported,
      file: "src/satisfaction.ts",
      line: 8,
      endLine: 11,
      unionValues: ["Popup = popup", "MsgCard = msgCard"],
    });

    expect(markdown).toContain("- values:");
    expect(markdown).toContain("  - Popup = popup");
    expect(markdown).toContain("  - MsgCard = msgCard");
  });

  test("renders variable initializer into reader-visible markdown", () => {
    const markdown = renderSymbolMarkdown({
      name: "DEFAULT_WIDTH",
      kind: SymbolKind.Variable,
      visibility: Visibility.Exported,
      file: "src/constants.ts",
      line: 1,
      endLine: 1,
      initializer: "420",
    });

    expect(markdown).toContain("- initializer: `420`");
  });

  test("approved body cleanup keeps member fields named kind", () => {
    const body = cleanApprovedBody([
      "# FileSendPart",
      "",
      "- kind: interface",
      "- visibility: exported",
      "- source: src/message.ts:17",
      "- members:",
      "  - kind: prop; 'file'",
      "  - file: prop; {",
      "    name?: string;",
      "  }",
    ].join("\n"));

    expect(body).not.toContain("- kind: interface");
    expect(body).toContain("  - kind: prop; 'file'");
    expect(body).toContain("  - file: prop; {");
  });
});
