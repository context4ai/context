import { test, expect } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PUBLISH_PACKAGES } from "../commands/releasePackages.js";
import { prepareDistPackageJson } from "../commands/publish.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("published libraries expose usable declarations without workspace source aliases", async () => {
  await mkdir(join(root, ".tmp"), { recursive: true });
  const fixture = await mkdtemp(join(root, ".tmp", "library-declarations-"));
  try {
    await writeFile(join(fixture, "package.json"), '{"type":"module"}\n');
    const imports: string[] = ["type IsAny<T> = 0 extends (1 & T) ? true : false;"];
    const packages = PUBLISH_PACKAGES.filter((pkg) => pkg.dir !== "context-cli");
    for (const [index, pkg] of packages.entries()) {
      const source = join(root, "packages", pkg.dir);
      const target = join(fixture, "node_modules", pkg.name);
      await cp(join(source, "dist"), target, { recursive: true });
      const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8")) as { version: string };
      await prepareDistPackageJson({
        projectRoot: root, info() {}, success() {}, warn() {}, error() {},
        async waitForInput() { return ""; },
      }, source, target, manifest.version, pkg.dir);
      const published = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as { types?: string; dependencies?: Record<string, string> };
      expect(published.types).toBe("./index.d.ts");
      const require = createRequire(join(source, "package.json"));
      for (const name of Object.keys(published.dependencies ?? {})) {
        let dependencyRoot = dirname(require.resolve(name));
        while (true) {
          const dependency = await readFile(join(dependencyRoot, "package.json"), "utf8").then(JSON.parse, () => null) as { name?: string } | null;
          if (dependency?.name === name) break;
          const parent = dirname(dependencyRoot);
          if (parent === dependencyRoot) throw new Error(`Cannot locate declared dependency ${name}`);
          dependencyRoot = parent;
        }
        const destination = join(target, "node_modules", name);
        await mkdir(dirname(destination), { recursive: true });
        await symlink(dependencyRoot, destination, "dir");
      }
      imports.push(`import * as lib${index} from ${JSON.stringify(pkg.name)};`);
      imports.push(`const typed${index}: IsAny<typeof lib${index}> = false;`);
    }
    if (packages.some((pkg) => pkg.name === "@c4a/extract-proto")) {
      imports.push(
        'import { parseProtoSources } from "@c4a/extract-proto";',
        'const documents = parseProtoSources({ "demo.proto": "syntax = \\\"proto3\\\";" });',
        "// @ts-expect-error Unknown fields must not become any after publication.",
        "documents[0]!.notARealField;",
      );
    }
    const entry = join(fixture, "consumer.ts");
    await writeFile(entry, imports.join("\n"));
    const require = createRequire(await realpath(join(root, "node_modules", "bun-types", "package.json")));
    const nodeTypes = dirname(require.resolve("@types/node/package.json"));
    await mkdir(join(fixture, "node_modules", "@types"), { recursive: true });
    await symlink(nodeTypes, join(fixture, "node_modules", "@types", "node"), "dir");
    const program = ts.createProgram([entry], {
      strict: true, noEmit: true, skipLibCheck: false, types: ["node"],
      typeRoots: [join(fixture, "node_modules", "@types")],
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    });
    const errors = ts.getPreEmitDiagnostics(program);
    expect(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name, getCurrentDirectory: () => fixture,
      getNewLine: () => "\n",
    })).toBe("");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 120_000);
