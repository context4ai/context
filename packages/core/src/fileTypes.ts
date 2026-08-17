/**
 * Centralized file-type whitelists derived from ContentTypeRegistry.
 *
 * Three categories:
 *  - **Indexable** — files the extract engine can parse and model.
 *  - **Uploadable** — files users can upload as documents (including non-indexable formats).
 *  - **Text** — subset of uploadable files that are plain-text (read as UTF-8, not base64).
 */

import { DEFAULT_CONTENT_TYPE_DEFINITIONS, defaultRegistry } from "./contentTypeRegistry.js";

const collectExtensions = (
  predicate: (definition: (typeof DEFAULT_CONTENT_TYPE_DEFINITIONS)[number]) => boolean,
): Set<string> => {
  const extensions = new Set<string>();
  for (const definition of DEFAULT_CONTENT_TYPE_DEFINITIONS) {
    if (!predicate(definition)) continue;
    for (const ext of definition.match.extensions ?? []) {
      extensions.add(ext.toLowerCase());
    }
  }
  return extensions;
};

// ---------------------------------------------------------------------------
// Indexable source-code extensions (tree-sitter parsers available)
// ---------------------------------------------------------------------------
export const INDEXABLE_CODE_EXTENSIONS = collectExtensions(
  (definition) => definition.category === "code",
);

// ---------------------------------------------------------------------------
// Indexable document extensions
// ---------------------------------------------------------------------------
export const INDEXABLE_DOC_EXTENSIONS = collectExtensions(
  (definition) => definition.category === "doc",
);

// ---------------------------------------------------------------------------
// All indexable file extensions (code + doc, excluding manifests)
// ---------------------------------------------------------------------------
export const INDEXABLE_EXTENSIONS = new Set([
  ...INDEXABLE_CODE_EXTENSIONS,
  ...INDEXABLE_DOC_EXTENSIONS,
]);

// ---------------------------------------------------------------------------
// Uploadable file extensions (user can upload through the web UI)
// ---------------------------------------------------------------------------
export const UPLOAD_ALLOWED_EXTENSIONS = collectExtensions(() => true);

// ---------------------------------------------------------------------------
// Text file extensions — read as UTF-8; everything else is base64
// ---------------------------------------------------------------------------
export const TEXT_EXTENSIONS = collectExtensions(
  (definition) => definition.cas.encoding === "utf8",
);

// ---------------------------------------------------------------------------
// Upload limits
// ---------------------------------------------------------------------------
export const UPLOAD_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const UPLOAD_MAX_FILES = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract lower-case extension including the dot. */
export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Check whether a file name represents an indexable file.
 * Matches against both extension-based sets and manifest file names.
 */
export function isIndexableFile(fileName: string, manifestFiles: Set<string>): boolean {
  void manifestFiles;
  const baseName = fileName.includes("/") ? fileName.split("/").pop()! : fileName;
  return defaultRegistry.resolve(baseName) !== null;
}
