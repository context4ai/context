import { describe, expect, test } from "bun:test";
import {
  alignProse,
  allSources,
  assertDocumentEvidenceSectionMetadata,
  captureFile,
  captureLark,
  compileProse,
  customPhase,
  DOC_MAINLINE_COLLECTIONS,
  DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION,
  DOCUMENT_SECTION_CONTENT_MODES,
  DOCUMENT_STRUCTURE_SCHEMA_VERSION,
  defineProject,
  extractCustom,
  extractTs,
  llmsPackage,
  KNOWLEDGE_COLLECTIONS,
  MAINLINE_COLLECTIONS,
  mdxJsonDocs,
  OKF_ROOTS,
  reviewValidity,
  kbPackage,
  source,
  TOP_LEVEL_NAMESPACES,
} from "../index.js";

describe("@c4a/context SDK bootstrap", () => {
  test("defineProject keeps the project declaration", () => {
    const sampleLib = source("sample-lib");
    const project = defineProject({
      sources: allSources("repo"),
      phases: [
        extractTs({ source: sampleLib, collection: "codegraph" }),
        reviewValidity({ collection: "codegraph" }),
      ],
      packages: [
        kbPackage({
          name: "sample-lib-kb",
          template: "src/package-templates/kb",
        }),
      ],
    });

    expect(project.kind).toBe("context.project");
    expect(project.project.sources).toEqual([{ kind: "source.collection", type: "repo" }]);
    expect(project.project.phases.map((phase) => phase.id)).toEqual([
      "extract:sample-lib:codegraph",
      "review:codegraph:validity",
    ]);
  });

  test("defineProject rejects duplicate phase ids with both declaration positions", () => {
    const duplicate = customPhase("duplicate", async () => ({ outputs: [] }));

    expect(() => defineProject({
      sources: [],
      phases: [duplicate, duplicate],
      packages: [],
    })).toThrow('Duplicate Context phase id "duplicate": phases[0] (phase.custom) conflicts with phases[1] (phase.custom)');
  });

  test("flat factory functions derive conventional ids and paths", () => {
    const sampleLib = source("sample-lib");
    const docs = source("product-docs");
    const handbook = source("handbook");
    const repoRef = { kind: "source.ref", type: "repo", name: "sample-lib", materializedAt: "sources/repo/sample-lib" } as const;
    const docsFileRef = { kind: "source.ref", type: "file", name: "product-docs", materializedAt: "sources/file/product-docs" } as const;
    const handbookLarkRef = { kind: "source.ref", type: "lark", name: "handbook", materializedAt: "sources/lark/handbook" } as const;
    expect(source("20260712", "user-manual", { type: "file" })).toEqual({
      kind: "source.ref",
      type: "file",
      name: "20260712/user-manual",
      materializedAt: "sources/file/20260712",
    });
    expect(source("20260712", "guide", { type: "lark" })).toEqual({
      kind: "source.ref",
      type: "lark",
      name: "20260712/guide",
      materializedAt: "sources/lark/20260712",
    });
    const repoSources = allSources("repo");
    const repoSourceCollection = repoSources[0];
    const transform = (markdown: string) => markdown.trim();
    const extract = extractTs({ source: sampleLib, collection: "codegraph", transform });
    const customExtract = extractCustom({
      id: "extract:sample-lib:protocol",
      sources: [repoRef],
      collection: "codegraph",
      extract: async () => ({ candidates: [] }),
    });
    const captureDocs = captureFile({ source: docs });
    const captureMdxDocs = captureFile({ source: docs, processor: mdxJsonDocs() });
    const captureHandbook = captureLark({ source: handbook });
    const alignNeutralDocs = alignProse({ source: docs, collection: "architecture" });
    const alignDocs = alignProse({ source: source("product-docs", { type: "file" }), collection: "architecture" });
    const alignHandbook = alignProse({ source: source("handbook", { type: "lark" }), collection: "sop" });
    const compileNeutralDocs = compileProse({ source: docs, collection: "architecture" });
    const compileDocs = compileProse({ source: source("product-docs", { type: "file" }), collection: "architecture" });
    const compileHandbook = compileProse({ source: source("handbook", { type: "lark" }), collection: "sop" });
    const extractAllRepos = extractTs({ source: repoSourceCollection, collection: "codegraph" });
    const review = reviewValidity({ collection: "architecture" });
    const reviewAll = reviewValidity({ scope: "all" });
    const custom = customPhase("custom:sample-lib:postprocess", () => undefined);
    const skills = kbPackage({
      name: "sample-lib-kb",
      template: {
        path: "src/package-templates/kb",
        vars: {
          packageLabel: "Sample Lib",
        },
      },
      select: {
        collections: ["architecture"],
        okfRoots: ["wikis"],
        include: ["architecture/sample-lib/**"],
        exclude: ["**/internal/**"],
      },
    });
    const llms = llmsPackage({
      name: "sample-lib-llms",
      template: "src/package-templates/llms",
    });

    expect(sampleLib.materializedAt).toBe("sources/sample-lib");
    expect(docs.materializedAt).toBe("sources/product-docs");
    expect(handbook.materializedAt).toBe("sources/handbook");
    expect(extract.id).toBe("extract:sample-lib:codegraph");
    expect(captureDocs.id).toBe("capture:file:product-docs");
    expect(captureHandbook.id).toBe("capture:lark:handbook");
    expect(captureHandbook.resources).toEqual({
      videos: "reference-only",
      maxBytesPerResource: 20 * 1024 * 1024,
      maxTotalBytes: 200 * 1024 * 1024,
    });
    expect(captureLark({
      source: handbook,
      resources: { videos: "bundle", maxBytesPerResource: 1024, maxTotalBytes: 4096 },
    }).resources).toEqual({ videos: "bundle", maxBytesPerResource: 1024, maxTotalBytes: 4096 });
    expect(alignNeutralDocs.id).toBe("align:source:product-docs:architecture");
    expect(alignDocs.id).toBe("align:file:product-docs:architecture");
    expect(alignHandbook.id).toBe("align:lark:handbook:sop");
    expect(compileNeutralDocs.id).toBe("compile:source:product-docs:architecture");
    expect(compileDocs.id).toBe("compile:file:product-docs:architecture");
    expect(compileHandbook.id).toBe("compile:lark:handbook:sop");
    expect(captureDocs.reads).toEqual([{ kind: "source", source: docsFileRef }]);
    expect(captureDocs.writes).toEqual([{
      kind: "source.snapshot",
      source: docsFileRef,
      sourceType: "file",
      path: "sources/file/product-docs/manifest.json",
    }]);
    expect(alignNeutralDocs.reads).toEqual([{ kind: "source", source: docs }]);
    expect(alignNeutralDocs.writes).toEqual([{
      kind: "lifecycle.structure",
      path: ".tmp/context-runtime/lifecycle/structure.yaml",
      profileCollection: "architecture",
      status: "draft",
    }]);
    expect(alignHandbook.reads).toEqual([{
      kind: "source.snapshot",
      source: handbookLarkRef,
      sourceType: "lark",
      path: "sources/lark/handbook/manifest.json",
    }]);
    expect(alignHandbook.writes).toEqual([{
      kind: "lifecycle.structure",
      path: ".tmp/context-runtime/lifecycle/structure.yaml",
      profileCollection: "sop",
      status: "draft",
    }]);
    expect(compileNeutralDocs.reads).toEqual([{
      kind: "source",
      source: docs,
    }, {
      kind: "lifecycle.structure",
      path: ".tmp/context-runtime/lifecycle/structure.yaml",
      profileCollection: "architecture",
      status: "confirmed",
    }]);
    expect(compileDocs.reads).toEqual([{
      kind: "source.snapshot",
      source: docsFileRef,
      sourceType: "file",
      path: "sources/file/product-docs/manifest.json",
    }, {
      kind: "lifecycle.structure",
      path: ".tmp/context-runtime/lifecycle/structure.yaml",
      profileCollection: "architecture",
      status: "confirmed",
    }]);
    expect(compileDocs.writes).toEqual([
      {
        kind: "lifecycle.structure",
        path: ".tmp/context-runtime/lifecycle/structure.yaml",
        profileCollection: "architecture",
        status: "frozen",
      },
      {
        kind: "lifecycle.candidates",
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        status: "draft",
      },
    ]);
    expect(compileDocs.schemaVersion).toBe("context.compile-actions.v1");
    expect(compileHandbook.sourceType).toBe("lark");
    expect("executor" in captureDocs).toBe(false);
    expect("executor" in alignDocs).toBe(false);
    expect("executor" in compileDocs).toBe(false);
    expect(extractAllRepos.id).toBe("extract:repo:codegraph");
    expect(extractAllRepos.reads).toEqual([{ kind: "source", source: repoSourceCollection }]);
    expect(extract.reads).toEqual([{ kind: "source", source: repoRef }]);
    expect(extract.writes).toEqual([{
      kind: "lifecycle.candidates",
      path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
      collection: "codegraph",
      status: "draft",
    }]);
    expect(extract.out.candidateFile).toBe(".tmp/context-runtime/lifecycle/candidates.jsonl");
    expect(extract.out.approvedPagesDir).toBe("knowledge/codegraph");
    expect(extract.out.kind).toBe("codegraph-entities");
    expect(extract.out.initialStatus).toBe("draft");
    expect(extract.mode).toBe("exports");
    expect(extract.entries).toBeUndefined();
    expect(extract.exportedOnly).toBe(true);
    expect(extract.indexPlan).toBe("declared");
    expect(extract.indexUnits).toEqual([expect.objectContaining({
      id: "sample-lib",
      inputSources: ["sample-lib"],
      outputOwner: "sample-lib",
      moduleType: "sdk-library",
      moduleTypes: ["sdk-library"],
      facets: ["public-api"],
      moduleTypeEvidence: ["Package export entries selected by extractTs exports mode."],
      outputProfile: "public-api-reference",
      capability: "complete",
    })]);
    expect(extract.transform).toBe(transform);
    expect(captureMdxDocs.processors).toEqual([{
      kind: "file.capture.processor.mdx-json-docs",
      include: ["**/*.md", "**/*.mdx", "**/_meta.json"],
      documentExtensions: [".md", ".mdx"],
      routeMetadataFile: "_meta.json",
    }]);
    expect(review.id).toBe("review:architecture:validity");
    expect(review.reads).toEqual([{
      kind: "lifecycle.candidates",
      path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
      collection: "architecture",
      status: "draft",
    }]);
    expect(review.writes).toEqual([
      {
        kind: "review.payload",
        path: "review-payload.json",
      },
      {
        kind: "knowledge.collection",
        path: "knowledge/architecture",
        collection: "architecture",
        status: "approved",
      },
      {
        kind: "knowledge.decisions",
        path: "knowledge/decisions.json",
      },
      {
        kind: "lifecycle.candidates",
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        collection: "architecture",
        status: "rejected",
      },
    ]);
    expect(review.collection).toBe("architecture");
    expect(review.scope).toEqual({ kind: "collection", collection: "architecture" });
    expect(review.status).toBe("draft");
    expect(review.decisions).toEqual(["approved", "rejected"]);
    expect(reviewAll.id).toBe("review:all:validity");
    expect(reviewAll.reads).toEqual([{
      kind: "lifecycle.candidates",
      path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
      status: "draft",
    }]);
    expect(reviewAll.writes).toEqual([
      {
        kind: "review.payload",
        path: "review-payload.json",
      },
      {
        kind: "knowledge.approved",
        path: "knowledge",
      },
      {
        kind: "knowledge.decisions",
        path: "knowledge/decisions.json",
      },
      {
        kind: "lifecycle.candidates",
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        status: "rejected",
      },
    ]);
    expect(reviewAll.collection).toBeUndefined();
    expect(reviewAll.scope).toEqual({ kind: "all" });
    expect(custom.kind).toBe("phase.custom");
    expect(custom.id).toBe("custom:sample-lib:postprocess");
    expect(custom.reads).toEqual([]);
    expect(custom.writes).toEqual([]);
    expect(customExtract).toMatchObject({
      kind: "phase.extract.custom",
      id: "extract:sample-lib:protocol",
      collection: "codegraph",
      sources: [repoRef],
      indexUnits: [],
      writes: [{
        kind: "lifecycle.candidates",
        path: ".tmp/context-runtime/lifecycle/candidates.jsonl",
        collection: "codegraph",
        status: "draft",
      }],
    });
    expect(skills.kind).toBe("package.kb");
    expect(skills.name).toBe("sample-lib-kb");
    expect(skills.reads).toEqual([{
      kind: "knowledge.approved",
      path: "knowledge",
      select: {
        collections: ["architecture"],
        okfRoots: ["wikis"],
        include: ["architecture/sample-lib/**"],
        exclude: ["**/internal/**"],
      },
    }, {
      kind: "package.template",
      path: "src/package-templates/kb",
    }]);
    expect(skills.writes).toEqual([{
      kind: "dist.package",
      path: "dist/sample-lib-kb",
      packageName: "sample-lib-kb",
      packageKind: "kb",
    }]);
    expect(skills.template).toEqual({
      path: "src/package-templates/kb",
      vars: {
        displayName: "Sample Lib KB",
        packageLabel: "Sample Lib",
        packageKind: "kb",
        packageName: "sample-lib-kb",
      },
    });
    expect(skills.outDir).toBe("dist/sample-lib-kb");
    expect(skills.navigation).toEqual({
      foldDirectoryIndexes: true,
      maxInlineEntries: 50,
    });
    expect(llms.kind).toBe("package.llms");
    expect(llms.template).toEqual({
      path: "src/package-templates/llms",
      vars: {
        displayName: "Sample Lib LLMS",
        packageKind: "llms",
        packageName: "sample-lib-llms",
      },
    });
    expect(llms.reads).toEqual([{
      kind: "knowledge.approved",
      path: "knowledge",
    }, {
      kind: "package.template",
      path: "src/package-templates/llms",
    }]);
    expect(llms.writes).toEqual([{
      kind: "dist.package",
      path: "dist/sample-lib-llms",
      packageName: "sample-lib-llms",
      packageKind: "llms",
    }]);
  });

  test("package factories reject unsafe output names and template paths", () => {
    expect(() =>
      kbPackage({ name: "../bad", template: "src/package-templates/kb" })
    ).toThrow(/Package name/);
    expect(() =>
      llmsPackage({ name: "bad/pkg", template: "src/package-templates/llms" })
    ).toThrow(/Package name/);
    expect(() =>
      kbPackage({ name: "safe-kb", template: "../templates/skills" })
    ).toThrow(/template path/);
    expect(() =>
      llmsPackage({ name: "safe-llms", template: "/tmp/templates/llms" })
    ).toThrow(/template path/);
    expect(() =>
      kbPackage({
        name: "safe-kb",
        template: "src/package-templates/kb",
        select: { include: ["../knowledge/**"] },
      })
    ).toThrow(/select\.include/);
    expect(() =>
      llmsPackage({
        name: "safe-llms",
        template: "src/package-templates/llms",
        select: { exclude: ["/wikis/**"] },
      })
    ).toThrow(/select\.exclude/);
    expect(() =>
      kbPackage({
        name: "safe-kb",
        template: "src/package-templates/kb",
        navigation: { maxInlineEntries: 0 },
      })
    ).toThrow(/navigation\.maxInlineEntries/);
    expect(kbPackage({
      name: "expanded-kb",
      template: "src/package-templates/kb",
      navigation: {
        foldDirectoryIndexes: false,
        maxInlineEntries: 12,
      },
    }).navigation).toEqual({
      foldDirectoryIndexes: false,
      maxInlineEntries: 12,
    });

    expect(kbPackage({
      name: "default-namespace-kb",
      template: "src/package-templates/kb",
    }).distribution).toBeUndefined();
    expect(kbPackage({
      name: "default-assets-kb",
      template: "src/package-templates/kb",
    }).assets).toEqual({ delivery: "bundle" });
    expect(kbPackage({
      name: "optimized-assets-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "bundle", optimize: { processor: "sharp" } },
    }).assets).toEqual({
      delivery: "bundle",
      optimize: { processor: "sharp", mode: "lossless-webp" },
    });
    expect(kbPackage({
      name: "lossy-assets-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "bundle", optimize: { processor: "sharp", mode: "webp", quality: 88, maxDimension: 2400 } },
    }).assets).toEqual({
      delivery: "bundle",
      optimize: { processor: "sharp", mode: "webp", quality: 88, maxDimension: 2400 },
    });
    expect(() => kbPackage({
      name: "invalid-assets-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "bundle", optimize: { processor: "sharp", mode: "webp", quality: 0 } },
    })).toThrow(/assets\.optimize\.quality/);
    expect(() => kbPackage({
      name: "invalid-lossless-assets-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "bundle", optimize: { processor: "sharp", mode: "lossless-webp", quality: 80 } },
    })).toThrow(/only valid/);
    expect(() => kbPackage({
      name: "invalid-assets-size-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "bundle", optimize: { processor: "sharp", maxDimension: 0 } },
    })).toThrow(/assets\.optimize\.maxDimension/);
    expect(kbPackage({
      name: "git-assets-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "git-raw", urlPrefix: "https://example.test/org/repo/raw/{commit}/" },
    }).assets).toEqual({
      delivery: "git-raw",
      urlPrefix: "https://example.test/org/repo/raw/{commit}",
    });
    expect(kbPackage({
      name: "omitted-assets-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "omit" },
    }).assets).toEqual({ delivery: "omit" });
    expect(() => kbPackage({
      name: "invalid-git-assets-kb",
      template: "src/package-templates/kb",
      assets: { delivery: "git-raw", urlPrefix: "http://example.test/raw/main" },
    })).toThrow(/assets\.urlPrefix/);
    expect(kbPackage({
      name: "namespaced-kb",
      template: "src/package-templates/kb",
      distribution: { knowledgeNamespace: "personal-user.123/reference" },
    }).distribution).toEqual({ knowledgeNamespace: "personal-user.123/reference" });
    for (const knowledgeNamespace of [
      "Platform/docs",
      "platform//docs",
      "platform_docs/reference",
      ".platform/docs",
      "platform./docs",
      "platform..shared/docs",
      "platform.-shared/docs",
      "platform-.shared/docs",
      "/platform/docs",
      "platform/docs/",
      "platform/../docs",
      String.raw`platform\docs`,
      `platform/${"a".repeat(49)}`,
      "a".repeat(129),
    ]) {
      expect(() =>
        kbPackage({
          name: "invalid-namespace-kb",
          template: "src/package-templates/kb",
          distribution: { knowledgeNamespace },
        })
      ).toThrow(/distribution\.knowledgeNamespace/);
    }
    expect(() => defineProject({
      sources: [],
      phases: [],
      packages: [
        kbPackage({
          name: "first-kb",
          template: "src/package-templates/kb",
          distribution: { knowledgeNamespace: "shared/docs" },
        }),
        kbPackage({
          name: "second-kb",
          template: "src/package-templates/kb",
          distribution: { knowledgeNamespace: "shared/docs" },
        }),
      ],
    })).not.toThrow();
  });

  test("knowledge collection contracts are type checked", () => {
    const sampleLib = source("sample-lib");
    const docs = source("product-docs");

    const assertKnowledgeCollectionContracts = () => {
      // @ts-expect-error review requires explicit collection instead of implicit global draft review.
      reviewValidity();
      // @ts-expect-error review no longer accepts target fields.
      reviewValidity({ target: "wikis" });
      // @ts-expect-error TS extraction only targets the codegraph collection.
      extractTs({ source: sampleLib, collection: "business" });
      // @ts-expect-error document align only targets document mainline collections.
      alignProse({ source: docs, collection: "codegraph" });
      // @ts-expect-error feats is a namespace, not a document mainline collection.
      alignProse({ source: docs, collection: "feats" });
      // @ts-expect-error document compile only targets document mainline collections.
      compileProse({ source: docs, collection: "codegraph" });
      // @ts-expect-error OKF roots are package output roots, not compile collections.
      compileProse({ source: docs, collection: "wikis" });
      // @ts-expect-error no positional overload for document capture factories.
      captureFile(docs);
      // @ts-expect-error source types are repo/file/lark only.
      source("doc", { type: "note" });
      // @ts-expect-error source collections are repo/file/lark only.
      allSources("url");
      // @ts-expect-error packages use name instead of id.
      kbPackage({ id: "bad", template: "src/package-templates/kb" });
      reviewValidity({ collection: "feats" });
      llmsPackage({ name: "feats", template: "src/package-templates/llms", select: { collections: ["feats"] } });
      llmsPackage({
        name: "bad",
        template: "src/package-templates/llms",
        // @ts-expect-error package select.collections only accepts internal knowledge collections.
        select: { collections: ["wikis"] },
      });
      llmsPackage({
        name: "bad",
        template: "src/package-templates/llms",
        // @ts-expect-error package select.okfRoots only accepts OKF output roots.
        select: { okfRoots: ["architecture"] },
      });
    };

    expect(typeof assertKnowledgeCollectionContracts).toBe("function");
  });

  test("phase factories reject invalid collection values at runtime", () => {
    const sampleLib = source("sample-lib");
    const repoSource = source("sample-lib", { type: "repo" });
    const fileDocs = source("product-docs", { type: "file" });
    const handbook = source("handbook", { type: "lark" });

    expect(() =>
      extractTs({ source: sampleLib, collection: "invalid-collection" as never })
    ).toThrow(/extractTs collection must be codegraph/);
    try {
      extractTs({ source: sampleLib, collection: "codegraph", entries: [] });
      throw new Error("expected empty entries to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "NO_ENTRY_DETECTED" });
      expect((error as Error).message).toMatch(/entries must contain at least one source-relative file path/);
    }
    expect(() =>
      extractTs({ source: sampleLib, collection: "codegraph", entries: ["../outside.ts"] })
    ).toThrow(/entries must be source-relative file paths/);
    expect(() =>
      extractTs({ source: sampleLib, collection: "codegraph", mode: "scan", entries: ["src/index.ts"] })
    ).toThrow(/entries cannot be combined with mode: scan/);
    expect(() =>
      alignProse({ source: handbook, collection: "invalid-collection" as never })
    ).toThrow(/alignProse collection must be one of business, product, architecture, sop, faq, standards, decision, incident, test/);
    expect(() =>
      compileProse({ source: handbook, collection: "invalid-collection" as never })
    ).toThrow(/compileProse collection must be one of business, product, architecture, sop, faq, standards, decision, incident, test/);
    expect(() =>
      captureFile({ source: repoSource as never })
    ).toThrow(/captureFile source must reference a file source/);
    expect(() =>
      captureLark({ source: fileDocs as never })
    ).toThrow(/captureLark source must reference a lark source/);
    expect(() => captureLark({
      source: handbook,
      resources: { maxBytesPerResource: 0 },
    })).toThrow(/maxBytesPerResource must be a positive safe integer/);
    expect(() => captureLark({
      source: handbook,
      resources: { maxBytesPerResource: 1024, maxTotalBytes: 512 },
    })).toThrow(/maxTotalBytes must be a safe integer greater than or equal/);
    expect(() =>
      compileProse({ source: repoSource as never, collection: "architecture" })
    ).toThrow(/compileProse source must reference a file or lark source/);
    expect(() =>
      reviewValidity({ collection: "invalid-collection" as never })
    ).toThrow(/reviewValidity collection must be one of codegraph, business, product, architecture, sop, faq, standards, decision, incident, test/);
    expect(() =>
      reviewValidity({ scope: "collection" as never })
    ).toThrow(/reviewValidity scope must be all/);
  });

  test("collection constants separate internal routing from OKF output roots", () => {
    expect(DOC_MAINLINE_COLLECTIONS).toEqual([
      "business",
      "product",
      "architecture",
      "sop",
      "faq",
      "standards",
      "decision",
      "incident",
      "test",
    ]);
    expect(MAINLINE_COLLECTIONS).toEqual(["codegraph", ...DOC_MAINLINE_COLLECTIONS]);
    expect(KNOWLEDGE_COLLECTIONS).toEqual([...MAINLINE_COLLECTIONS, "feats"]);
    expect(TOP_LEVEL_NAMESPACES).toEqual([...MAINLINE_COLLECTIONS, "feats"]);
    expect(OKF_ROOTS).toEqual(["guides", "rules", "wikis", "feats"]);
  });

  test("document evidence protocol validates section metadata modes", () => {
    expect(DOCUMENT_COMPILE_ACTION_SCHEMA_VERSION).toBe("context.compile-actions.v1");
    expect(DOCUMENT_STRUCTURE_SCHEMA_VERSION).toBe("context.structure.v1");
    expect(DOCUMENT_SECTION_CONTENT_MODES).toEqual(["verbatim", "empty"]);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-1",
        kind: "spec",
        content_mode: "verbatim",
        source_ref: "src-1#span:Overview L1-10@abcdef123456",
      }, { stage: "candidate" })
    ).not.toThrow();

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-2",
        kind: "spec",
        content_mode: "verbatim",
        source_ref: "src-1#span:Overview L1-10@abcdef123456",
      }, { stage: "approved" })
    ).not.toThrow();

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-3",
        kind: "spec",
        content_mode: "verbatim",
        source_refs: ["src-1#span:Overview L1-10@abcdef123456"],
      }, { stage: "candidate" })
    ).not.toThrow();

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-4",
        kind: "placeholder",
        content_mode: "empty",
      }, { stage: "candidate" })
    ).not.toThrow();

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-4b",
        kind: "placeholder",
        content_mode: "empty",
        source_ref: "src-1#span:Overview L1-10@abcdef123456",
      }, { stage: "approved" })
    ).not.toThrow();

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-5",
        kind: "spec",
        content_mode: "verbatim",
        source_ref: "src-1#span:Overview L1-10@abcdef123456",
        content_source_digest: "sha256:unexpected",
      } as never, { stage: "candidate" })
    ).toThrow(/content_source_digest is not supported/);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-5b",
        kind: "spec",
        content_mode: "verbatim",
        source_refs: ["src-1#span:Overview L1-10@abcdef123456"],
      }, { stage: "approved" })
    ).toThrow(/source_refs is not supported for approved sections/);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-5c",
        kind: "spec",
        content_mode: "verbatim",
      }, { stage: "approved" })
    ).toThrow(/approved sections must carry exactly one source_ref/);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-5d",
        kind: "placeholder",
        content_mode: "empty",
      }, { stage: "approved" })
    ).toThrow(/approved sections must carry exactly one source_ref/);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-6",
        kind: "description",
        content_mode: "rewritten" as never,
        source_refs: ["src-1#span:Runtime L31-40@333333333333"],
      }, { stage: "approved" })
    ).toThrow(/content_mode must be one of/);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-8",
        kind: "placeholder",
        content_mode: "empty",
        source_ref: "src-1#span:Overview L1-10@abcdef123456",
      }, { stage: "candidate" })
    ).toThrow(/empty sections must not carry source refs/);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-9",
        kind: "example",
        content_mode: "mechanical" as never,
        source_ref: "src-1#span:Install L11-20@111111111111",
      }, { stage: "candidate" })
    ).toThrow(/content_mode must be one of/);

    expect(() =>
      assertDocumentEvidenceSectionMetadata({
        id: "section-11",
        kind: "spec",
        contentMode: "verbatim",
        sourceRef: "src-1#span:Overview L1-10@abcdef123456",
      } as never, { stage: "candidate" })
    ).toThrow(/content_mode must be one of/);
  });

});
