import { EdgeSource, EdgeType, Grounding, PackageKind, SymbolKind, Visibility } from "@c4a/core";
import type { EntryFile, EntryDetectionResult, ExtractionPlugin, ExtractionResult, FileSystem, ManifestInfo, SourceInfo, SymbolInfo } from "@c4a/extract";
import { indexGoSource } from "./parser.js";
import type { GoSymbolKind } from "./types.js";

function goModuleName(content: unknown): string {
  if (typeof content !== "object" || content === null) return "go-module";
  const raw = (content as { raw?: unknown }).raw;
  if (typeof raw !== "string") return "go-module";
  return /^\s*module\s+([^\s]+)\s*$/mu.exec(raw)?.[1] ?? "go-module";
}

function symbolKind(kind: GoSymbolKind): SymbolKind {
  if (kind === "struct") return SymbolKind.Class;
  if (kind === "interface") return SymbolKind.Interface;
  if (kind === "type") return SymbolKind.Type;
  if (kind === "method") return SymbolKind.Method;
  if (kind === "function") return SymbolKind.Function;
  return SymbolKind.Variable;
}

function symbolInfo(filePath: string, symbol: ReturnType<typeof indexGoSource>["symbols"][number]): SymbolInfo {
  return {
    name: symbol.qualifiedName,
    kind: symbolKind(symbol.kind),
    visibility: symbol.exported ? Visibility.Exported : Visibility.Internal,
    file: filePath,
    line: symbol.location.startLine,
    endLine: symbol.location.endLine,
    signature: symbol.signature,
    ...(symbol.doc ? { doc: symbol.doc } : {}),
  };
}

export class GoPlugin implements ExtractionPlugin {
  readonly id = "c4a-extract-go";
  readonly languages = ["go"];
  readonly packageManagers = ["go"];
  readonly manifestTypes: ManifestInfo["type"][] = ["go.mod"];
  #lastDetection: EntryDetectionResult | null = null;

  canHandle(source: SourceInfo): boolean {
    return source.manifests.some((manifest) => manifest.type === "go.mod");
  }

  async detectEntries(manifest: ManifestInfo, fs: FileSystem): Promise<EntryDetectionResult> {
    const entries: EntryFile[] = [];
    const visit = async (directory: string): Promise<void> => {
      let names: string[];
      try {
        names = await fs.readdir(directory);
      } catch {
        return;
      }
      for (const name of names.sort()) {
        const relativePath = directory === "." ? name : `${directory}/${name}`;
        if ([".git", "node_modules", "vendor"].includes(name)) continue;
        if (relativePath.endsWith(".go")) {
          if (!relativePath.endsWith("_test.go")) entries.push({ path: relativePath, subpath: entries.length === 0 ? "." : `./${relativePath.replace(/\.go$/u, "")}`, type: "service" });
          continue;
        }
        await visit(relativePath);
      }
    };
    await visit(".");
    const result: EntryDetectionResult = {
      package: {
        name: goModuleName(manifest.content),
        kind: PackageKind.Service,
        language: "go",
      },
      entries,
    };
    this.#lastDetection = result;
    return result;
  }

  async extractSymbols(entries: EntryFile[], fs: FileSystem): Promise<ExtractionResult> {
    const packageInfo = this.#lastDetection?.package;
    if (!packageInfo) throw new Error("GoPlugin.extractSymbols requires detectEntries to run first");
    const files = [];
    const symbols: SymbolInfo[] = [];
    const relations: ExtractionResult["relations"] = [];
    for (const entry of entries) {
      if (!entry.path.endsWith(".go")) continue;
      const source = await fs.readFile(entry.path);
      const indexed = indexGoSource(source, entry.path, { exportedOnly: false });
      files.push({ path: entry.path, language: "go", lines: indexed.lines });
      symbols.push(...indexed.symbols.map((symbol) => symbolInfo(entry.path, symbol)));
      for (const call of indexed.calls) {
        if (!call.enclosingSymbol) continue;
        relations.push({
          type: EdgeType.Calls,
          from: call.enclosingSymbol,
          to: call.callee,
          isExternal: call.importPath !== undefined,
          grounding: Grounding.Code,
          confidence: 1,
          source: EdgeSource.Ast,
          line: call.location.startLine,
        });
      }
      for (const route of indexed.routes) {
        symbols.push({
          name: `${route.method} ${route.path}`,
          kind: SymbolKind.Endpoint,
          visibility: Visibility.Exported,
          file: entry.path,
          line: route.location.startLine,
          endLine: route.location.endLine,
          signature: `${route.method} ${route.path} -> ${route.handler}`,
        });
      }
    }
    this.#lastDetection = null;
    const exportedSymbols = symbols.filter((symbol) => symbol.visibility === Visibility.Exported).length;
    return {
      version: "2",
      meta: { extractedAt: new Date().toISOString(), pluginId: this.id, commitHash: null, language: "go" },
      package: packageInfo,
      files,
      symbols,
      relations,
      stats: {
        files: files.length,
        lines: files.reduce((sum, file) => sum + file.lines, 0),
        exportedSymbols,
        internalSymbols: symbols.length - exportedSymbols,
        relations: relations.length,
      },
    };
  }
}
