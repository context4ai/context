import { describe, expect, test } from "bun:test";

import { defaultRegistry } from "../contentTypeRegistry.js";

describe("ContentTypeRegistry", () => {
  test("resolve matches known types", () => {
    expect(defaultRegistry.resolve("README.md")?.id).toBe("markdown");
    expect(defaultRegistry.resolve("notes.txt")?.id).toBe("markdown");
    expect(defaultRegistry.resolve("index.ts")?.id).toBe("typescript");
    expect(defaultRegistry.resolve("index.mts")?.id).toBe("typescript");
    expect(defaultRegistry.resolve("index.js")?.id).toBe("javascript");
    expect(defaultRegistry.resolve("view.jsx")?.id).toBe("javascript");
    expect(defaultRegistry.resolve("index.cjs")?.id).toBe("javascript");
    expect(defaultRegistry.resolve("package.json")?.id).toBe("package");
    expect(defaultRegistry.resolve("Cargo.toml")?.id).toBe("package");
    expect(defaultRegistry.resolve("report.pdf")?.id).toBe("pdf");
    expect(defaultRegistry.resolve("doc.docx")?.id).toBe("msword");
    expect(defaultRegistry.resolve("slides.pptx")?.id).toBe("mspowerpoint");
  });

  test("resolve returns null for unknown types", () => {
    expect(defaultRegistry.resolve("image.png")).toBeNull();
    expect(defaultRegistry.resolve("README")).toBeNull();
    expect(defaultRegistry.resolve("")).toBeNull();
  });

  test("resolve handles multi-dot filenames", () => {
    expect(defaultRegistry.resolve("archive.tar.md")?.id).toBe("markdown");
    expect(defaultRegistry.resolve("component.spec.tsx")?.id).toBe("typescript");
    expect(defaultRegistry.resolve("component.spec.jsx")?.id).toBe("javascript");
  });

  test("getManifestFilenames returns all package manifests", () => {
    expect(defaultRegistry.getManifestFilenames().sort()).toEqual(
      ["cargo.toml", "go.mod", "package.json", "pom.xml", "pyproject.toml"].sort(),
    );
  });
});
