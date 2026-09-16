import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { kbPackage, updateKnowledgeMap } from "@c4a/context";
import { readSiteExtensions } from "../project/packageSiteExtensions.js";
import { writePackageSite, createSiteNavigation } from "../project/packageSite.js";

test("custom page navigation rejects unknown pages and knowledge section targets", () => {
  const pkg = kbPackage({ name: "custom", template: "src/templates", site: { extensions: { pages: { help: "help.md" } } } });
  for (const target of [{ artifact_ref: "site:missing" }, { artifact_ref: "site:help", section_key: "section" }]) {
    const map = updateKnowledgeMap(undefined, { expected_revision: null, upsert: [{ key: "custom", parent: null, title: "Custom", target }] });
    expect(() => createSiteNavigation(pkg, [], map)).toThrow();
  }
});

test("extension inputs are confined and changes invalidate the fingerprint", async () => {
  await mkdir(".tmp", { recursive: true });
  const root = await mkdtemp(".tmp/site-extension-input-");
  try {
    await mkdir(join(root, "src/site"), { recursive: true });
    await writeFile(join(root, "src/site/Panel.vue"), "<template>First</template>");
    const config = { slots: { banner: "Panel.vue" } };
    expect((await readSiteExtensions(root, { slots: { banner: false } })).digest).toBeNull();
    const before = await readSiteExtensions(root, config);
    await writeFile(join(root, "src/site/Panel.vue"), "<template>Second</template>");
    expect((await readSiteExtensions(root, config)).digest).not.toBe(before.digest);
    await expect(readSiteExtensions(root, { slots: { banner: "../outside.vue" } })).rejects.toThrow("unsafe");
    await symlink("Panel.vue", join(root, "src/site/linked.vue"));
    await expect(readSiteExtensions(root, config)).rejects.toThrow("symlink");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("custom homepage regions and navigable page build without executing floating browser code", async () => {
  await mkdir(".tmp", { recursive: true });
  const root = await mkdtemp(".tmp/site-extension-build-");
  try {
    await mkdir(join(root, "src/site"), { recursive: true });
    await writeFile(join(root, "src/site/Panel.vue"), "<template><section>Business panel marker</section></template>");
    await writeFile(join(root, "src/site/Chat.vue"), "<script>const width = window.innerWidth; export default {data: () => ({width})};</script><template><button>{{ width }}</button></template>");
    await writeFile(join(root, "src/site/help.md"), '---\ntitle: Custom support title\ndescription: Custom page description\n---\n# Business help marker\n\n<script setup>\nimport Panel from "./Panel.vue"\n</script>\n\n<Panel />\n');
    const pkg = kbPackage({ name: "extension-test", template: "src/templates", site: { base: "/docs/", extensions: {
      slots: { banner: "Panel.vue", knowledge: false, resources: false, footer: false, floating: "Chat.vue" },
      pages: { help: "help.md" },
    } } });
    const structure = updateKnowledgeMap(undefined, { expected_revision: null, upsert: [
      { key: "help", parent: null, title: "Support", target: { artifact_ref: "site:help" } },
    ] });
    expect(createSiteNavigation(pkg, [], structure).entries[0]?.href).toBe("/custom/help.html");
    await mkdir(join(root, pkg.outDir), { recursive: true });
    await writePackageSite({ projectRoot: root, pkg, selected: [], structure });
    const output = join(root, "dist/extension-test-site");
    const home = await readFile(join(output, "index.html"), "utf8");
    expect(home).toContain("Business panel marker");
    expect(home).not.toContain("Explore from the knowledge map");
    const page = await readFile(join(output, "custom/help.html"), "utf8");
    expect(page).toContain("Business help marker");
    expect(page).toContain("Business panel marker");
    expect(page).toContain("<title>Custom support title");
    const landingPath = /href="\/docs\/(sections\/[^"#]+\.html)"/.exec(home)?.[1];
    expect(landingPath).toBeDefined();
    expect(await readFile(join(output, landingPath!), "utf8")).toContain('/docs/custom/help.html');
    expect(await readFile(join(output, "llms-full.txt"), "utf8")).not.toContain("Business help marker");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
