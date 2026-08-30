import { parseGraphQlSources } from "./graphQlParser.js";
import { parseOpenApiSources } from "./openApiParser.js";
import type { ContractDocumentCatalog } from "./contractTypes.js";

function portablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function excluded(path: string): ContractDocumentCatalog {
  return {
    path,
    format: "excluded",
    version: null,
    disposition: "excluded",
    endpoints: [],
    operations: [],
    types: [],
    references: [],
    diagnostics: [],
  };
}

/**
 * Parses one registered contract scope. GraphQL files in one invocation are
 * treated as one schema scope so extensions can resolve to an exact base.
 */
export function parseContractSources(
  files: Readonly<Record<string, string>>,
): ContractDocumentCatalog[] {
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  for (const [path, source] of entries) {
    if (!portablePath(path)) throw new TypeError(`contract source path is not portable: ${path}`);
    if (typeof source !== "string") throw new TypeError(`contract source must be text: ${path}`);
  }
  const normalizedFiles = Object.fromEntries(entries);
  const openApi = parseOpenApiSources(normalizedFiles);
  const graphQl = parseGraphQlSources(normalizedFiles);
  return entries.map(([path]) => graphQl.get(path) ?? openApi.get(path) ?? excluded(path));
}
