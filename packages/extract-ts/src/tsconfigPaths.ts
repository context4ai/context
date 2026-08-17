import { posix } from "node:path";
import type { FileSystem } from "@c4a/extract";

export interface TsConfigPathMapping {
  pattern: string;
  prefix: string;
  suffix: string;
  targets: string[];
}

export interface TsConfigPathResolver {
  baseUrl?: string;
  mappings: TsConfigPathMapping[];
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        output += "  ";
        index++;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index++;
      continue;
    }
    output += char;
  }
  return output;
}

function stripTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index] ?? "";
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let cursor = index + 1;
      while (/\s/u.test(input[cursor] ?? "")) cursor++;
      if (input[cursor] === "}" || input[cursor] === "]") continue;
    }
    output += char;
  }
  return output;
}

function parseJsonConfig(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(raw))) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizedPath(value: string): string {
  return posix.normalize(value.replace(/\\/gu, "/")).replace(/^\.\//u, "");
}

function pathMappings(input: unknown, baseUrl: string): TsConfigPathMapping[] {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return [];
  const mappings: TsConfigPathMapping[] = [];
  for (const [pattern, rawTargets] of Object.entries(input)) {
    if (!Array.isArray(rawTargets)) continue;
    const wildcard = pattern.indexOf("*");
    const targets = rawTargets
      .filter((target): target is string => typeof target === "string" && target.trim().length > 0)
      .map((target) => normalizedPath(posix.join(baseUrl, target)));
    if (targets.length === 0) continue;
    mappings.push({
      pattern,
      prefix: wildcard < 0 ? pattern : pattern.slice(0, wildcard),
      suffix: wildcard < 0 ? "" : pattern.slice(wildcard + 1),
      targets,
    });
  }
  return mappings.sort((left, right) => {
    const exactDifference = Number(!right.pattern.includes("*")) - Number(!left.pattern.includes("*"));
    return exactDifference || right.prefix.length - left.prefix.length;
  });
}

export async function loadTsConfigPathResolver(fs: FileSystem): Promise<TsConfigPathResolver> {
  const configPath = await fs.exists("tsconfig.json")
    ? "tsconfig.json"
    : await fs.exists("jsconfig.json")
      ? "jsconfig.json"
      : undefined;
  return configPath === undefined
    ? { mappings: [] }
    : loadResolverFromConfig(fs, configPath, new Set());
}

async function resolveExtendsPath(fs: FileSystem, configPath: string, value: string): Promise<string | undefined> {
  const configDir = posix.dirname(configPath);
  const base = value.startsWith(".")
    ? normalizedPath(posix.join(configDir, value))
    : normalizedPath(posix.join("node_modules", value));
  const candidates = [base, `${base}.json`, posix.join(base, "tsconfig.json")];
  for (const candidate of candidates) {
    if (await fs.exists(candidate)) return candidate;
  }
  return undefined;
}

async function loadResolverFromConfig(
  fs: FileSystem,
  configPath: string,
  seen: Set<string>,
): Promise<TsConfigPathResolver> {
  if (seen.has(configPath)) return { mappings: [] };
  seen.add(configPath);
  const config = parseJsonConfig(await fs.readFile(configPath));
  const extended = typeof config?.extends === "string"
    ? await resolveExtendsPath(fs, configPath, config.extends)
    : undefined;
  const parent = extended === undefined
    ? { mappings: [] }
    : await loadResolverFromConfig(fs, extended, seen);
  const compilerOptions = config?.compilerOptions;
  if (compilerOptions === null || typeof compilerOptions !== "object" || Array.isArray(compilerOptions)) {
    return parent;
  }
  const options = compilerOptions as Record<string, unknown>;
  const configDir = posix.dirname(configPath);
  const baseUrl = typeof options.baseUrl === "string" && options.baseUrl.trim().length > 0
    ? normalizedPath(posix.join(configDir, options.baseUrl))
    : parent.baseUrl;
  const mappingBase = baseUrl ?? normalizedPath(configDir);
  return {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    mappings: options.paths === undefined ? parent.mappings : pathMappings(options.paths, mappingBase),
  };
}

export function resolveTsConfigCandidates(specifier: string, resolver: TsConfigPathResolver): string[] {
  for (const mapping of resolver.mappings) {
    if (!mapping.pattern.includes("*")) {
      if (specifier === mapping.pattern) return mapping.targets;
      continue;
    }
    if (!specifier.startsWith(mapping.prefix) || !specifier.endsWith(mapping.suffix)) continue;
    const wildcard = specifier.slice(mapping.prefix.length, specifier.length - mapping.suffix.length);
    return mapping.targets.map((target) => target.replace("*", wildcard));
  }
  return resolver.baseUrl === undefined
    ? []
    : [normalizedPath(posix.join(resolver.baseUrl, specifier))];
}
