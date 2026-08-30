import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EdgeSource, EdgeType, Grounding, PackageKind, SymbolKind, Visibility } from "@c4a/core";
import type { FileSystem, ManifestInfo, SourceInfo } from "@c4a/extract";
import { goExtractionToEvidenceAdapterResult } from "../evidenceAdapter.js";
import { GoPlugin } from "../plugin.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

class DirectoryFileSystem implements FileSystem {
  constructor(private readonly root: string) {}
  private resolve(file: string): string { return path.join(this.root, file); }
  readFile(file: string): Promise<string> { return readFile(this.resolve(file), "utf8"); }
  readdir(directory: string): Promise<string[]> { return readdir(this.resolve(directory)); }
  async exists(file: string): Promise<boolean> {
    try { await access(this.resolve(file)); return true; } catch { return false; }
  }
  async readJson<T = unknown>(file: string): Promise<T> { return JSON.parse(await this.readFile(file)) as T; }
}

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("GoPlugin", () => {
  test("detects a Go module and emits ExtractionResult v2 with endpoints and grounded calls", async () => {
    root = await mkdtemp(path.join(tmpdir(), "extract-go-plugin-"));
    await mkdir(path.join(root, "api"), { recursive: true });
    await mkdir(path.join(root, "vendor", "ignored"), { recursive: true });
    await writeFile(path.join(root, "go.mod"), "module example.org/catalog\n\ngo 1.23\n");
    await writeFile(path.join(root, "api", "routes.go"), `package api
import "github.com/gin-gonic/gin"
func Register(router *gin.Engine) { router.GET("/items", List) }
func List() { helper.Run() }
func privateHelper() {}
`);
    await writeFile(path.join(root, "api", "routes_test.go"), "package api\nfunc TestRoutes() {}\n");
    await writeFile(path.join(root, "vendor", "ignored", "vendor.go"), "package ignored\nfunc Hidden() {}\n");
    const fs = new DirectoryFileSystem(root);
    const plugin = new GoPlugin();
    const manifest: ManifestInfo = { type: "go.mod", path: "go.mod", content: { raw: await fs.readFile("go.mod") } };
    const source: SourceInfo = { path: root, manifests: [manifest] };

    expect(plugin.canHandle(source)).toBe(true);
    expect(plugin.canHandle({ path: root, manifests: [] })).toBe(false);
    const detected = await plugin.detectEntries(manifest, fs);
    expect(detected.package).toEqual({ name: "example.org/catalog", kind: PackageKind.Service, language: "go" });
    expect(detected.entries.map((entry) => entry.path)).toEqual(["api/routes.go"]);

    const result = await plugin.extractSymbols(detected.entries, fs);
    expect(result.version).toBe("2");
    expect(result.meta).toMatchObject({ pluginId: "c4a-extract-go", language: "go", commitHash: null });
    expect(result.files).toEqual([{ path: "api/routes.go", language: "go", lines: 6 }]);
    expect(result.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Register", kind: SymbolKind.Function, visibility: Visibility.Exported }),
      expect.objectContaining({ name: "privateHelper", kind: SymbolKind.Function, visibility: Visibility.Internal }),
      expect.objectContaining({ name: "GET /items", kind: SymbolKind.Endpoint, signature: "GET /items -> List" }),
    ]));
    expect(result.relations).toContainEqual(expect.objectContaining({
      type: EdgeType.Calls,
      from: "List",
      to: "helper.Run",
      grounding: Grounding.Code,
      source: EdgeSource.Ast,
      confidence: 1,
    }));
    expect(result.stats).toMatchObject({ files: 1, exportedSymbols: 3, internalSymbols: 1 });
    expect(result.coverage).toEqual({
      tier: "ast-catalog",
      capabilities: ["go-ast", "go-call-relations", "go-http-routes", "parser.go"],
      files: [{ path: "api/routes.go", disposition: "analyzed", diagnosticCodes: [] }],
      diagnostics: [],
    });

    const evidence = goExtractionToEvidenceAdapterResult(result, {
      adapter: {
        id: "extract-go",
        package: "@c4a/extract-go",
        export: "goExtractionToEvidenceAdapterResult",
        version: "0.7.0",
        digest: DIGEST_A,
      },
      authorized_scope: {
        source_ref: "repo:catalog",
        module_refs: ["module:api"],
        scope_digest: DIGEST_B,
      },
      module_ref: "module:api",
      input_digest: DIGEST_B,
      precedence: 100,
    });
    expect(evidence.protocol).toBe("context.indexer.evidence-adapter-result/v1");
    expect(evidence.files[0]).toMatchObject({
      normalized_path: "api/routes.go",
      role: "primary-owner",
      coverage_tier: "ast-catalog",
      disposition: "analyzed",
    });
    expect(evidence.files[0]?.facts.some((fact) => fact.denominator === "symbol")).toBe(true);
  });

  test("requires entry detection before extraction", async () => {
    const plugin = new GoPlugin();
    const fs = new DirectoryFileSystem(tmpdir());
    await expect(plugin.extractSymbols([], fs)).rejects.toThrow("requires detectEntries");
  });
});
