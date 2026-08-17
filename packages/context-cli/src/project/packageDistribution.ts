import type { PackageDefinition, TemplateVarValue } from "@c4a/context";
import { okfPackagePathForKnowledgePath, type OkfOutputRoot } from "./okfTypes.js";

export function packageKnowledgeNamespace(pkg: PackageDefinition): string | undefined {
  return pkg.kind === "package.kb" ? pkg.distribution?.knowledgeNamespace : undefined;
}

export function packageOkfRootPath(pkg: PackageDefinition, root: OkfOutputRoot): string {
  void pkg;
  return root;
}

function namespaceOkfPath(pkg: PackageDefinition, relPath: string): string {
  void pkg;
  return relPath;
}

export function packageKnowledgeOutputPath(pkg: PackageDefinition, approvedRelPath: string): string {
  return namespaceOkfPath(pkg, okfPackagePathForKnowledgePath(approvedRelPath));
}

export function packageTemplateOutputPath(pkg: PackageDefinition, logicalRelPath: string): string {
  return namespaceOkfPath(pkg, logicalRelPath);
}

function currentSkill(input: {
  logicalTemplateRelPath?: string;
}): { name: string; path: string } | undefined {
  if (input.logicalTemplateRelPath === undefined) return undefined;
  const [root, logicalName] = input.logicalTemplateRelPath.split("/");
  if (root !== "skills" || logicalName === undefined) return undefined;
  return {
    name: logicalName,
    path: `skills/${logicalName}/SKILL.md`,
  };
}

export function packageDistributionTemplateVars(input: {
  pkg: PackageDefinition;
  logicalTemplateRelPath?: string;
}): Record<string, TemplateVarValue> {
  const namespace = packageKnowledgeNamespace(input.pkg) ?? "";
  const skill = currentSkill(input);
  return {
    knowledgeNamespace: namespace,
    namespacedKnowledge: false,
    skillsRoot: "skills",
    wikisRoot: packageOkfRootPath(input.pkg, "wikis"),
    guidesRoot: packageOkfRootPath(input.pkg, "guides"),
    rulesRoot: packageOkfRootPath(input.pkg, "rules"),
    featsRoot: packageOkfRootPath(input.pkg, "feats"),
    skillName: skill?.name ?? "",
    skillPath: skill?.path ?? "",
  };
}
