#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "{{packageName}}";
const STANDARD_ROOTS = ["wikis", "guides", "rules", "feats"];
const MAX_CHUNK_LINES = 80;
const CHUNK_OVERLAP = 5;

function usage() {
  return [
    "Search an approved knowledge package with deterministic BM25 ranking.",
    "",
    "Usage:",
    "  node search.mjs --query <text> [--root <package-root>] [--base <package-collection>] [--limit <n>] [--json]",
    "  node search.mjs <text> [--root <package-root>] [--base <package-collection>] [--limit <n>] [--json]",
    "",
    "The package root is detected from context-build-inventory.json when possible.",
  ].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const options = { root: undefined, base: undefined, query: undefined, limit: 8, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--root" || arg === "--base" || arg === "--query" || arg === "--limit") {
      const value = argv[++index];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      if (arg === "--root") options.root = value;
      else if (arg === "--base") options.base = value;
      else if (arg === "--query") options.query = value;
      else options.limit = Number(value);
      continue;
    }
    positional.push(arg);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) {
    throw new Error("--limit must be an integer between 1 and 50");
  }
  options.query ??= positional.join(" ");
  if (options.query.trim().length === 0) throw new Error("query must not be empty");
  return options;
}

function isPackageRoot(directory) {
  return existsSync(join(directory, "context-build-inventory.json"));
}

function ancestorPackageRoot(start) {
  let current = resolve(start);
  while (true) {
    if (isPackageRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findInventories(directory, depth = 0) {
  if (!existsSync(directory) || depth > 5) return [];
  const inventory = join(directory, "context-build-inventory.json");
  if (existsSync(inventory)) return [inventory];
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    matches.push(...findInventories(join(directory, entry.name), depth + 1));
  }
  return matches;
}

function inventoryPackageName(inventoryPath) {
  try {
    return JSON.parse(readFileSync(inventoryPath, "utf8"))?.package?.name;
  } catch {
    return undefined;
  }
}

function resolvePackageRoot(explicitRoot, packageCollection) {
  if (explicitRoot !== undefined) {
    const root = resolve(explicitRoot);
    if (!isPackageRoot(root)) throw new Error(`package root has no context-build-inventory.json: ${root}`);
    return root;
  }
  const scriptRoot = ancestorPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (scriptRoot !== undefined) return scriptRoot;
  const cwdRoot = ancestorPackageRoot(process.cwd());
  if (cwdRoot !== undefined) return cwdRoot;
  if (packageCollection === undefined) {
    throw new Error("cannot locate the knowledge package; pass --root <package-root> or --base <package-collection>");
  }
  const inventories = findInventories(resolve(packageCollection));
  const matching = inventories.filter((path) => inventoryPackageName(path) === PACKAGE_NAME);
  if (matching.length === 1) return dirname(matching[0]);
  if (matching.length > 1) {
    throw new Error(`multiple installed packages named ${PACKAGE_NAME}; pass --root explicitly`);
  }
  throw new Error("cannot locate the knowledge package; pass --root <package-root>");
}

function knowledgeRoots(packageRoot) {
  const inventoryPath = join(packageRoot, "context-build-inventory.json");
  let declared = [];
  try {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    declared = Object.values(inventory?.package?.distribution?.roots ?? {})
      .filter((value) => typeof value === "string");
  } catch {
    declared = [];
  }
  return [...new Set([...declared, ...STANDARD_ROOTS])]
    .map((root) => join(packageRoot, root))
    .filter((root) => existsSync(root) && statSync(root).isDirectory());
}

function markdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function headingChunks(content) {
  const lines = content.split(/\r?\n/u);
  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^#{1,6}\s+\S/u.test(lines[index] ?? "")) starts.push(index);
  }
  if (starts.length === 0) starts.push(0);
  const chunks = [];
  for (let headingIndex = 0; headingIndex < starts.length; headingIndex++) {
    const start = starts[headingIndex] ?? 0;
    const end = starts[headingIndex + 1] ?? lines.length;
    const heading = (lines[start] ?? "").replace(/^#{1,6}\s+/u, "").trim() || "Document";
    for (let offset = start; offset < end; offset += MAX_CHUNK_LINES - CHUNK_OVERLAP) {
      const chunkEnd = Math.min(end, offset + MAX_CHUNK_LINES);
      chunks.push({
        heading,
        startLine: offset + 1,
        endLine: chunkEnd,
        text: lines.slice(offset, chunkEnd).join("\n"),
      });
      if (chunkEnd === end) break;
    }
  }
  return chunks;
}

function tokens(text) {
  const normalized = text.toLocaleLowerCase();
  const result = normalized.match(/[a-z0-9@._:/-]+|\p{Script=Han}+/gu) ?? [];
  const expanded = [];
  for (const token of result) {
    expanded.push(token);
    if (/^\p{Script=Han}+$/u.test(token)) {
      for (let index = 0; index < token.length - 1; index++) expanded.push(token.slice(index, index + 2));
    } else {
      expanded.push(...token.split(/[^a-z0-9]+/u).filter((part) => part.length > 1));
    }
  }
  return expanded.filter((token) => token.length > 0);
}

function termFrequency(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function preview(text, queryTerms, query) {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const loweredQuery = query.toLocaleLowerCase().trim();
  const matching = [...lines].sort((left, right) => {
    const leftText = left.toLocaleLowerCase();
    const rightText = right.toLocaleLowerCase();
    const lineScore = (value) =>
      (value.includes(loweredQuery) ? queryTerms.length + 2 : 0)
      + queryTerms.filter((term) => value.includes(term)).length;
    return lineScore(rightText) - lineScore(leftText);
  })[0];
  return (matching ?? lines[0] ?? "").replace(/\s+/gu, " ").slice(0, 240);
}

function search(packageRoot, query, limit) {
  const documents = [];
  for (const root of knowledgeRoots(packageRoot)) {
    for (const file of markdownFiles(root)) {
      const path = relative(packageRoot, file).split("\\").join("/");
      const content = readFileSync(file, "utf8");
      for (const chunk of headingChunks(content)) {
        const weightedText = `${path} ${chunk.heading} ${chunk.heading} ${chunk.text}`;
        const chunkTokens = tokens(weightedText);
        documents.push({ ...chunk, path, tokens: chunkTokens, tf: termFrequency(chunkTokens) });
      }
    }
  }
  const queryTerms = [...new Set(tokens(query))];
  const documentFrequency = new Map();
  for (const term of queryTerms) {
    documentFrequency.set(term, documents.filter((document) => document.tf.has(term)).length);
  }
  const averageLength = documents.reduce((sum, document) => sum + document.tokens.length, 0)
    / Math.max(documents.length, 1);
  const loweredQuery = query.toLocaleLowerCase().trim();
  const scored = documents.map((document) => {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = document.tf.get(term) ?? 0;
      if (frequency === 0) continue;
      const matches = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - matches + 0.5) / (matches + 0.5));
      const denominator = frequency + 1.2 * (0.25 + 0.75 * document.tokens.length / Math.max(averageLength, 1));
      score += idf * frequency * 2.2 / denominator;
    }
    const searchable = `${document.path}\n${document.heading}\n${document.text}`.toLocaleLowerCase();
    if (searchable.includes(loweredQuery)) score += 4;
    if (`${document.path} ${document.heading}`.toLocaleLowerCase().includes(loweredQuery)) score += 2;
    return { ...document, score };
  }).filter((document) => document.score > 0);
  scored.sort((left, right) =>
    right.score - left.score
    || left.path.localeCompare(right.path)
    || left.startLine - right.startLine
  );
  return scored.slice(0, limit).map((document) => ({
    score: Number(document.score.toFixed(4)),
    path: document.path,
    heading: document.heading,
    start_line: document.startLine,
    end_line: document.endLine,
    preview: preview(document.text, queryTerms, query),
  }));
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const root = resolvePackageRoot(options.root, options.base);
  const results = search(root, options.query, options.limit);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ package: PACKAGE_NAME, root, query: options.query, results }, null, 2)}\n`);
  } else if (results.length === 0) {
    process.stdout.write(`No matching knowledge found for: ${options.query}\n`);
  } else {
    for (const [index, result] of results.entries()) {
      process.stdout.write(`${index + 1}. ${result.path}:${result.start_line}-${result.end_line} [${result.score}] ${result.heading}\n`);
      process.stdout.write(`   ${result.preview}\n`);
    }
  }
} catch (error) {
  process.stderr.write(`knowledge-search: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exit(2);
}
