import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArticleStructureEntry, PackageDefinition } from "@c4a/context";
import { packageBuildInventory, packageScopedKnowledgeStructure, readKnowledgeStructure,
  type SelectedApprovedKnowledgeFile } from "../project/packageBuildInventory.js";

test("package inventory contains only selected articles and excludes production bookkeeping", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-package-articles-"));
  try {
    await mkdir(join(root, "knowledge"));
    const articles: ArticleStructureEntry[] = [
      { article_id: "alpha", path: "feats/feature/alpha.md", collection: "feats", visibility: "public", sections: [] },
      { article_id: "beta", path: "feats/experiment/beta.md", collection: "feats", visibility: "public", sections: [] },
      { article_id: "gamma", path: "architecture/gamma.md", collection: "architecture", visibility: "public", sections: [] },
    ];
    await writeFile(join(root, "knowledge/structure.yaml"), JSON.stringify({
      schema_version: "context.approved-structure.v1", articles,
      processed_scopes: [{ requirement_ref: "manual", source_ref: "file:docs", processed_version: "sha256:" + "a".repeat(64) }],
      material_gap_ledger: { entries: [{ answer_body: "private runtime" }] },
    }));
    const selected: SelectedApprovedKnowledgeFile[] = articles.slice(0, 2).map(article => ({
      relPath: article.path, absPath: join(root, "knowledge", article.path), article,
      content: "---\ntitle: " + article.article_id + "\ntype: Feature\ndescription: Reader instructions.\ntimestamp: 2026-09-12T00:00:00.000Z\n---\n",
      selectedBy: [{ kind: "collection", value: "feats" }],
    }));
    const original = await readKnowledgeStructure(root);
    const scoped = packageScopedKnowledgeStructure({ selected, structure: original });
    expect(scoped.parsed).toEqual({ schema_version: "context.approved-structure.v1", articles: articles.slice(0, 2) });
    const advanced = { ...original, parsed: { ...original.parsed,
      processed_scopes: [{ requirement_ref: "manual", source_ref: "file:docs", processed_version: "sha256:" + "b".repeat(64) }] } };
    expect(packageScopedKnowledgeStructure({ selected, structure: advanced }).sha256).toBe(scoped.sha256);
    const inventory = packageBuildInventory({
      pkg: { kind: "package.kb", name: "sample-kb", outDir: "dist/sample-kb", reads: [], writes: [],
        template: { path: "src/package-templates/kb", vars: {} },
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 } } as PackageDefinition,
      selected, structure: scoped, verifyEvidenceStatus: "pass",
    });
    const approved = inventory.approved_knowledge as { groups: unknown[]; collections: unknown[] };
    expect(approved.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "feature", internal_collection: "feats", count: 1 }),
      expect.objectContaining({ name: "experiment", internal_collection: "feats", count: 1 }),
    ]));
    expect(approved.collections).toEqual([expect.objectContaining({
      collection: "feats", internal_collection: "feats", okf_root: "feats", count: 2,
    })]);
    expect(inventory.structure).toMatchObject({ scope: "selected-package", articles: 2 });
    expect(inventory.structure).not.toHaveProperty("nodes");
    expect(inventory.structure).not.toHaveProperty("edge_records");
  } finally { await rm(root, { recursive: true, force: true }); }
});
