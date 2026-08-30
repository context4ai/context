import type ParserTypes from "web-tree-sitter";
import * as WebTreeSitter from "web-tree-sitter";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Language = ParserTypes.Language;
type Tree = ParserTypes.Tree;
type ParserConstructor = {
  new(): ParserTypes;
  init(options?: Parameters<typeof ParserTypes.init>[0]): Promise<void>;
};
type LanguageConstructor = { load(path: string): Promise<Language> };
const treeSitterRuntime = WebTreeSitter as unknown as {
  default?: ParserConstructor & { Language?: LanguageConstructor };
  Parser?: ParserConstructor;
  Language?: LanguageConstructor;
};
const Parser = treeSitterRuntime.default ?? treeSitterRuntime.Parser;
if (!Parser) {
  throw new TypeError("web-tree-sitter runtime does not expose Parser");
}

let parserInitPromise:
  | Promise<{
      parser: ParserTypes;
      tsLanguage: Language;
      tsxLanguage: Language;
    }>
  | null = null;

/**
 * Track cumulative bytes parsed since last parser reset.
 * WASM linear memory grows monotonically — resetting the parser instance
 * periodically prevents unbounded memory growth when indexing large repos.
 */
let parsedBytesSinceReset = 0;
let parserDead = false;
const PARSER_RESET_THRESHOLD = 16 * 1024 * 1024; // 16 MB — conservative to avoid WASM OOM

const resolveWasmPath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

const createParserInstance = async (): Promise<{
  parser: ParserTypes;
  tsLanguage: Language;
  tsxLanguage: Language;
}> => {
  // In bundled builds (npm/link mode), __dirname inside web-tree-sitter gets
  // hardcoded to the build machine path. Use locateFile to redirect to
  // dist/wasm/ which is populated at build time. In dev mode (bun run src/),
  // the wasm file won't exist at ./wasm/ so we fall back to the default
  // resolution which finds it in node_modules.
  const localWasm = resolveWasmPath("./wasm/tree-sitter.wasm");
  const initOptions = existsSync(localWasm)
    ? { locateFile: (scriptName: string) => resolveWasmPath(`./wasm/${scriptName}`) }
    : undefined;
  await Parser.init(initOptions);
  const LanguageRuntime = treeSitterRuntime.default?.Language ?? treeSitterRuntime.Language;
  if (!LanguageRuntime) {
    throw new TypeError("web-tree-sitter runtime does not expose Language after initialization");
  }
  const parser = new Parser();
  const tsLanguage = await LanguageRuntime.load(
    resolveWasmPath("./wasm/tree-sitter-typescript.wasm")
  );
  const tsxLanguage = await LanguageRuntime.load(
    resolveWasmPath("./wasm/tree-sitter-tsx.wasm")
  );
  return { parser, tsLanguage, tsxLanguage };
};

export const initParser = async (): Promise<{
  parser: ParserTypes;
  tsLanguage: Language;
  tsxLanguage: Language;
}> => {
  if (!parserInitPromise) {
    parserInitPromise = (async () => {
      try {
        parsedBytesSinceReset = 0;
        return await createParserInstance();
      } catch (error) {
        parserInitPromise = null;
        throw error;
      }
    })();
  }
  return parserInitPromise!;
};

/** Force-reset the parser instance to reclaim WASM memory. */
const resetParser = () => {
  parserInitPromise = null;
  parsedBytesSinceReset = 0;
  parserDead = false;
};

const tryParse = async (source: string, isTsx: boolean): Promise<Tree | null> => {
  const { parser, tsLanguage, tsxLanguage } = await initParser();
  parser.setLanguage(isTsx ? tsxLanguage : tsLanguage);
  const tree = parser.parse(source);
  parsedBytesSinceReset += source.length;

  if (tree.rootNode.hasError()) {
    return null;
  }
  return tree;
};

export const parseFile = async (source: string, isTsx: boolean): Promise<Tree | null> => {
  // If WASM runtime is fatally broken, skip all further parsing
  if (parserDead) return null;

  // Reset parser if cumulative parsed bytes exceed threshold
  if (parsedBytesSinceReset > PARSER_RESET_THRESHOLD) {
    resetParser();
  }

  try {
    return await tryParse(source, isTsx);
  } catch {
    // First attempt crashed (likely WASM OOM) — reset and retry once
    resetParser();
  }

  try {
    return await tryParse(source, isTsx);
  } catch (error) {
    // Two consecutive crashes — WASM runtime is likely unrecoverable.
    // Mark parser as dead so remaining files skip parsing entirely
    // instead of crashing repeatedly. The extractor loop will continue
    // with relations/snippets for already-parsed files.
    console.warn("[extract] Parser unrecoverable after retry, skipping remaining files:", error);
    parserDead = true;
    return null;
  }
};
