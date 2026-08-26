export type DocumentMainlineCollection =
  | "business"
  | "product"
  | "architecture"
  | "sop"
  | "faq"
  | "standards"
  | "decision"
  | "incident"
  | "test";
export type CodegraphCollection = "codegraph";
export type CodeIndexCollection = "codeindex" | CodegraphCollection;
export type MainlineCollection = CodeIndexCollection | DocumentMainlineCollection;
export type TopLevelNamespace = MainlineCollection | "feats";
export type OkfRoot = "guides" | "rules" | "wikis" | "feats";
export type KnowledgeCollection = TopLevelNamespace;
export type EntityStatus = "draft" | "approved" | "rejected" | "deprecated";
export type PackageKind = "kb" | "llms";
export type MarkdownTransform = (markdown: string) => string;

export type FileCaptureProcessorDefinition = {
  kind: "file.capture.processor.mdx-json-docs";
  include?: readonly string[];
  documentExtensions?: readonly string[];
  routeMetadataFile?: string;
};

export type PackageSelectDefinition = {
  collections?: readonly KnowledgeCollection[];
  okfRoots?: readonly OkfRoot[];
  include?: readonly string[];
  exclude?: readonly string[];
};

export type PackageNavigationDefinition = {
  foldDirectoryIndexes: boolean;
  maxInlineEntries: number;
};

export const DEFAULT_PACKAGE_NAVIGATION: Readonly<PackageNavigationDefinition> = {
  foldDirectoryIndexes: true,
  maxInlineEntries: 50,
};

export const DOC_MAINLINE_COLLECTIONS: readonly DocumentMainlineCollection[] = [
  "business",
  "product",
  "architecture",
  "sop",
  "faq",
  "standards",
  "decision",
  "incident",
  "test",
];
export const MAINLINE_COLLECTIONS: readonly MainlineCollection[] = ["codeindex", "codegraph", ...DOC_MAINLINE_COLLECTIONS];
export const TOP_LEVEL_NAMESPACES: readonly TopLevelNamespace[] = [...MAINLINE_COLLECTIONS, "feats"];
export const OKF_ROOTS: readonly OkfRoot[] = ["guides", "rules", "wikis", "feats"];
export const KNOWLEDGE_COLLECTIONS: readonly KnowledgeCollection[] = TOP_LEVEL_NAMESPACES;

export function assertKnowledgeCollection(value: string, field: string): asserts value is KnowledgeCollection {
  if (!(KNOWLEDGE_COLLECTIONS as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of ${KNOWLEDGE_COLLECTIONS.join(", ")}: ${value}`);
  }
}

export function assertDocumentMainlineCollection(value: string, field: string): asserts value is DocumentMainlineCollection {
  if (!(DOC_MAINLINE_COLLECTIONS as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of ${DOC_MAINLINE_COLLECTIONS.join(", ")}: ${value}`);
  }
}

export function assertMainlineCollection(value: string, field: string): asserts value is MainlineCollection {
  if (!(MAINLINE_COLLECTIONS as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of ${MAINLINE_COLLECTIONS.join(", ")}: ${value}`);
  }
}

export function assertTopLevelNamespace(value: string, field: string): asserts value is TopLevelNamespace {
  if (!(TOP_LEVEL_NAMESPACES as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of ${TOP_LEVEL_NAMESPACES.join(", ")}: ${value}`);
  }
}

export function assertOkfRoot(value: string, field: string): asserts value is OkfRoot {
  if (!(OKF_ROOTS as readonly string[]).includes(value)) {
    throw new TypeError(`${field} must be one of ${OKF_ROOTS.join(", ")}: ${value}`);
  }
}
