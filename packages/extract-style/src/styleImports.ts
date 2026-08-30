import { posix } from "node:path";
import { indexerEvidenceAdapterProtocolDigest } from "@c4a/core";
import postcss, { type AtRule } from "postcss";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";
import type { StyleDiagnostic, StyleImport, StyleLocator } from "./styleTypes.js";

function meaningful(nodes: readonly ValueNode[]): ValueNode | undefined {
  return nodes.find((node) => node.type !== "space" && node.type !== "comment" && node.type !== "div");
}

function importSpecifier(value: string): string | null {
  const first = meaningful(valueParser(value).nodes);
  if (first === undefined) return null;
  if (first.type === "string" || first.type === "word") return first.value;
  if (first.type === "function" && first.value.toLowerCase() === "url") {
    const child = meaningful(first.nodes);
    return child?.type === "string" || child?.type === "word" ? child.value : null;
  }
  return null;
}

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function localCandidates(importer: string, specifier: string): string[] {
  const normalized = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (!portablePath(normalized)) return [];
  const extension = posix.extname(normalized).toLowerCase();
  if (extension.length > 0) {
    const base = posix.basename(normalized);
    return [normalized, posix.join(posix.dirname(normalized), `_${base}`)];
  }
  const directory = posix.dirname(normalized);
  const basename = posix.basename(normalized);
  return [
    `${normalized}.scss`,
    `${normalized}.css`,
    posix.join(directory, `_${basename}.scss`),
    posix.join(normalized, "index.scss"),
    posix.join(normalized, "_index.scss"),
  ];
}

function classifySpecifier(importer: string, specifier: string, files: Readonly<Record<string, string>>): Pick<StyleImport, "resolution" | "resolved_path" | "specifier"> {
  if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|#)/u.test(specifier)) {
    return { resolution: specifier.startsWith("sass:") ? "builtin" : "external", resolved_path: null, specifier: null };
  }
  const candidates = localCandidates(importer, specifier);
  const resolved = candidates.find((candidate) => Object.hasOwn(files, candidate));
  if (resolved !== undefined) return { resolution: "registered", resolved_path: resolved, specifier };
  if (specifier.startsWith(".")) return { resolution: "unresolved", resolved_path: null, specifier };
  return { resolution: "package-or-load-path", resolved_path: null, specifier };
}

function locator(path: string, rule: AtRule, qualifiedItemPath: string): StyleLocator {
  return { path, line: rule.source?.start?.line ?? 1, column: rule.source?.start?.column ?? 1, qualified_item_path: qualifiedItemPath };
}

export function collectStyleImports(input: {
  path: string;
  files: Readonly<Record<string, string>>;
  atRules: readonly AtRule[];
}): { imports: StyleImport[]; diagnostics: StyleDiagnostic[]; unsupported: boolean } {
  const imports: StyleImport[] = [];
  const diagnostics: StyleDiagnostic[] = [];
  let unsupported = false;
  for (const rule of input.atRules) {
    const name = rule.name.toLowerCase();
    if (name !== "import" && name !== "use" && name !== "forward") continue;
    const segments = name === "import" ? postcss.list.comma(rule.params) : [rule.params];
    for (const segment of segments) {
      const specifier = importSpecifier(segment);
      const ordinal = imports.length + 1;
      const currentLocator = locator(input.path, rule, `import:${ordinal}`);
      if (specifier === null || specifier.includes("#{")) {
        unsupported = true;
        diagnostics.push({ code: "style-import-dynamic-unsupported", severity: "error", locator: currentLocator, detail: `dynamic or unparseable @${name} source` });
        continue;
      }
      const classified = classifySpecifier(input.path, specifier, input.files);
      const item: StyleImport = {
        import_ref: `${input.path}#import:${ordinal}`,
        kind: name,
        specifier: classified.specifier,
        specifier_digest: indexerEvidenceAdapterProtocolDigest(specifier),
        resolution: classified.resolution,
        resolved_path: classified.resolved_path,
        locator: currentLocator,
      };
      imports.push(item);
      if (item.resolution === "unresolved") diagnostics.push({ code: "style-import-unresolved", severity: "warning", locator: currentLocator, detail: `relative style import is not registered: ${specifier}` });
    }
  }
  return { imports, diagnostics, unsupported };
}
