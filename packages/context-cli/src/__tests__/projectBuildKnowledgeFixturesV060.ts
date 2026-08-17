import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeApprovedGuide(
  project: string,
  sourceApprovedId: string,
  relPath = "domain/getting-started.md",
): string {
  const outputPath = join(project, "knowledge", "sop", relPath);
  const sourceContent = readFileSync(join(project, "knowledge", `${sourceApprovedId}.md`), "utf8");
  const nodeRef = relPath.replace(/\.md$/u, "");
  const content = sourceContent
    .replace(/^title: .+$/mu, "title: Getting Started Guide")
    .replace(/^type: .+$/mu, "type: Guide")
    .replace(/^node_ref: .+$/mu, `node_ref: ${nodeRef}`)
    .replace(/^view_ref: .+$/mu, `view_ref: sop:${nodeRef}`)
    .replace(/^description: .+$/mu, "description: Guide page used to verify collection-aware package indexes.")
    .replace(/^node_type: .+$/mu, "node_type: domain")
    .replace(/^# .+$/mu, "# Getting Started Guide");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

export function writeApprovedRule(
  project: string,
  sourceApprovedId: string,
  relPath = "domain/security.md",
): string {
  const outputPath = join(project, "knowledge", "standards", relPath);
  const sourceContent = readFileSync(join(project, "knowledge", `${sourceApprovedId}.md`), "utf8");
  const nodeRef = relPath.replace(/\.md$/u, "");
  const content = sourceContent
    .replace(/^title: .+$/mu, "title: Security Standard")
    .replace(/^type: .+$/mu, "type: Rule")
    .replace(/^node_ref: .+$/mu, `node_ref: ${nodeRef}`)
    .replace(/^view_ref: .+$/mu, `view_ref: standards:${nodeRef}`)
    .replace(/^description: .+$/mu, "description: Rule page used to verify package selection.")
    .replace(/^node_type: .+$/mu, "node_type: domain")
    .replace(/^# .+$/mu, "# Security Standard");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

export function writeApprovedFeature(
  project: string,
  sourceApprovedId: string,
  relPath = "feature/experiments.md",
): string {
  const outputPath = join(project, "knowledge", "feats", relPath);
  const sourceContent = readFileSync(join(project, "knowledge", `${sourceApprovedId}.md`), "utf8");
  const nodeRef = relPath.replace(/\.md$/u, "").replace(/^feature\//u, "action/");
  const content = sourceContent
    .replace(/^title: .+$/mu, "title: Experiment Feature")
    .replace(/^type: .+$/mu, "type: Feature")
    .replace(/^node_ref: .+$/mu, `node_ref: ${nodeRef}`)
    .replace(/^view_ref: .+$/mu, `view_ref: feats:${nodeRef}`)
    .replace(/^description: .+$/mu, "description: Feature page used to verify feats package selection.")
    .replace(/^node_type: .+$/mu, "node_type: action")
    .replace(/^# .+$/mu, "# Experiment Feature");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

export function configureKbNavigation(
  project: string,
  navigation: { foldDirectoryIndexes: boolean; maxInlineEntries: number },
): void {
  const entryPath = join(project, "src", "index.ts");
  const entry = readFileSync(entryPath, "utf8");
  writeFileSync(entryPath, entry.replace(
    '      template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
    [
      '      template: { path: "src/package-templates/kb", vars: { displayName: "Sample KB" } },',
      `      navigation: ${JSON.stringify(navigation)},`,
    ].join("\n"),
  ), "utf8");
}
