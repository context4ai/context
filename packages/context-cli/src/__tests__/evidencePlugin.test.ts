import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { installEvidencePlugin, EVIDENCE_PLUGIN } from "../project/evidencePlugin.js";
import { initContextProject } from "../project/workspace.js";
import { approvedContextSectionsInMarkdown } from "../project/verifyContextSections.js";

const roots: string[] = [];
const artifact = resolve(import.meta.dir, "../../dist/evidence");
async function fixture() {
  const parent = resolve(import.meta.dir, "../../.tmp/evidence-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-")); roots.push(root);
  await mkdir(join(root, ".git"));
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("repository evidence installation", () => {
  test("shared Wasm fixtures retain the production section parser semantics", async () => {
    const cases = JSON.parse(await readFile(resolve(import.meta.dir, "../../../context-evidence-wasm/fixtures/sections.json"), "utf8")) as Array<{ text: string; ids?: string[]; error?: boolean }>;
    for (const item of cases) {
      if (item.error) expect(() => approvedContextSectionsInMarkdown(item.text)).toThrow();
      else expect(approvedContextSectionsInMarkdown(item.text).map(section => section.id)).toEqual(item.ids!);
    }
  });
  test("new repository initialization includes the bundled plugin without running configuration", async () => {
    const root = await fixture();
    const result = await initContextProject({ cwd: root, projectDir: ".", dev: true });
    expect(result.evidencePlugin?.status).toBe("installed");
    expect(result.created).toContain(join(root, EVIDENCE_PLUGIN));
    expect(await readFile(join(root, EVIDENCE_PLUGIN))).toEqual(await readFile(join(artifact, EVIDENCE_PLUGIN)));
  });
  test("installs actual artifact, repeats without writes, preserves custom content", async () => {
    const root = await fixture();
    const args = { projectRoot: root, artifactRoot: artifact };
    expect((await installEvidencePlugin(args)).status).toBe("installed");
    expect(await readFile(join(root, EVIDENCE_PLUGIN))).toEqual(await readFile(join(artifact, EVIDENCE_PLUGIN)));
    expect((await installEvidencePlugin(args)).status).toBe("unchanged");
    await writeFile(join(root, EVIDENCE_PLUGIN), "custom");
    expect((await installEvidencePlugin(args)).status).toBe("conflict");
    expect(await readFile(join(root, EVIDENCE_PLUGIN), "utf8")).toBe("custom");
  });
  test("nested workspace requires explicit actual repository root", async () => {
    const root = await fixture(); const project = join(root, "docs"); await mkdir(project);
    expect((await installEvidencePlugin({ projectRoot: project, artifactRoot: artifact })).status).toBe("needs-repository-root");
    expect((await installEvidencePlugin({ projectRoot: project, repositoryRoot: root, artifactRoot: artifact })).status).toBe("installed");
    await expect(installEvidencePlugin({ projectRoot: project, repositoryRoot: project, artifactRoot: artifact })).rejects.toThrow("actual enclosing Git root");
  });
  test("preserves symlinks", async () => {
    const root = await fixture(); const other = join(root, "other"); await writeFile(other, "keep");
    await symlink(other, join(root, EVIDENCE_PLUGIN));
    expect((await installEvidencePlugin({ projectRoot: root, artifactRoot: artifact })).status).toBe("conflict");
    expect(await readFile(other, "utf8")).toBe("keep");
  });
  test("registered content roots are explicit and cannot escape the repository", async () => {
    const root = await fixture(); const content = join(root, "docs"); await mkdir(content);
    expect((await installEvidencePlugin({ projectRoot: content, pluginRoot: content, artifactRoot: artifact })).status).toBe("installed");
    expect(await readFile(join(content, EVIDENCE_PLUGIN))).toEqual(await readFile(join(artifact, EVIDENCE_PLUGIN)));
    const sibling = join(root, "other"); await mkdir(sibling);
    await expect(installEvidencePlugin({ projectRoot: content, pluginRoot: sibling, artifactRoot: artifact })).rejects.toThrow("ancestor");
  });
  test("upgrades only a recognized official digest", async () => {
    const root = await fixture(); const bundle = join(root, ".tmp/bundle"); await mkdir(bundle, { recursive: true });
    const bytes = await readFile(join(artifact, EVIDENCE_PLUGIN));
    await writeFile(join(bundle, EVIDENCE_PLUGIN), bytes);
    const previous = Buffer.from("previous official artifact");
    const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    await writeFile(join(bundle, "manifest.json"), JSON.stringify({ sha256: digest(bytes), previous: [digest(previous)] }));
    await writeFile(join(root, EVIDENCE_PLUGIN), previous);
    expect((await installEvidencePlugin({ projectRoot: root, artifactRoot: bundle })).status).toBe("upgraded");
    expect(await readFile(join(root, EVIDENCE_PLUGIN))).toEqual(bytes);
  });
});
