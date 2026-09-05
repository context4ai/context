import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import YAML from "yaml";
import { Visibility } from "@c4a/core";
import type { ExtractionResult } from "@c4a/extract";
import { TypeScriptPlugin } from "../../../extract-ts/src/plugin.js";
import { materializeProjectIndexerParserEntryInput } from
  "../project/indexerParserSourceMaterialization.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(manifest?: string) {
  const projectRoot = await mkdtemp(join(tmpdir(), "context-parser-source-scope-"));
  roots.push(projectRoot);
  const repository = join(projectRoot, "source");
  const component = join(repository, "widget");
  await mkdir(component, { recursive: true });
  await writeFile(join(component, "index.ts"), "export const Widget = (label: string) => label;\n");
  // A real parent package is deliberately outside the registered source root.
  await writeFile(join(repository, "package.json"), '{"name":"parent-package","main":"widget/index.ts"}');
  if (manifest !== undefined) await writeFile(join(component, "package.json"), manifest);
  await execFileAsync("git", ["init", "-q"], { cwd: repository });
  await execFileAsync("git", ["add", "package.json", "widget"], { cwd: repository });
  await execFileAsync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
    "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], { cwd: repository });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repository });
  await mkdir(join(projectRoot, "sources", "repo"), { recursive: true });
  await writeFile(join(projectRoot, "sources", "repo", "index.yaml"), YAML.stringify({
    sources: [{ name: "20260905", modules: [{
      name: "widget", materializedAt: "source/widget",
      git: { remote: "https://example.test/fixture.git", ref: stdout.trim() },
    }] }],
  }));
  return {
    component,
    materialize: (normalized_paths = ["index.ts"]) => materializeProjectIndexerParserEntryInput({
      projectRoot,
      entry_digest: `sha256:${"a".repeat(64)}`,
      capability: "parser.typescript",
      source_ref: "repo:20260905/widget",
      normalized_paths,
      loaded_module: { TypeScriptPlugin },
    }),
  };
}

describe("registered parser source directory", () => {
  test("accepts a manifest-free component without consulting its parent package", async () => {
    const { materialize } = await fixture();
    const result = await materialize();
    const extraction = result.prepared_input as ExtractionResult;
    expect(extraction.package.name).toBe("unknown-package");
    expect(extraction.files.map((file) => file.path)).toEqual(["index.ts"]);
    expect(extraction.symbols.find((symbol) => symbol.name === "Widget")?.visibility).toBe(Visibility.Internal);
  });

  test("retains public exports when a tracked manifest declares the entry", async () => {
    const { materialize } = await fixture('{"name":"widget-package","main":"index.ts","version":"1.0.0"}');
    const extraction = (await materialize()).prepared_input as ExtractionResult;
    expect(extraction.package.name).toBe("widget-package");
    expect(extraction.symbols.find((symbol) => symbol.name === "Widget")?.visibility).toBe(Visibility.Exported);
  });

  test("does not swallow an invalid tracked manifest", async () => {
    const { materialize } = await fixture("{invalid-json");
    await expect(materialize()).rejects.toBeInstanceOf(SyntaxError);
  });

  test("ignores untracked manifests and still rejects untracked source files", async () => {
    const { materialize, component } = await fixture();
    await writeFile(join(component, "package.json"), "{untracked-manifest");
    await writeFile(join(component, "extra.ts"), "export const extra = 1;\n");
    expect(((await materialize()).prepared_input as ExtractionResult).package.name).toBe("unknown-package");
    await expect(materialize(["extra.ts"])).rejects.toThrow("untracked source file");
  });
});
