export type ContentTypeCategory = "doc" | "code" | "package" | "binary";

export type ContentTypeDefinition = {
  id: string;
  category: ContentTypeCategory;
  match: {
    extensions?: string[];
    filenames?: string[];
  };
  cas: {
    encoding: "utf8" | "base64";
    hashInput: "content" | "identity";
  };
  pipeline: {
    digest: string[];
    extraction: string[];
  };
  display: {
    icon: string;
    renderer: "text" | "code" | "package-card" | "binary-preview";
  };
};

const DEFAULT_CONTENT_TYPES: ContentTypeDefinition[] = [
  {
    id: "markdown",
    category: "doc",
    match: { extensions: [".md", ".txt"] },
    cas: { encoding: "utf8", hashInput: "content" },
    pipeline: { digest: ["summary", "outline"], extraction: ["entities", "relations"] },
    display: { icon: "📄", renderer: "text" },
  },
  {
    id: "typescript",
    category: "code",
    match: { extensions: [".ts", ".tsx"] },
    cas: { encoding: "utf8", hashInput: "content" },
    pipeline: { digest: ["ast", "summary"], extraction: ["entities", "relations"] },
    display: { icon: "📜", renderer: "code" },
  },
  {
    id: "package",
    category: "package",
    match: { filenames: ["package.json", "go.mod", "pyproject.toml", "Cargo.toml", "pom.xml"] },
    cas: { encoding: "utf8", hashInput: "identity" },
    pipeline: { digest: ["summary"], extraction: ["entities", "relations"] },
    display: { icon: "📦", renderer: "package-card" },
  },
  {
    id: "pdf",
    category: "binary",
    match: { extensions: [".pdf"] },
    cas: { encoding: "base64", hashInput: "content" },
    pipeline: { digest: [], extraction: [] },
    display: { icon: "📕", renderer: "binary-preview" },
  },
  {
    id: "msword",
    category: "binary",
    match: { extensions: [".doc", ".docx"] },
    cas: { encoding: "base64", hashInput: "content" },
    pipeline: { digest: [], extraction: [] },
    display: { icon: "📘", renderer: "binary-preview" },
  },
  {
    id: "mspowerpoint",
    category: "binary",
    match: { extensions: [".ppt", ".pptx"] },
    cas: { encoding: "base64", hashInput: "content" },
    pipeline: { digest: [], extraction: [] },
    display: { icon: "📙", renderer: "binary-preview" },
  },
];

const normalizeExtension = (ext: string): string => ext.trim().toLowerCase();
const normalizeFilename = (name: string): string => name.trim().toLowerCase();

export class ContentTypeRegistry {
  private definitions: ContentTypeDefinition[];
  private extensionIndex: Map<string, ContentTypeDefinition>;
  private filenameIndex: Map<string, ContentTypeDefinition>;

  constructor(definitions: ContentTypeDefinition[]) {
    this.definitions = definitions;
    this.extensionIndex = new Map();
    this.filenameIndex = new Map();
    for (const def of definitions) {
      for (const ext of def.match.extensions ?? []) {
        this.extensionIndex.set(normalizeExtension(ext), def);
      }
      for (const name of def.match.filenames ?? []) {
        this.filenameIndex.set(normalizeFilename(name), def);
      }
    }
  }

  resolve(filename: string): ContentTypeDefinition | null {
    const baseName = filename.includes("/") ? filename.split("/").pop() ?? filename : filename;
    const normalized = normalizeFilename(baseName);
    const byName = this.filenameIndex.get(normalized);
    if (byName) return byName;

    const dot = normalized.lastIndexOf(".");
    if (dot < 0) return null;
    const ext = normalizeExtension(normalized.slice(dot));
    return this.extensionIndex.get(ext) ?? null;
  }

  getManifestFilenames(): string[] {
    const names = new Set<string>();
    for (const def of this.definitions) {
      if (def.category !== "package") continue;
      for (const name of def.match.filenames ?? []) {
        names.add(normalizeFilename(name));
      }
    }
    return Array.from(names);
  }

  getDefinitions(): ContentTypeDefinition[] {
    return [...this.definitions];
  }
}

export const defaultRegistry = new ContentTypeRegistry(DEFAULT_CONTENT_TYPES);
export const DEFAULT_CONTENT_TYPE_DEFINITIONS = DEFAULT_CONTENT_TYPES;
