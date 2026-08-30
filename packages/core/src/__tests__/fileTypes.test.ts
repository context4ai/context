import { describe, expect, test } from "bun:test";

import {
  INDEXABLE_CODE_EXTENSIONS,
  INDEXABLE_DOC_EXTENSIONS,
  TEXT_EXTENSIONS,
  UPLOAD_ALLOWED_EXTENSIONS,
  isIndexableFile,
} from "../fileTypes.js";

describe("fileTypes", () => {
  test("derives indexable extensions from registry", () => {
    expect(INDEXABLE_CODE_EXTENSIONS.has(".ts")).toBe(true);
    expect(INDEXABLE_CODE_EXTENSIONS.has(".tsx")).toBe(true);
    expect(INDEXABLE_CODE_EXTENSIONS.has(".js")).toBe(true);
    expect(INDEXABLE_CODE_EXTENSIONS.has(".jsx")).toBe(true);
    expect(INDEXABLE_CODE_EXTENSIONS.has(".mjs")).toBe(true);
    expect(INDEXABLE_CODE_EXTENSIONS.has(".cjs")).toBe(true);
    expect(INDEXABLE_DOC_EXTENSIONS.has(".md")).toBe(true);
  });

  test("derives text/uploadable extensions from registry", () => {
    expect(TEXT_EXTENSIONS.has(".md")).toBe(true);
    expect(TEXT_EXTENSIONS.has(".ts")).toBe(true);
    expect(TEXT_EXTENSIONS.has(".tsx")).toBe(true);
    expect(TEXT_EXTENSIONS.has(".js")).toBe(true);
    expect(UPLOAD_ALLOWED_EXTENSIONS.has(".md")).toBe(true);
    expect(UPLOAD_ALLOWED_EXTENSIONS.has(".ts")).toBe(true);
    expect(UPLOAD_ALLOWED_EXTENSIONS.has(".pdf")).toBe(true);
    expect(UPLOAD_ALLOWED_EXTENSIONS.has(".doc")).toBe(true);
    expect(UPLOAD_ALLOWED_EXTENSIONS.has(".docx")).toBe(true);
    expect(UPLOAD_ALLOWED_EXTENSIONS.has(".ppt")).toBe(true);
    expect(UPLOAD_ALLOWED_EXTENSIONS.has(".pptx")).toBe(true);
  });

  test("isIndexableFile uses registry resolve", () => {
    const manifests = new Set<string>();
    expect(isIndexableFile("README.md", manifests)).toBe(true);
    expect(isIndexableFile("index.ts", manifests)).toBe(true);
    expect(isIndexableFile("index.js", manifests)).toBe(true);
    expect(isIndexableFile("package.json", manifests)).toBe(true);
    expect(isIndexableFile("image.png", manifests)).toBe(false);
  });
});
