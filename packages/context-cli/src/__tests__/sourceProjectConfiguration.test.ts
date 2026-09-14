import { expect, test } from "bun:test";
import ts from "typescript";
import { generateSourceConfiguration } from "../project/sourceProjectConfiguration.js";
import { renderProjectEntry } from "../project/workspaceGuidanceTemplates.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { initContextProject, loadContextProjectModule } from "../project/workspace.js";
import { invokeCliInDir } from "./documentSourcesV062Helpers.js";

const selected = [{ type: "lark" as const, name: "20260914/guide" }, { type: "file" as const, name: "20260914/faq" }];

test("both workspace starters generate explicit capture configuration and append idempotently", () => {
  for (const language of ["en", "zh-CN"] as const) {
    const initial = renderProjectEntry(language);
    const output = generateSourceConfiguration(initial, selected)!;
    expect(output).toBeDefined();
    expect(ts.transpileModule(output, { reportDiagnostics: true }).diagnostics).toEqual([]);
    expect(output).toContain('captureLark({ source: source("20260914/guide"');
    expect(output).toContain('captureFile({ source: source("20260914/faq"');
    expect(generateSourceConfiguration(output, selected)).toBe(output);
    const appended = generateSourceConfiguration(output, [{ type: "repo", name: "20260914/module" }])!;
    expect(appended).toContain('source("20260914/module", { type: "repo" })');
    expect(generateSourceConfiguration(appended, selected)).toBe(appended);
    expect(ts.transpileModule(appended, { reportDiagnostics: true }).diagnostics).toEqual([]);
  }
});

test("preserves custom resource options, aliases, output configuration and comments", () => {
  const text = `import { defineProject as project, source as s, captureLark as capture } from "@c4a/context";
const doc = s("20260914", "guide", { type: "lark" });
export default project({
  sources: [doc, /* retain */],
  phases: [capture({source: doc, resources: {videos: "reference-only"}}),],
  packages: [myPackage({ name: "custom" })],
});`;
  expect(generateSourceConfiguration(text, [selected[0]!])).toBe(text);
  const output = generateSourceConfiguration(text, selected)!;
  expect(output).toContain('resources: {videos: "reference-only"}');
  expect(output).toContain('packages: [myPackage({ name: "custom" })]');
  expect(output).toContain("/* retain */");
  expect(ts.transpileModule(output, { reportDiagnostics: true }).diagnostics).toEqual([]);
});

test("dynamic arrays, custom phases and import collisions decline automatic editing", () => {
  const starter = renderProjectEntry("en");
  for (const text of [starter.replace("sources: []", "sources: [...allSources('lark')]"),
    starter.replace("phases: []", "phases: [customPhase('x', () => {})]"),
    `const source = 1;\n${starter}`, starter.replace("sources: []", "sources: getSources()")]) {
    expect(generateSourceConfiguration(text, selected)).toBeUndefined();
  }
});

test("ambiguous source types never generate an additional declaration", () => {
  for (const reference of [
    'source("20260914/guide")',
    'source("20260914/guide", {type: "file", ...overrides})',
    'source("20260914/guide", {...overrides, type: "lark"})',
    'source("20260914/guide", {type: "file", type: "lark"})',
    'source("20260914/guide", {type: "file", [key]: "lark"})',
    'source("20260914/guide", options)',
  ]) {
    const entry = `import {defineProject, source} from "@c4a/context";
export default defineProject({sources: [${reference}], phases: [], packages: []});`;
    expect(generateSourceConfiguration(entry, selected)).toBeUndefined();
  }
});

test("namespace/module repo default and explicit quoted type remain recognizable", () => {
  const entry = `import {defineProject, source} from "@c4a/context";
export default defineProject({sources: [source("20260914", "module"), source("20260914/guide", {"type": "lark"})], phases: [], packages: []});`;
  expect(generateSourceConfiguration(entry, [{type: "repo", name: "20260914/module"}])).toBe(entry);
  const output = generateSourceConfiguration(entry, [selected[0]!])!;
  expect(output).toContain("captureLark");
  expect(generateSourceConfiguration(output, [selected[0]!])).toBe(output);
});

test("CLI opt-in configures only selected registrations and preserves custom entries", async () => {
  const temporary = resolve(import.meta.dir, "../../../../.tmp/source-config");
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(join(temporary, "workspace-"));
  try {
    const { projectRoot } = await initContextProject({ cwd: root, projectDir: "context", dev: true });
    const entry = join(projectRoot, "src/index.ts");
    const register = (module: string, configure: boolean) => invokeCliInDir(projectRoot,
      ["source", "add", "lark", "20260914", "--module", module, "--wiki-token", `token-${module}`,
        ...(configure ? ["--configure"] : []), "--format", "json"]);
    expect((await register("unselected", false)).status).toBe(0);
    const result = await register("guide", true);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).configuration.status).toBe("configured");
    const configured = await readFile(entry, "utf8");
    expect(configured).not.toContain("unselected");
    expect(JSON.parse((await register("guide", true)).stdout).configuration.status).toBe("unchanged");
    const project = await loadContextProjectModule(projectRoot);
    expect(project).toBeDefined();
    const batchFile = join(projectRoot, ".tmp/batch.json");
    await writeFile(batchFile, JSON.stringify({ sources: [{ type: "lark", module: "second", wikiToken: "second-token" }] }));
    const batch = await invokeCliInDir(projectRoot, ["source", "add", "batch", "20260914", "--input", batchFile,
      "--configure", "--format", "json"]);
    expect(batch.status).toBe(0);
    expect(JSON.parse(batch.stdout).configuration.status).toBe("configured");
    expect(await readFile(entry, "utf8")).toContain("20260914/second");
    await loadContextProjectModule(projectRoot);
    const custom = configured.replace("phases: [", "phases: [/* custom */ ...[],");
    await writeFile(entry, custom);
    const fallback = await register("another", true);
    expect(fallback.status).toBe(0);
    expect(JSON.parse(fallback.stdout).configuration.status).toBe("manual");
    expect(await readFile(entry, "utf8")).toBe(custom);
    expect(await readFile(join(projectRoot, "sources/lark/index.yaml"), "utf8")).toContain("another");
    for (const reference of ['source("20260914/guide")',
      'source("20260914/guide", {type: "file", ...overrides})']) {
      const edited = `import {defineProject, source} from "@c4a/context";
export default defineProject({sources: [${reference}], phases: [], packages: []});`;
      await writeFile(entry, edited);
      const declined = await register("guide", true);
      expect(declined.status).toBe(0);
      expect(JSON.parse(declined.stdout).configuration.status).toBe("manual");
      expect(await readFile(entry, "utf8")).toBe(edited);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
