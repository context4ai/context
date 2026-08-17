import type { PackageDefinition, TemplateVarValue } from "@c4a/context";
import { parse as parseYaml } from "yaml";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  knowledgeDirectoryIndexPaths,
  type ApprovedKnowledgeFile,
} from "./packageIndexes.js";
import {
  packageDistributionTemplateVars,
  packageKnowledgeOutputPath,
  packageOkfRootPath,
  packageTemplateOutputPath,
} from "./packageDistribution.js";
import {
  assertSafeRenderedPath,
  renderTemplateText,
  stripTemplateComments,
  type TemplateFile,
} from "./packageTemplateUtils.js";

const OKF_OUTPUT_ROOTS = new Set(["wikis", "guides", "rules", "feats"]);
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export function validatePackageTemplateContract(pkg: PackageDefinition, templateFiles: readonly TemplateFile[]): void {
  if (pkg.kind === "package.kb") {
    const hasSkillDefinition = templateFiles.some((file) => file.relPath.split("/").at(-1) === "SKILL.md");
    const hasOkfIndex = templateFiles.some((file) => file.relPath === "wikis/index.md");
    if (!hasSkillDefinition) {
      throw new ContextError(ExitCode.WorkspaceStateError, `kb package template is incomplete: ${pkg.template.path}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        packageName: pkg.name,
        template: pkg.template.path,
        next: "Add at least one SKILL.md under the kb package template, or remove the kbPackage() declaration until the output shape is decided.",
      });
    }
    if (!hasOkfIndex) {
      throw new ContextError(ExitCode.WorkspaceStateError, `kb package template is incomplete: ${pkg.template.path}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        packageName: pkg.name,
        template: pkg.template.path,
        next: "Add wikis/index.md to the kb package template so the output has an OKF entry page.",
      });
    }
  }
  for (const file of templateFiles) {
    validateTemplateBoundaryClaims(pkg, file);
  }
}

function templateHasBoundaryClaim(content: string): boolean {
  return /\b(?:coverage|coverage\s+gaps?|known\s+gaps?|known[- ]?limits?|known\s+limitations?|not\s+covered|incomplete)\b|覆盖范围|缺口|已知限制|不完整|未覆盖/iu
    .test(stripTemplateComments(content));
}

function templateHasBoundarySource(content: string): boolean {
  const stripped = stripTemplateComments(content);
  return /context-build-inventory\.json|\{\{\s*(?:approvedKnowledge|knowledge|knowledgeItems|knowledgeGroups|knowledgeTree|knowledgeItemsMarkdown|knowledgeGroupsMarkdown|buildInventory|buildInventoryJson|buildInventoryPath|knowledgeStructure|knowledgeStructureJson)\b/iu
    .test(stripped);
}

function validateTemplateBoundaryClaims(pkg: PackageDefinition, file: TemplateFile): void {
  if (!templateHasBoundaryClaim(file.content) || templateHasBoundarySource(file.content)) return;
  throw new ContextError(ExitCode.WorkspaceStateError, `package template boundary claim is not grounded: ${file.relPath}`, {
    category: ErrorCategory.WorkspaceStateInvalid,
    reason_code: "package/template-boundary-ungrounded",
    packageName: pkg.name,
    template: pkg.template.path,
    path: file.relPath,
    next: "Reference approved knowledge, context-build-inventory.json, or rendered structure data when a template describes package coverage, gaps, scope, or known limits.",
  });
}

export function validatePackageRenderPlan(input: {
  pkg: PackageDefinition;
  files: readonly TemplateFile[];
  selected: readonly ApprovedKnowledgeFile[];
  vars: Record<string, TemplateVarValue>;
}): void {
  const renderedPaths = new Set<string>();
  for (const file of input.files) {
    const logicalRelPath = renderTemplateText(file.relPath, {
      ...input.vars,
      ...packageDistributionTemplateVars({
        pkg: input.pkg,
        logicalTemplateRelPath: file.relPath,
      }),
    });
    const renderedRelPath = packageTemplateOutputPath(input.pkg, logicalRelPath);
    assertSafeRenderedPath(renderedRelPath, "package template path");
    validateRenderedSkillDefinition({
      pkg: input.pkg,
      relPath: renderedRelPath,
      content: renderTemplateText(file.content, {
        ...input.vars,
        ...packageDistributionTemplateVars({
          pkg: input.pkg,
          logicalTemplateRelPath: logicalRelPath,
        }),
      }),
    });
    if (renderedPaths.has(renderedRelPath)) {
      throw new ContextError(ExitCode.WorkspaceStateError, `package template renders duplicate output path: ${renderedRelPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        packageName: input.pkg.name,
        path: renderedRelPath,
        next: "Rename one of the template files so every rendered package path is unique.",
      });
    }
    renderedPaths.add(renderedRelPath);
  }
  for (const file of input.selected) {
    assertSafeRenderedPath(file.relPath, "knowledge path");
    const outputRelPath = packageKnowledgeOutputPath(input.pkg, file.relPath);
    assertSafeRenderedPath(outputRelPath, "knowledge output path");
    const segments = outputRelPath.split("/").filter(Boolean);
    const collection = segments[0];
    if (OKF_OUTPUT_ROOTS.has(collection ?? "") && segments.at(-1) === "index.md") {
      throw new ContextError(ExitCode.WorkspaceStateError, `approved knowledge path uses reserved OKF index path: ${outputRelPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        packageName: input.pkg.name,
        path: outputRelPath,
        source_path: file.relPath,
        next: "Regenerate or rename the approved knowledge page so concept pages do not use index.md; directory indexes are generated by context build.",
      });
    }
    if (renderedPaths.has(outputRelPath)) {
      throw new ContextError(ExitCode.WorkspaceStateError, `package template path collides with copied knowledge: ${outputRelPath}`, {
        category: ErrorCategory.WorkspaceStateInvalid,
        packageName: input.pkg.name,
        path: outputRelPath,
        source_path: file.relPath,
        next: "Rename the template file or exclude that knowledge path with select.exclude.",
      });
    }
  }
  const rootIndexPaths = new Set(
    [...OKF_OUTPUT_ROOTS].map((root) =>
      `${packageOkfRootPath(input.pkg, root as "wikis" | "guides" | "rules" | "feats")}/index.md`
    ),
  );
  for (const directoryIndexPath of knowledgeDirectoryIndexPaths(input.pkg, input.selected)) {
    if (rootIndexPaths.has(directoryIndexPath)) continue;
    if (!renderedPaths.has(directoryIndexPath)) continue;
    throw new ContextError(ExitCode.WorkspaceStateError, `package template path collides with generated OKF directory index: ${directoryIndexPath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      packageName: input.pkg.name,
      path: directoryIndexPath,
      next: "Remove or rename the template file; directory indexes are generated by context build.",
    });
  }
}

function validateRenderedSkillDefinition(input: {
  pkg: PackageDefinition;
  relPath: string;
  content: string;
}): void {
  if (input.relPath.split("/").at(-1) !== "SKILL.md") return;
  const segments = input.relPath.split("/");
  const skillName = segments.length === 3 && segments[0] === "skills" && segments[2] === "SKILL.md"
    ? segments[1]
    : undefined;
  if (skillName === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `package Skill path is invalid: ${input.relPath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package/skill-path-invalid",
      packageName: input.pkg.name,
      path: input.relPath,
      next: "Place each Skill at skills/<skill-name>/SKILL.md so Agent hosts can discover it.",
    });
  }
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(input.content);
  if (frontmatterMatch?.[1] === undefined) {
    throw new ContextError(ExitCode.WorkspaceStateError, `package Skill frontmatter is missing: ${input.relPath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package/skill-frontmatter-missing",
      packageName: input.pkg.name,
      path: input.relPath,
      next: "Add YAML frontmatter whose name exactly matches the Skill directory name.",
    });
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(frontmatterMatch[1]);
  } catch {
    frontmatter = null;
  }
  const declaredName = frontmatter !== null && typeof frontmatter === "object" && !Array.isArray(frontmatter)
    ? (frontmatter as Record<string, unknown>).name
    : undefined;
  if (declaredName !== skillName) {
    throw new ContextError(ExitCode.WorkspaceStateError, `package Skill name does not match its directory: ${input.relPath}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package/skill-name-mismatch",
      packageName: input.pkg.name,
      path: input.relPath,
      expected: skillName,
      actual: declaredName ?? null,
      next: "Render the Skill frontmatter name from {{skillName}} so it stays aligned with the author-maintained Skill directory.",
    });
  }
  if (skillName.length > 64 || !SKILL_NAME_PATTERN.test(skillName)) {
    throw new ContextError(ExitCode.WorkspaceStateError, `package Skill name is invalid: ${skillName}`, {
      category: ErrorCategory.WorkspaceStateInvalid,
      reason_code: "package/skill-name-invalid",
      packageName: input.pkg.name,
      path: input.relPath,
      skillName,
      next: "Use an author-maintained lowercase kebab-case Skill directory name no longer than 64 characters.",
    });
  }
}
