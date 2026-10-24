#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STANDARD_ROOTS = ["wikis", "guides", "rules", "feats"];
const MAX_CHUNK_LINES = 80;
const CHUNK_OVERLAP = 5;
const COLLECTION_DEPTH = 5;
const SEARCH_GUIDE = join("others", "context", "search-guide.md");

// Distribution-specific package managers can register functions that return
// installed package directories for the current working directory.
const INSTALLED_PACKAGE_LOCATORS = [];

function usage() {
  return [
    "Search approved Context knowledge packages with deterministic BM25 ranking.",
    "",
    "Usage:",
    "  node search.mjs --list [--root <dir>] [--base <dir>] [--json]",
    "  node search.mjs --query <text> [--package <name>] [--root <dir>] [--base <dir>] [--limit <n>] [--json]",
    "  node search.mjs <text> [options]",
    "",
    "Packages are found from --root, the package containing this script or the",
    "current directory, packages under --base, directories listed in",
    "CONTEXT_KNOWLEDGE_PACKAGES, and the host's package manager when supported.",
  ].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const options = { roots: [], bases: [], query: undefined, packageName: undefined, limit: 8, json: false, list: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (["--root", "--base", "--query", "--limit", "--package"].includes(arg)) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      if (arg === "--root") options.roots.push(value);
      else if (arg === "--base") options.bases.push(value);
      else if (arg === "--query") options.query = value;
      else if (arg === "--package") options.packageName = value;
      else options.limit = Number(value);
      continue;
    }
    positional.push(arg);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) {
    throw new Error("--limit must be an integer between 1 and 50");
  }
  options.query ??= positional.join(" ");
  if (!options.list && options.query.trim().length === 0) throw new Error("query must not be empty");
  return options;
}

function inventoryPath(directory) {
  return [
    join(directory, "context-build-inventory.json"),
    join(directory, "others", "context", "context-build-inventory.json"),
  ].find((path) => existsSync(path));
}

function isPackageRoot(directory) {
  return inventoryPath(directory) !== undefined;
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

function packageRootsUnder(directory, depth = 0) {
  if (!existsSync(directory) || depth > COLLECTION_DEPTH) return [];
  if (isPackageRoot(directory)) return [directory];
  const roots = [];
  let entries = [];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
    roots.push(...packageRootsUnder(join(directory, entry.name), depth + 1));
  }
  return roots;
}

function readInventory(root) {
  try {
    return JSON.parse(readFileSync(inventoryPath(root), "utf8"));
  } catch {
    return undefined;
  }
}

function packageVersion(root) {
  for (const path of [join(root, "context-version.json"), join(root, "others", "context", "context-version.json")]) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (typeof value?.version === "string") return value.version;
    } catch {
      // Try the next location.
    }
  }
  return undefined;
}

function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function discoverPackages(options) {
  const candidates = [];
  const explicit = options.roots.map((root) => resolve(root));
  for (const root of explicit) {
    if (!isPackageRoot(root)) throw new Error(`package root has no context-build-inventory.json: ${root}`);
    candidates.push(root);
  }
  const scriptRoot = ancestorPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (scriptRoot !== undefined) candidates.push(scriptRoot);
  const cwdRoot = ancestorPackageRoot(process.cwd());
  if (cwdRoot !== undefined) candidates.push(cwdRoot);
  for (const base of options.bases) candidates.push(...packageRootsUnder(resolve(base)));
  for (const entry of (process.env.CONTEXT_KNOWLEDGE_PACKAGES ?? "").split(delimiter)) {
    if (entry.trim().length === 0) continue;
    candidates.push(...packageRootsUnder(resolve(entry.trim())));
  }
  for (const locate of INSTALLED_PACKAGE_LOCATORS) {
    try {
      for (const root of locate(process.cwd()) ?? []) candidates.push(...packageRootsUnder(resolve(root)));
    } catch {
      // A package manager that cannot be read contributes nothing.
    }
  }
  const seen = new Set();
  const packages = [];
  for (const root of candidates) {
    const key = canonical(root);
    if (seen.has(key)) continue;
    seen.add(key);
    const inventory = readInventory(root);
    packages.push({
      name: typeof inventory?.package?.name === "string" ? inventory.package.name : relative(process.cwd(), root) || ".",
      version: packageVersion(root),
      root,
      searchGuide: existsSync(join(root, SEARCH_GUIDE)) ? SEARCH_GUIDE.split("\\").join("/") : undefined,
      inventory,
    });
  }
  return packages;
}

function selectPackages(packages, packageName) {
  if (packageName === undefined) return packages;
  const wanted = packageName.toLocaleLowerCase();
  const matches = packages.filter((pkg) =>
    pkg.name.toLocaleLowerCase() === wanted
    || canonical(pkg.root).split(/[/\\]+/u).slice(-2).join("/").toLocaleLowerCase() === wanted
    || canonical(pkg.root).toLocaleLowerCase().endsWith(`/${wanted}`)
  );
  if (matches.length === 0) {
    throw new Error(`no found package matches ${packageName}; run --list to see available packages`);
  }
  return matches;
}

function knowledgeRoots(pkg) {
  const declared = Object.values(pkg.inventory?.package?.distribution?.roots ?? {})
    .filter((value) => typeof value === "string");
  return [...new Set([...declared, ...STANDARD_ROOTS])]
    .map((root) => join(pkg.root, root))
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

function search(packages, query, limit) {
  const documents = [];
  for (const pkg of packages) {
    for (const root of knowledgeRoots(pkg)) {
      for (const file of markdownFiles(root)) {
        const path = relative(pkg.root, file).split("\\").join("/");
        const content = readFileSync(file, "utf8");
        for (const chunk of headingChunks(content)) {
          const weightedText = `${path} ${chunk.heading} ${chunk.heading} ${chunk.text}`;
          const chunkTokens = tokens(weightedText);
          documents.push({ ...chunk, pkg, path, tokens: chunkTokens, tf: termFrequency(chunkTokens) });
        }
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
    || left.pkg.name.localeCompare(right.pkg.name)
    || left.path.localeCompare(right.path)
    || left.startLine - right.startLine
  );
  return scored.slice(0, limit).map((document) => ({
    score: Number(document.score.toFixed(4)),
    package: document.pkg.name,
    root: document.pkg.root,
    path: document.path,
    heading: document.heading,
    start_line: document.startLine,
    end_line: document.endLine,
    preview: preview(document.text, queryTerms, query),
  }));
}

function packageSummary(pkg) {
  return {
    name: pkg.name,
    ...(pkg.version !== undefined ? { version: pkg.version } : {}),
    root: pkg.root,
    ...(pkg.searchGuide !== undefined ? { search_guide: pkg.searchGuide } : {}),
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const found = discoverPackages(options);
  if (found.length === 0) {
    throw new Error("no Context knowledge package found; pass --root <package directory> or --base <package collection>");
  }
  if (options.list) {
    const summaries = found.map(packageSummary);
    if (options.json) process.stdout.write(`${JSON.stringify({ packages: summaries }, null, 2)}\n`);
    else {
      for (const pkg of summaries) {
        process.stdout.write(`${pkg.name}${pkg.version ? ` ${pkg.version}` : ""}  ${pkg.root}${pkg.search_guide ? `  guide: ${pkg.search_guide}` : ""}\n`);
      }
    }
    process.exit(0);
  }
  const packages = selectPackages(found, options.packageName);
  const results = search(packages, options.query, options.limit);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ packages: packages.map(packageSummary), query: options.query, results }, null, 2)}\n`);
  } else if (results.length === 0) {
    process.stdout.write(`No matching knowledge found for: ${options.query}\n`);
  } else {
    for (const [index, result] of results.entries()) {
      process.stdout.write(`${index + 1}. [${result.package}] ${result.path}:${result.start_line}-${result.end_line} [${result.score}] ${result.heading}\n`);
      process.stdout.write(`   ${result.preview}\n`);
    }
  }
} catch (error) {
  process.stderr.write(`context-knowledge-query: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exit(2);
}
