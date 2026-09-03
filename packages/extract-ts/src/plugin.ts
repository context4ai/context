import type { EntryFile, EntryDetectionResult, ExtractionPlugin, ExtractionResult, FileSystem, ManifestInfo, SourceInfo } from "@c4a/extract";
import { detectEntries } from "./entryDetector.js";
import { EXTRACT_TS_CAPABILITIES, EXTRACT_TS_COVERAGE_TIER } from "./ecmaScriptLanguage.js";
import { extractSymbols } from "./symbolExtractor.js";

export class TypeScriptPlugin implements ExtractionPlugin {
  readonly id = "c4a-extract-ts";
  readonly languages = ["typescript", "tsx", "javascript", "jsx"];
  readonly packageManagers = ["npm"];
  readonly capabilities = [...EXTRACT_TS_CAPABILITIES];
  readonly coverageTier = EXTRACT_TS_COVERAGE_TIER;
  readonly manifestTypes: ManifestInfo["type"][] = ["package.json"];

  #lastDetection: EntryDetectionResult | null = null;

  canHandle(source: SourceInfo) {
    return source.manifests.some((manifest) => manifest.type === "package.json");
  }

  async detectEntries(manifest: ManifestInfo, fs: FileSystem) {
    const result = await detectEntries(manifest, fs);
    this.#lastDetection = result;
    return result;
  }

  async extractSymbols(entries: EntryFile[], fs: FileSystem): Promise<ExtractionResult> {
    const packageInfo = this.#lastDetection?.package;
    if (!packageInfo) {
      throw new Error("TypeScriptPlugin.extractSymbols requires detectEntries to run first");
    }

    try {
      return await extractSymbols(entries, fs, {
        packageInfo,
        pluginId: this.id,
      });
    } finally {
      this.#lastDetection = null;
    }
  }

  async extractSymbolsInScope(
    entries: EntryFile[],
    analysisPaths: readonly string[],
    fs: FileSystem,
  ): Promise<ExtractionResult> {
    const packageInfo = this.#lastDetection?.package;
    if (!packageInfo) {
      throw new Error(
        "TypeScriptPlugin.extractSymbolsInScope requires detectEntries to run first",
      );
    }

    try {
      return await extractSymbols(entries, fs, {
        packageInfo,
        pluginId: this.id,
        analysisPaths,
      });
    } finally {
      this.#lastDetection = null;
    }
  }
}
