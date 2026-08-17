import { describe, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readDocumentSourcesRegistry } from "../project/documentSources.js";
import { expectContextError, makeProjectRoot } from "./documentSourcesV062Helpers.js";

describe("0.6.2 document source registry validation", () => {
  test("return ContextError for invalid document registry metadata", async () => {
    const root = await makeProjectRoot();
    try {
      await writeFile(join(root, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: product-docs",
        "    local: /tmp/docs",
        "",
      ].join("\n"), "utf8");
      await expectContextError(readDocumentSourcesRegistry(root), /invalid local/);

      await writeFile(join(root, "sources", "file", "index.yaml"), "sources: []\n", "utf8");
      await writeFile(join(root, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "",
      ].join("\n"), "utf8");
      await expectContextError(readDocumentSourcesRegistry(root), /exactly one of url, docToken, or wikiToken/);

      await writeFile(join(root, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: handbook",
        "    url: https://example.larksuite.com/docx/a",
        "    docToken: doc-token",
        "",
      ].join("\n"), "utf8");
      await expectContextError(readDocumentSourcesRegistry(root), /exactly one of url, docToken, or wikiToken/);

      await writeFile(join(root, "sources", "file", "index.yaml"), [
        "sources:",
        "  - name: shared",
        "    local: ../docs",
        "",
      ].join("\n"), "utf8");
      await writeFile(join(root, "sources", "lark", "index.yaml"), [
        "sources:",
        "  - name: shared",
        "    url: https://example.larksuite.com/wiki/shared",
        "",
      ].join("\n"), "utf8");
      await expectContextError(readDocumentSourcesRegistry(root), /Duplicate source identifier "shared"/);

      await writeFile(join(root, "sources", "file", "index.yaml"), "files: []\n", "utf8");
      await writeFile(join(root, "sources", "lark", "index.yaml"), "sources: []\n", "utf8");
      await expectContextError(readDocumentSourcesRegistry(root), /Unrecognized key/);

      await writeFile(join(root, "sources", "file", "index.yaml"), "sources: []\nunknown: true\n", "utf8");
      await expectContextError(readDocumentSourcesRegistry(root), /Unrecognized key/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
