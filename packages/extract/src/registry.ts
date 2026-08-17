import type { ExtractionPlugin, SourceInfo } from "./protocol.js";

const MANIFEST_LANGUAGE_CANDIDATES: Record<string, string[]> = {
  "package.json": ["typescript", "tsx", "javascript", "jsx"],
  "pyproject.toml": ["python"],
  "Cargo.toml": ["rust"],
  "go.mod": ["go"],
  "pom.xml": ["java"],
};

export class ExtractionPluginRegistry {
  readonly #plugins: ExtractionPlugin[] = [];

  register(plugin: ExtractionPlugin): void {
    this.#plugins.push(plugin);
  }

  resolve(source: SourceInfo): ExtractionPlugin | null {
    const declaredLanguage = source.language?.toLowerCase();
    const manifestLanguages = new Set(
      source.manifests.flatMap((manifest) => MANIFEST_LANGUAGE_CANDIDATES[manifest.type] ?? [])
    );

    const candidates = this.#plugins.filter((plugin) => {
      const pluginLanguages = plugin.languages.map((language) => language.toLowerCase());
      if (declaredLanguage) {
        return pluginLanguages.includes(declaredLanguage);
      }
      if (manifestLanguages.size === 0) {
        return true;
      }
      return pluginLanguages.some((language) => manifestLanguages.has(language));
    });

    for (const plugin of candidates) {
      if (plugin.canHandle(source)) {
        return plugin;
      }
    }

    return null;
  }

  list(): ExtractionPlugin[] {
    return [...this.#plugins];
  }
}
