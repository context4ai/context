import { describe, expect, test } from "bun:test";
import {
  allSources,
  assertDocumentEvidenceSectionMetadata,
  captureFile,
  captureLark,
  customPhase,
  DOC_MAINLINE_COLLECTIONS,
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  DOCUMENT_SECTION_CONTENT_MODES,
  DOCUMENT_STRUCTURE_SCHEMA_VERSION,
  defineProject,
  kbPackage,
  KNOWLEDGE_COLLECTIONS,
  llmsPackage,
  MAINLINE_COLLECTIONS,
  mdxJsonDocs,
  OKF_ROOTS,
  source,
  TOP_LEVEL_NAMESPACES,
} from "../index.js";

describe("@c4a/context SDK bootstrap", () => {
  test("defineProject keeps current declarations", () => {
    const project = defineProject({
      sources: allSources("repo"),
      phases: [customPhase("author", async () => ({ outputs: [] }))],
      packages: [kbPackage({
        name: "sample-lib-kb",
        template: "src/package-templates/kb",
      })],
    });

    expect(project.kind).toBe("context.project");
    expect(project.project.sources).toEqual([{ kind: "source.collection", type: "repo" }]);
    expect(project.project.phases.map((phase) => phase.id)).toEqual(["author"]);
  });

  test("defineProject rejects duplicate phase ids", () => {
    const duplicate = customPhase("duplicate", async () => ({ outputs: [] }));
    expect(() => defineProject({
      sources: [],
      phases: [duplicate, duplicate],
      packages: [],
    })).toThrow('Duplicate Context phase id "duplicate"');
  });

  test("capture factories derive stable source snapshot resources", () => {
    const docs = source("product-docs", { type: "file" });
    const handbook = source("handbook", { type: "lark" });
    const captureDocs = captureFile({ source: docs, processor: mdxJsonDocs() });
    const captureHandbook = captureLark({
      source: handbook,
      resources: { maxBytesPerResource: 1024, maxTotalBytes: 2048 },
    });

    expect(captureDocs.id).toBe("capture:file:product-docs");
    expect(captureDocs.source.name).toBe("product-docs");
    expect(captureDocs.processors).toEqual([{
      kind: "file.capture.processor.mdx-json-docs",
      include: ["**/*.md", "**/*.mdx", "**/_meta.json"],
      documentExtensions: [".md", ".mdx"],
      routeMetadataFile: "_meta.json",
    }]);
    expect(captureHandbook.id).toBe("capture:lark:handbook");
    expect(captureHandbook.source.name).toBe("handbook");
    expect(captureHandbook.resources).toEqual({
      videos: "reference-only",
      maxBytesPerResource: 1024,
      maxTotalBytes: 2048,
    });
  });

  test("current SDK types exclude retired authoring phases", () => {
    const docs = source("product-docs", { type: "file" });
    const assertContracts = () => {
      // @ts-expect-error capture factories require an options object.
      captureFile(docs);
      // @ts-expect-error source types are repo/file/lark only.
      source("doc", { type: "note" });
      // @ts-expect-error source collections are repo/file/lark only.
      allSources("url");
      // @ts-expect-error packages use name instead of id.
      kbPackage({ id: "bad", template: "src/package-templates/kb" });
      llmsPackage({
        name: "bad",
        template: "src/package-templates/llms",
        // @ts-expect-error package collections are internal knowledge collections.
        select: { collections: ["wikis"] },
      });
    };
    expect(typeof assertContracts).toBe("function");
  });

  test("capture factories reject invalid source or resource limits", () => {
    const repo = source("sample-lib", { type: "repo" });
    const fileDocs = source("product-docs", { type: "file" });
    const handbook = source("handbook", { type: "lark" });
    expect(() => captureFile({ source: repo as never })).toThrow(/file source/);
    expect(() => captureLark({ source: fileDocs as never })).toThrow(/lark source/);
    expect(() => captureLark({
      source: handbook,
      resources: { maxBytesPerResource: 0 },
    })).toThrow(/positive safe integer/);
    expect(() => captureLark({
      source: handbook,
      resources: { maxBytesPerResource: 1024, maxTotalBytes: 512 },
    })).toThrow(/greater than or equal/);
  });

  test("package factories reject unsafe paths and keep distribution options", () => {
    expect(() => kbPackage({ name: "../bad", template: "src/package-templates/kb" })).toThrow(/Package name/);
    expect(() => llmsPackage({ name: "bad/pkg", template: "src/package-templates/llms" })).toThrow(/Package name/);
    expect(() => kbPackage({ name: "safe-kb", template: "../templates/skills" })).toThrow(/template path/);
    expect(kbPackage({
      name: "namespaced-kb",
      template: "src/package-templates/kb",
      distribution: { knowledgeNamespace: "personal-user.123/reference" },
      assets: { delivery: "omit" },
    })).toMatchObject({
      distribution: { knowledgeNamespace: "personal-user.123/reference" },
      assets: { delivery: "omit" },
    });
  });

  test("collection constants separate routing from OKF roots", () => {
    expect(DOC_MAINLINE_COLLECTIONS).toEqual([
      "business", "product", "architecture", "sop", "faq",
      "standards", "decision", "incident", "test",
    ]);
    expect(MAINLINE_COLLECTIONS).toEqual([
      "codeindex", "codegraph", ...DOC_MAINLINE_COLLECTIONS,
    ]);
    expect(KNOWLEDGE_COLLECTIONS).toEqual([...MAINLINE_COLLECTIONS, "feats"]);
    expect(TOP_LEVEL_NAMESPACES).toEqual([...MAINLINE_COLLECTIONS, "feats"]);
    expect(OKF_ROOTS).toEqual(["guides", "rules", "wikis", "feats"]);
  });

  test("document evidence metadata remains readable for approved knowledge", () => {
    expect(DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION).toBe("context.compile-actions.v1");
    expect(DOCUMENT_STRUCTURE_SCHEMA_VERSION).toBe("context.structure.v1");
    expect(DOCUMENT_SECTION_CONTENT_MODES).toEqual(["verbatim", "empty"]);
    expect(() => assertDocumentEvidenceSectionMetadata({
      id: "section-1",
      kind: "spec",
      content_mode: "verbatim",
      source_ref: "src-1#span:Overview L1-10@abcdef123456",
    }, { stage: "approved" })).not.toThrow();
  });
});
