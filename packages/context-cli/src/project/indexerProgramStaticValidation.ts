const MAX_INDEXER_PROGRAM_SOURCE_BYTES = 4 * 1024 * 1024;

const FORBIDDEN_MODULES = new Set([
  "axios",
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "dns/promises",
  "fs",
  "fs/promises",
  "got",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "node-fetch",
  "tls",
  "undici",
  "vm",
  "worker_threads",
  "ws",
]);

const FORBIDDEN_SOURCE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [{
  pattern: /\bimport\s*\(/u,
  reason: "dynamic import",
}, {
  pattern: /\bprocess\s*\.\s*env\b/u,
  reason: "environment access",
}, {
  pattern: /\bprocess\s*\.\s*(?:binding|chdir|kill|setuid|setgid)\s*\(/u,
  reason: "process mutation",
}, {
  pattern: /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u,
  reason: "network access",
}, {
  pattern: /\b(?:eval|Function)\s*\(/u,
  reason: "dynamic code execution",
}, {
  pattern: /\b(?:Bun|Deno)\s*\./u,
  reason: "non-Node runtime capability",
}, {
  pattern: /\b(?:appendFile|chmod|chown|copyFile|createWriteStream|link|mkdir|mkdtemp|rename|rm|rmdir|symlink|truncate|unlink|writeFile)(?:Sync)?\s*\(/u,
  reason: "filesystem mutation",
}];

function sourceText(value: string | Uint8Array): string {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_INDEXER_PROGRAM_SOURCE_BYTES) {
      throw new TypeError("Indexer program exceeds its static validation byte limit");
    }
    return value;
  }
  if (value.byteLength > MAX_INDEXER_PROGRAM_SOURCE_BYTES) {
    throw new TypeError("Indexer program exceeds its static validation byte limit");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new TypeError("Indexer program must be valid UTF-8 source");
  }
}

function importedModules(source: string): string[] {
  const modules: string[] = [];
  const staticImports = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  const requires = /\brequire\s*\(\s*["']([^"']+)["']/gu;
  for (const pattern of [staticImports, requires]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) modules.push(match[1]!);
  }
  return modules;
}

function normalizedModule(module: string): string {
  return module.startsWith("node:") ? module.slice("node:".length) : module;
}

export function validateIndexerProgramStaticSource(input: {
  path: string;
  source: string | Uint8Array;
}): void {
  const source = sourceText(input.source);
  for (const module of importedModules(source)) {
    if (FORBIDDEN_MODULES.has(normalizedModule(module))) {
      throw new TypeError(
        `Indexer program ${input.path} imports forbidden module ${module}`,
      );
    }
  }
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    if (rule.pattern.test(code)) {
      throw new TypeError(
        `Indexer program ${input.path} contains forbidden ${rule.reason}`,
      );
    }
  }
}
