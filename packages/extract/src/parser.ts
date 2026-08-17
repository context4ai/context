import Parser from "web-tree-sitter";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Language = Parser.Language;
type Tree = Parser.Tree;

let parserInitPromise:
  | Promise<{
      parser: Parser;
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
  parser: Parser;
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
  const parser = new Parser();
  const tsLanguage = await Parser.Language.load(
    resolveWasmPath("./wasm/tree-sitter-typescript.wasm")
  );
  const tsxLanguage = await Parser.Language.load(
    resolveWasmPath("./wasm/tree-sitter-tsx.wasm")
  );
  return { parser, tsLanguage, tsxLanguage };
};

export const initParser = async (): Promise<{
  parser: Parser;
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
