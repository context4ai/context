import { approvedKnowledgeContentDigest } from "../project/approvedKnowledgeSnapshots.js";
import { initContextProject } from "../project/workspace.js";
import type { PackageDefinition } from "@c4a/context";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDocumentSnapshotManifest, computeDocumentContentHash } from "@c4a/extract";
import { approvedVisualResults, capturedVisualResources, readVisualConversionPreference, readVisualReceipts,
  renderVisualDecisions, removeConvertedVisualLinks, visualInputHash, type VisualDecision } from "../project/visualSourceProcessing.js";
import { projectKnowledgeAssets } from "../project/knowledgeAssets.js";
import { repairApprovedKnowledgeAssetProjections } from "../project/knowledgeAssetRepair.js";
import { projectPackageKnowledgeAssets } from "../project/packageAssets.js";
import { renderAgents } from "../project/workspaceGuidanceTemplates.js";

const body = "# Flow\n\nCaption: request then reply.\n\n![Flow](assets/flow.png)\n";
const bytes = Buffer.from("anonymous-image");
const manifest = createDocumentSnapshotManifest({ sourceType: "file", sourceName: "guide",
  capturedAt: "2026-09-10T00:00:00.000Z", files: [{ path: "index.md", bytes: body, title: "Flow" }],
  assets: [{ path: "assets/flow.png", content_hash: computeDocumentContentHash(bytes), media_type: "image/png", role: "evidence" },
    { path: "assets/private.png", content_hash: computeDocumentContentHash("private"), media_type: "image/png" }] });
const resources = (markdown = body, previous: Awaited<ReturnType<typeof approvedVisualResults>> = []) => capturedVisualResources({
  sourceRef: "file:guide", documentPath: "index.md", markdown, materializedAt: "sources/file/guide",
  manifest, previous });
const decision: VisualDecision = { resource: resources()[0]!.ref, context: ["Caption: request then reply."],
  requirements: "English; flow", disposition: "converted", format: "mermaid", markdown: "```mermaid\nflowchart LR\n A --> B\n```" };
async function fixture(run: (root: string) => Promise<void>) {
  const parent = join(import.meta.dir, "../../../../.tmp/visual-source-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "workspace-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe("source visual processing", () => {
  test("defaults enabled, explicit false, and editable bilingual style", async () => fixture(async root => {
    expect(await readVisualConversionPreference(root)).toBe(true);
    await writeFile(join(root, "package.json"), JSON.stringify({ context: { convertVisuals: false } }));
    expect(await readVisualConversionPreference(root)).toBe(false);
    await writeFile(join(root, "package.json"), JSON.stringify({ context: {} }));
    expect(await readVisualConversionPreference(root)).toBe(true);
    for (const language of ["en", "zh-CN"] as const) expect(renderAgents("Example", language)).toContain("1px");
  }));
  test("initialization writes the preference and preserves edited guidance", async () => fixture(async root => {
    const initialized = await initContextProject({ cwd: root, projectDir: ".", name: "visual-workspace", language: "en" });
    expect(JSON.parse(await readFile(join(initialized.projectRoot, "package.json"), "utf8")).context.convertVisuals).toBe(true);
    const policy = join(initialized.projectRoot, "AGENTS.md");
    await writeFile(policy, "# User style\nUse plain tables.");
    await initContextProject({ cwd: root, projectDir: ".", name: "visual-workspace", language: "en" });
    expect(await readFile(policy, "utf8")).toBe("# User style\nUse plain tables.");
  }));
  test("only linked resources are authorized, audit material excluded", () => {
    expect(resources().map(resource => resource.read_path)).toEqual(["sources/file/guide/assets/flow.png"]);
    expect(resources("No image")).toEqual([]);
  });
  test("accepted conversion survives restart and uses current revised body", async () => fixture(async root => {
    const first = renderVisualDecisions([decision], resources());
    expect(first.warnings).toEqual([]);
    await mkdir(join(root, "knowledge/docs"), { recursive: true });
    await writeFile(join(root, "knowledge/docs/flow.md"), first.markdown.replace("A --> B", "A -->|Request| B"));
    // Model the accepted file digest; unapproved on-disk edits must not be reused.
    const acceptedBody = await readFile(join(root, "knowledge/docs/flow.md"), "utf8");
    await writeFile(join(root, "knowledge/structure.yaml"), JSON.stringify({ approved_knowledge: [
      { path: "docs/flow.md", approved_content_digest: approvedKnowledgeContentDigest(acceptedBody) },
    ] }));
    const previous = await approvedVisualResults(root);
    expect(previous).toHaveLength(1);
    await writeFile(join(root, "knowledge/docs/flow.md"), acceptedBody + "\nUnapproved change");
    expect(await approvedVisualResults(root)).toEqual([]);
    await writeFile(join(root, "knowledge/docs/flow.md"), acceptedBody);
    const again = renderVisualDecisions([{ ...decision, markdown: undefined }], resources(body + "\nUnrelated change", previous));
    expect(again.markdown).toContain("A -->|Request| B");
    expect(again.warnings).toEqual([]);
    expect(readVisualReceipts(again.markdown)[0]!.receipt.input_hash).toBe(previous[0]!.receipt.input_hash);
    const contextChanged = resources(body.replace("request then reply", "reply before request"), previous);
    expect(contextChanged[0]!.previous).toEqual([]);
    const noReuse = renderVisualDecisions([{ ...decision, markdown: undefined }], contextChanged);
    expect(noReuse.warnings).toHaveLength(1);
    expect(noReuse.markdown).toContain("![Source resource]");
  }));
  test("presentation changes preserve input hash, source/context/requirements do not", () => {
    const first = readVisualReceipts(renderVisualDecisions([decision], resources()).markdown)[0]!;
    const restyled = readVisualReceipts(renderVisualDecisions([{ ...decision,
      markdown: decision.markdown!.replace("A --> B", "A -->|Request| B") }], resources()).markdown)[0]!;
    expect(restyled.receipt.input_hash).toBe(first.receipt.input_hash);
    for (const patch of [{ content_hash: computeDocumentContentHash("changed") }, { context: ["different"] }, { requirements: "table" }]) {
      expect(visualInputHash({ ...first.receipt, ...patch })).not.toBe(first.receipt.input_hash);
    }
    expect(readVisualReceipts("<!-- context:visual broken -->\nx\n<!-- /context:visual -->")).toEqual([]);
  });
  test("whiteboard structured input replaces its preview as a group and retains both on fallback", () => {
    const locator = "lark:whiteboard:anonymous";
    const whiteboard = { ...manifest, assets: [
      { path: "assets/board.json", content_hash: computeDocumentContentHash("{}"), role: "evidence" as const, source: { locator } },
      { path: "assets/board.png", content_hash: computeDocumentContentHash("preview"), role: "presentation" as const, media_type: "image/png", source: { locator } },
    ] };
    const markdown = "![Board](assets/board.png)\n[Raw](assets/board.json) <!-- lark:whiteboard:anonymous -->";
    const inputs = capturedVisualResources({ sourceRef: "file:guide", documentPath: "index.md", markdown,
      materializedAt: "sources/file/guide", manifest: whiteboard, previous: [] });
    const converted = renderVisualDecisions([{ ...decision, resource: inputs[0]!.ref, context: [] }], inputs);
    expect(removeConvertedVisualLinks(markdown, converted.markdown, inputs).trim()).toBe("");
    const retained = renderVisualDecisions([{ ...decision, resource: inputs[0]!.ref, context: [], disposition: "retained", format: "original" }], inputs);
    expect(retained.markdown).toContain("board.png");
    expect(retained.markdown).toContain("board.json");
    const accepted = readVisualReceipts(converted.markdown).map(result => ({ ...result, page: "knowledge/board.md" }));
    const previewChanged = capturedVisualResources({ sourceRef: "file:guide", documentPath: "index.md", markdown,
      materializedAt: "sources/new-location", manifest: { ...whiteboard, assets: [whiteboard.assets[0]!,
        { ...whiteboard.assets[1]!, content_hash: computeDocumentContentHash("new-preview") }] }, previous: accepted });
    expect(previewChanged[0]!.previous).toHaveLength(1); // JSON actually used is unchanged.
    expect(previewChanged[1]!.previous).toHaveLength(0);
    const both = renderVisualDecisions([{ ...decision, resource: inputs[0]!.ref, also_read: [inputs[1]!.ref], context: [] }], inputs);
    const bothReceipt = readVisualReceipts(both.markdown)[0]!.receipt;
    expect(bothReceipt.input_hash).not.toBe(accepted[0]!.receipt.input_hash);
    const invalidated = capturedVisualResources({ sourceRef: "file:guide", documentPath: "index.md", markdown,
      materializedAt: "sources/new-location", manifest: { ...whiteboard, assets: [whiteboard.assets[0]!,
        { ...whiteboard.assets[1]!, content_hash: computeDocumentContentHash("new-preview") }] },
      previous: [{ ...readVisualReceipts(both.markdown)[0]!, page: "knowledge/board.md" }] });
    expect(invalidated[0]!.previous).toHaveLength(0);
  });
  test("no capability, missing output and invalid context retain without blocking", () => {
    for (const attempt of [{ ...decision, markdown: undefined }, { ...decision, markdown: "unfinished" },
      { ...decision, context: ["invented caption"] }, { ...decision, disposition: "retained" as const, format: "original" as const, reason: "tool-unavailable" }]) {
      expect(renderVisualDecisions([attempt], resources()).markdown).toContain("![Source resource]");
    }
    expect(renderVisualDecisions([{ ...decision, resource: "unknown" }], resources()).warnings).toHaveLength(1);
  });
  test("converted output skips asset packaging; last-link removal cleans only orphan assets", async () => fixture(async root => {
    await mkdir(join(root, "sources/file/guide/assets"), { recursive: true });
    await writeFile(join(root, "sources/file/guide/assets/flow.png"), bytes);
    const input = { projectRoot: root, pageRelPath: "knowledge/docs/flow.md", sourceMaterializedAt: "sources/file/guide", documentPath: "index.md", manifest };
    const converted = await projectKnowledgeAssets({ ...input, content: renderVisualDecisions([decision], resources()).markdown });
    expect(converted.assets).toEqual([]);
    const packaged = await projectPackageKnowledgeAssets({ projectRoot: root, pkg: { kind: "package.kb", name: "example", outDir: "dist/example", reads: [], writes: [],
        template: { path: "src/package-templates/kb", vars: {} }, navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 } } as PackageDefinition,
      file: { relPath: "docs/flow.md", absPath: join(root, input.pageRelPath), content: converted.content }, content: converted.content });
    expect(packaged.assets).toEqual([]);
    const retained = await projectKnowledgeAssets({ ...input, content: renderVisualDecisions([{ ...decision, disposition: "retained", format: "original" }], resources()).markdown });
    expect(retained.assets).toHaveLength(1);
    const asset = retained.assets[0]!;
    await mkdir(join(root, "knowledge/assets/image"), { recursive: true });
    await mkdir(join(root, "knowledge/assets/resource"), { recursive: true });
    await writeFile(asset.absPath, asset.bytes);
    await mkdir(join(root, "knowledge/docs"), { recursive: true });
    await writeFile(join(root, "knowledge/docs/flow.md"), converted.content);
    await writeFile(join(root, "knowledge/docs/shared.md"), retained.content);
    expect((await repairApprovedKnowledgeAssetProjections(root)).removedAssets).toEqual([]);
    await writeFile(join(root, "knowledge/docs/shared.md"), "# No resource\n");
    expect((await repairApprovedKnowledgeAssetProjections(root)).removedAssets).toEqual([asset.relPath]);
    expect(await readFile(join(root, "sources/file/guide/assets/flow.png"))).toEqual(bytes);
  }));
});
