import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isDefaultSiteTheme, SITE_THEME_FILE } from "./siteTheme.js";

export type WorkspaceSnapshotFormat = "git-blob-v1" | "sha256-v1";

export function excludedWorkspaceContent(path: string, legacy = false): boolean {
  return /(?:^|\/)(?:\.tmp|\.git|node_modules)(?:\/|$)/u.test(path) || /^dist(?:\/|$)/u.test(path) ||
    ["changelog.yaml", "CHANGELOG.md", ".context-version.json", ".context-builds.json", ".context-published.json"].includes(path) ||
    !legacy && (/^PLAN[^/]*\.md$/u.test(path) || /(?:^|\/)\.DS_Store$/u.test(path));
}

function git(root: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on("error", () => { /* The process callback reports command failure. */ });
    child.stdin?.end(input);
  });
}

async function contentPaths(root: string, legacy: boolean): Promise<{ paths: string[]; indexed: boolean }> {
  try {
    const paths = (await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."]))
      .split("\0").filter(Boolean);
    // An ignored workspace inside another Git repository must not appear empty.
    if (paths.length || await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim()) === await realpath(root)) {
      return { paths, indexed: true };
    }
  } catch { /* Preserve filesystem discovery when Git is unavailable. */ }
  const paths: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (excludedWorkspaceContent(path, legacy)) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  await visit("");
  return { paths, indexed: false };
}

async function trustedGitBlobs(root: string, paths: string[]) {
  const [index, changed, format, autocrlf, attributes] = await Promise.all([
    git(root, ["ls-files", "-s", "-t", "-v", "-z", "--", "."]),
    git(root, ["diff-files", "--relative", "--name-only", "-z", "--", "."]),
    git(root, ["rev-parse", "--show-object-format"]),
    // A missing setting is not a Git failure.
    git(root, ["config", "--default=false", "--get", "core.autocrlf"]),
    paths.length ? git(root, ["check-attr", "-z", "--stdin", "text", "crlf", "eol", "filter", "ident", "working-tree-encoding"], `${paths.join("\0")}\0`) : "",
  ]);
  const algorithm = format.trim();
  if (algorithm !== "sha1" && algorithm !== "sha256") throw new Error("Unsupported Git object format");
  const transformed = new Set<string>();
  const attr = attributes.split("\0");
  for (let i = 0; i + 2 < attr.length; i += 3) {
    if (attr[i + 2] !== "unspecified" && attr[i + 2] !== "unset") transformed.add(attr[i]!);
  }
  const modified = new Set(changed.split("\0"));
  const blobs = new Map<string, string>();
  // Git accepts true aliases and valueless boolean keys. Only a known false
  // spelling proves that checkout conversion is disabled.
  if (["false", "no", "off", "0"].includes(autocrlf.trim().toLowerCase())) {
    for (const row of index.split("\0")) {
      const match = /^H (100644|100755) ([a-f0-9]+) 0\t([\s\S]+)$/u.exec(row);
      if (match && !modified.has(match[3]!) && !transformed.has(match[3]!)) blobs.set(match[3]!, match[2]!);
    }
  }
  return { blobs, algorithm };
}

/** No Context-owned persistent cache: Git proves clean ordinary files; all
 * transformed, dirty and special files retain their workspace-byte semantics. */
export async function observeWorkspaceContent(root: string, options: { legacy?: boolean; raw?: boolean } = {}) {
  const discovered = await contentPaths(root, options.legacy ?? false);
  const paths = [...new Set(discovered.paths)].filter(path => !excludedWorkspaceContent(path, options.legacy)).sort();
  let indexed: Awaited<ReturnType<typeof trustedGitBlobs>> | undefined;
  if (discovered.indexed && !options.raw) {
    try { indexed = await trustedGitBlobs(root, paths); }
    catch { /* One failed Git operation falls back for the entire snapshot. */ }
  }
  const files: Record<string, string> = {};
  for (const path of paths) {
    const trusted = path !== "package.json" && path !== SITE_THEME_FILE ? indexed?.blobs.get(path) : undefined;
    if (trusted !== undefined) { files[path] = `git-blob:${trusted}`; continue; }
    let bytes: Buffer;
    try {
      if (!(await lstat(join(root, path))).isFile()) continue;
      bytes = await readFile(join(root, path));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (path === SITE_THEME_FILE && isDefaultSiteTheme(bytes.toString("utf8"))) continue;
    if (path === "package.json") {
      const manifest = JSON.parse(bytes.toString("utf8"));
      delete manifest.version;
      bytes = Buffer.from(JSON.stringify(manifest));
    }
    files[path] = indexed
      ? `git-blob:${createHash(indexed.algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex")}`
      : createHash("sha256").update(bytes).digest("hex");
  }
  return { files, format: (indexed ? "git-blob-v1" : "sha256-v1") as WorkspaceSnapshotFormat };
}

export async function workspaceContentSnapshot(root: string): Promise<Record<string, string>> {
  return (await observeWorkspaceContent(root)).files;
}
