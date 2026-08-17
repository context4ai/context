import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { withProjectWriteLock } from "./writeLock.js";

export const PACKAGE_TEMPLATE_REVIEW_FILE = ".context-template.json";
const PACKAGE_TEMPLATE_REVIEW_SCHEMA = "context.package-template-review.v1";

interface PackageTemplateReviewMarker {
  schema: typeof PACKAGE_TEMPLATE_REVIEW_SCHEMA;
  starter_digest: string;
  disposition: "review-required" | "starter-accepted";
}

export interface PackageTemplateReviewStatus {
  packageName: string;
  templatePath: string;
  state:
    | "review-required"
    | "starter-accepted"
    | "customized"
    | "author-provided"
    | "invalid";
  starterDigest?: string;
  currentDigest?: string;
  diagnostic?: string;
}

async function templateFiles(root: string): Promise<Array<{ path: string; content: string }>> {
  if (!existsSync(root)) return [];
  const files: Array<{ path: string; content: string }> = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || entry.name === PACKAGE_TEMPLATE_REVIEW_FILE) continue;
      files.push({
        path: relative(root, absolutePath).split(/[/\\]+/u).join("/"),
        content: await readFile(absolutePath, "utf8"),
      });
    }
  };
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function templateDigest(root: string): Promise<string> {
  const files = await templateFiles(root);
  return `sha256:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
}

function isMarker(value: unknown): value is PackageTemplateReviewMarker {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Partial<PackageTemplateReviewMarker>;
  return marker.schema === PACKAGE_TEMPLATE_REVIEW_SCHEMA &&
    /^sha256:[a-f0-9]{64}$/u.test(marker.starter_digest ?? "") &&
    (marker.disposition === "review-required" || marker.disposition === "starter-accepted");
}

async function readMarker(templateRoot: string): Promise<PackageTemplateReviewMarker | null | "invalid"> {
  const markerPath = join(templateRoot, PACKAGE_TEMPLATE_REVIEW_FILE);
  if (!existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
    return isMarker(parsed) ? parsed : "invalid";
  } catch {
    return "invalid";
  }
}

export async function writeStarterTemplateReviewMarker(templateRoot: string): Promise<boolean> {
  const markerPath = join(templateRoot, PACKAGE_TEMPLATE_REVIEW_FILE);
  if (existsSync(markerPath)) return false;
  const marker: PackageTemplateReviewMarker = {
    schema: PACKAGE_TEMPLATE_REVIEW_SCHEMA,
    starter_digest: await templateDigest(templateRoot),
    disposition: "review-required",
  };
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return true;
}

export async function inspectPackageTemplateReview(
  projectRoot: string,
  pkg: PackageDefinition,
): Promise<PackageTemplateReviewStatus> {
  const templateRoot = resolve(projectRoot, pkg.template.path);
  const marker = await readMarker(templateRoot);
  if (marker === null) {
    return {
      packageName: pkg.name,
      templatePath: pkg.template.path,
      state: "author-provided",
    };
  }
  if (marker === "invalid") {
    return {
      packageName: pkg.name,
      templatePath: pkg.template.path,
      state: "invalid",
      diagnostic: `${join(pkg.template.path, PACKAGE_TEMPLATE_REVIEW_FILE)} is invalid`,
    };
  }
  const currentDigest = await templateDigest(templateRoot);
  return {
    packageName: pkg.name,
    templatePath: pkg.template.path,
    state: currentDigest !== marker.starter_digest
      ? "customized"
      : marker.disposition === "starter-accepted"
        ? "starter-accepted"
        : "review-required",
    starterDigest: marker.starter_digest,
    currentDigest,
  };
}

export async function inspectPackageTemplateReviews(
  projectRoot: string,
  packages: readonly PackageDefinition[],
): Promise<PackageTemplateReviewStatus[]> {
  return Promise.all(packages.map((pkg) => inspectPackageTemplateReview(projectRoot, pkg)));
}

export async function acceptStarterPackageTemplates(input: {
  projectRoot: string;
  packageNames?: readonly string[];
}): Promise<{ accepted: string[]; alreadyResolved: string[] }> {
  const { loadContextProjectModule } = await import("./workspace.js");
  const loaded = await loadContextProjectModule(input.projectRoot);
  const requested = input.packageNames === undefined
    ? loaded.project.packages
    : loaded.project.packages.filter((pkg) => input.packageNames!.includes(pkg.name));
  if (input.packageNames !== undefined && requested.length !== new Set(input.packageNames).size) {
    throw new ContextError(ExitCode.UserError, "one or more package names are not declared", {
      category: ErrorCategory.UserInputInvalid,
      requested: [...input.packageNames],
      declared: loaded.project.packages.map((pkg) => pkg.name),
    });
  }
  return withProjectWriteLock(input.projectRoot, "accept-package-template", async () => {
    const accepted: string[] = [];
    const alreadyResolved: string[] = [];
    for (const pkg of requested) {
      const status = await inspectPackageTemplateReview(input.projectRoot, pkg);
      if (status.state !== "review-required") {
        if (status.state === "invalid") {
          throw new ContextError(ExitCode.WorkspaceStateError, status.diagnostic ?? "package template review marker is invalid", {
            category: ErrorCategory.WorkspaceStateInvalid,
            packageName: pkg.name,
          });
        }
        alreadyResolved.push(pkg.name);
        continue;
      }
      const markerPath = join(input.projectRoot, pkg.template.path, PACKAGE_TEMPLATE_REVIEW_FILE);
      const marker = await readMarker(join(input.projectRoot, pkg.template.path));
      if (marker === null || marker === "invalid") {
        throw new ContextError(ExitCode.WorkspaceStateError, "package template review marker changed before acceptance", {
          category: ErrorCategory.WorkspaceStateInvalid,
          packageName: pkg.name,
        });
      }
      await writeFile(markerPath, `${JSON.stringify({
        ...marker,
        disposition: "starter-accepted",
      }, null, 2)}\n`, "utf8");
      accepted.push(pkg.name);
    }
    return { accepted, alreadyResolved };
  });
}
