import { constants, existsSync } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { ContextError } from "../lib/errors.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ExitCode } from "../types/exitCode.js";

function bundledSkillRoot(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  const root = [resolve(directory, "indexers/bundles"), resolve(directory, "../../dist/indexers/bundles")]
    .find(path => existsSync(path));
  if (!root) throw new TypeError("Bundled skill files are unavailable; build or reinstall the Context CLI.");
  return root;
}

/** Discovery is not Provider registration or an Agent capability declaration.
 * Read entry metadata only; never traverse references or verify skill versions. */
export async function listProductionSkills(root?: string) {
  try { return await readProductionSkills(root ?? bundledSkillRoot()); }
  catch (error) {
    const io = error as NodeJS.ErrnoException;
    throw new ContextError(ExitCode.WorkspaceStateError,
      error instanceof Error ? error.message : String(error), {
        category: ErrorCategory.WorkspaceStateInvalid, reason_code: "production-skill-catalog-unavailable",
        ...(typeof io.path === "string" ? { file: io.path } : root ? { directory: root } : {}),
        ...(typeof io.code === "string" ? { io_code: io.code } : {}),
        next_action: { command: "context indexer catalog --format json",
          instruction: "Restore the readable installed Skill entry, then retry the catalog. Do not edit article data or supply Provider versions or hashes." },
      });
  }
}

async function readProductionSkills(root: string) {
  const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const skills = [];
  for (const directory of entries) {
    const entry = join(root, directory.name, "SKILL.md");
    if (!(await lstat(entry)).isFile()) throw new TypeError(`Skill entry must be a regular file: ${entry}`);
    const handle = await open(entry, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let header: string;
    try {
      if (!(await handle.stat()).isFile()) throw new TypeError(`Skill entry must be a regular file: ${entry}`);
      const bytes = Buffer.alloc(64 * 1024);
      const result = await handle.read(bytes, 0, bytes.length, 0);
      header = bytes.subarray(0, result.bytesRead).toString("utf8");
    } finally { await handle.close(); }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(header);
    if (!frontmatter) throw new TypeError(`Skill entry needs complete frontmatter within 64 KiB: ${entry}`);
    const value: unknown = YAML.parse(frontmatter[1]!, { uniqueKeys: true });
    if (!value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string" || !value.name.trim() ||
      !("description" in value) || typeof value.description !== "string" || !value.description.trim()) {
      throw new TypeError(`Skill entry needs a name and description: ${entry}`);
    }
    skills.push({ name: value.name, description: value.description, entry });
  }
  return { skills };
}
