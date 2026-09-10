import { posix } from "node:path";

interface MaterialFile {
  file_ref: string;
  normalized_path: string;
  facts: readonly { fact_ref: string; kind: string; payload: unknown }[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function supporting(path: string): boolean {
  return /(^|\/)(__mocks__|__tests__|examples?|fixtures?|tests?|stories|docs?|documentation)(\/|$)|[._](test|spec|stories|doc)\.[^/]+$|\.mdx?$/iu.test(path);
}

function stem(path: string): string {
  return posix.basename(path).replace(/[._](test|spec|stories)(?=\.)/iu, "").replace(/\.[^.]+$/u, "");
}

/** Select material, not page ownership. A directory family helps Partition see
 * candidates together; it is not a reason to broadcast all its tests to Author.
 * Only captured paths are followed; no filesystem traversal or source expansion.
 */
export function selectIndexerAuthorFiles(input: {
  files: readonly MaterialFile[];
  member_ids: ReadonlySet<string>;
  requested_paths?: ReadonlySet<string>;
}): Set<string> {
  const byPath = new Map(input.files.map((file) => [file.normalized_path, file]));
  const owned = input.files.filter((file) => input.member_ids.has(file.file_ref) ||
    file.facts.some((fact) => input.member_ids.has(fact.fact_ref)));
  // Unknown/custom Provider ownership must not silently lose its material.
  if (owned.length === 0) return new Set(byPath.keys());
  // Other parser/extension fact families have different dependency contracts;
  // do not apply code-import heuristics to protocol schemas or tool snapshots.
  if (!owned.some((file) => file.facts.some((fact) => fact.kind === "code-symbol"))) return new Set(byPath.keys());
  const selected = new Set([...owned.map((file) => file.normalized_path), ...(input.requested_paths ?? [])]);
  const manifestNames = new Set(["package.json", "tsconfig.json", "go.mod", "Cargo.toml", "pyproject.toml"]);
  for (const file of input.files) {
    if (!manifestNames.has(posix.basename(file.normalized_path))) continue;
    const directory = posix.dirname(file.normalized_path);
    if (directory === "." || owned.some((owner) => owner.normalized_path.startsWith(`${directory}/`))) selected.add(file.normalized_path);
  }
  const resolve = (from: string, target: string): string | undefined => {
    // Import query flags select a loader, not a different captured file. Never
    // execute that loader or follow an uncaptured path.
    const pathname = target.split(/[?#]/u)[0]!;
    const base = pathname.startsWith(".") ? posix.normalize(posix.join(posix.dirname(from), pathname)) : pathname;
    const candidates = [base, ...["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs", "scss", "css", "mdx", "md", "json"]
      .flatMap((ext) => [`${base}.${ext}`, `${base}/index.${ext}`])];
    // TS source often imports its emitted .js spelling.
    if (/\.[cm]?js$/u.test(base)) candidates.push(base.replace(/\.js$/u, ".ts"), base.replace(/\.js$/u, ".tsx"));
    return candidates.find((path) => byPath.has(path));
  };
  const rawImports = new Set<string>();
  const imports = new Map(input.files.map((file) => [file.normalized_path,
    file.facts.flatMap((fact) => {
      const payload = record(fact.payload);
      const target = fact.kind === "mdx-esm-import" ? payload.source_module
        : fact.kind === "code-relation" && /^imports(?:[-_]?type)?$/iu.test(String(payload.type ?? payload.kind ?? ""))
          && payload.isExternal !== true ? payload.to : undefined;
      if (typeof target !== "string") return [];
      const path = resolve(file.normalized_path, target);
      if (path !== undefined && /[?&](?:raw|source)(?:[=&]|$)/u.test(target)) rawImports.add(`${file.normalized_path}\0${path}`);
      return path === undefined ? [] : [path];
    }),
  ]));
  const ownedPaths = new Set(owned.map((file) => file.normalized_path));
  for (const file of input.files) {
    if (!supporting(file.normalized_path)) continue;
    const adjacent = owned.some((owner) => stem(owner.normalized_path) !== "index" &&
      stem(owner.normalized_path) === stem(file.normalized_path) &&
      posix.dirname(file.normalized_path).replace(/\/(?:__tests__|tests?|stories)$/u, "") === posix.dirname(owner.normalized_path));
    if (adjacent || imports.get(file.normalized_path)?.some((path) => ownedPaths.has(path))) {
      selected.add(file.normalized_path);
    }
  }
  // Follow implementation dependencies, not reverse consumers. Do not fan out
  // a shared barrel into every sibling: missing detail uses request-material.
  const queue = [...selected];
  for (let i = 0; i < queue.length; i += 1) {
    for (const path of imports.get(queue[i]!) ?? []) {
      if (selected.has(path) || (supporting(path) && !supporting(queue[i]!) && !rawImports.has(`${queue[i]!}\0${path}`))) continue;
      selected.add(path);
      if (stem(path) !== "index") queue.push(path);
    }
  }
  return selected;
}
