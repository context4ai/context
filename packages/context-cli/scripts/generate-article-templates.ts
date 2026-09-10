#!/usr/bin/env bun
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import YAML from "yaml";

import { bundledIndexerProfileContract } from "../src/project/indexerBaseContracts.js";
import { ARTICLE_BLUEPRINT_SLOTS } from "./indexerArticleBlueprints.js";

const root = resolve(import.meta.dir, "../../..");
const profiles = bundledIndexerProfileContract().profiles;
const preferences: Record<string, string[]> = {
  c02: ["understand-product-intent", "understand-domain", "develop-page-task"],
  c05: ["resolve-reader-question", "operate-or-recover-system", "modify-or-diagnose-module"],
  c06: ["understand-decision-and-tradeoffs", "learn-from-incident", "understand-release-change"],
  c07: ["modify-or-diagnose-module", "understand-technical-design"],
  f09: ["modify-or-diagnose-module", "operate-or-recover-system", "complete-reader-task"],
  f10: ["integrate-host-and-remote"],
  d03: ["understand-domain", "follow-standard-or-policy", "modify-or-diagnose-module"],
  d04: ["operate-or-recover-system", "modify-or-diagnose-module", "follow-standard-or-policy"],
  s04: ["understand-domain", "modify-or-diagnose-module"],
  s05: ["modify-or-diagnose-module", "understand-technical-design"],
  s06: ["modify-or-diagnose-module", "understand-technical-design"],
  s07: ["operate-or-extend-task", "operate-or-recover-system"],
  l03: ["follow-standard-or-policy", "understand-technical-design", "integrate-capability"],
  q07: ["learn-from-incident", "resolve-reader-question"],
};
const providers = ["context-code-indexer", "context-markdown-indexer", "context-note-indexer", "context-sessions-indexer"];
let count = 0;
for (const provider of providers) {
  const skill = join(root, "plugins/context/skills", provider);
  const manifestPath = join(skill, "context-indexer.yaml");
  const manifest = YAML.parse(await readFile(manifestPath, "utf8"));
  // One neutral authoring source, distributed inside each Provider boundary.
  const diagramPath = "references/diagrams.md";
  const diagramSource = join(root, "plugins/context/skills/context-code-indexer", diagramPath);
  if (provider !== "context-code-indexer") await writeFile(join(skill, diagramPath), await readFile(diagramSource, "utf8"));
  const instructionProfiles = [...new Set((manifest.provider.instructions ?? []).flatMap((item: {profiles: string[]}) => item.profiles))];
  const diagramInstruction = { path: diagramPath, profiles: instructionProfiles };
  const diagramIndex = manifest.provider.instructions.findIndex((item: {path: string}) => item.path === diagramPath);
  if (diagramIndex < 0) manifest.provider.instructions.push(diagramInstruction);
  else manifest.provider.instructions[diagramIndex] = diagramInstruction;

  const visualPath = "references/visual-source-processing.md";
  if (provider !== "context-code-indexer") await writeFile(join(skill, visualPath),
    await readFile(join(root, "plugins/context/skills/context-code-indexer", visualPath), "utf8"));
  const visualInstruction = { path: visualPath, profiles: instructionProfiles };
  const visualIndex = manifest.provider.instructions.findIndex((item: {path: string}) => item.path === visualPath);
  if (visualIndex < 0) manifest.provider.instructions.push(visualInstruction);
  else manifest.provider.instructions[visualIndex] = visualInstruction;

  const refs = manifest.provider.templates.filter((item: {kind?: string; path: string}) =>
    item.kind === "procedure" && /^templates\/articles\/[a-z]\d\d\.md$/u.test(item.path));
  for (const ref of refs) {
    ref.delivery = "selected";
    const blueprint = ref.path.split("/").at(-1)!.slice(0, -3);
    const declared = ARTICLE_BLUEPRINT_SLOTS[blueprint];
    if (!declared) throw new Error(`missing maintained article slots: ${blueprint}`);
    const profile = profiles.find(item => item.id === ref.profile);
    if (!profile) throw new Error(`unknown primary profile: ${ref.profile}`);
    const goals = [...new Set(profile.layout_mappings.map(item => item.reader_goal))];
    const goal = preferences[blueprint]?.find(item => goals.includes(item)) ?? goals[0]!;
    const id = `${ref.id}-page`;
    const slots = declared.split("|").map(value => { const at = value.indexOf(":"); return { key: value.slice(0, at), heading: value.slice(at + 1) }; });
    const includeApi = ["f03", "s02", "s03", "l01", "l02"].includes(blueprint) && provider === "context-code-indexer";
    const apiVariable = blueprint === "l02" ? "api" : "contract_api";
    if (blueprint === "l02" && !includeApi) slots.splice(3, 0, { key: "api", heading: "API 与公开契约" });
    // The article is the single authoring source: prose, examples and compact
    // section declarations. Profile-specific identities stay in the manifest.
    const articlePath = join(skill, ref.path);
    const rawArticle = await readFile(articlePath, "utf8");
    const end = rawArticle.indexOf("\n---\n", 4);
    const metadata = YAML.parse(rawArticle.slice(4, end));
    metadata.program = { article: blueprint,
      policies: profile.artifact_policy_variants.map(item => item.id),
      sections: Object.fromEntries(slots.map(slot => [slot.key, slot.heading])),
      ...(includeApi ? { contract_table: apiVariable } : {}) };
    await writeFile(articlePath, `---\n${YAML.stringify(metadata)}---\n${rawArticle.slice(end + 5)}`);
    const resource = ref.path;
    const registration = { id, profile: ref.profile, path: resource, kind: "page-program", delivery: "selected", reader_goal: goal, guidance_path: ref.path };
    const index = manifest.provider.templates.findIndex((item: {id: string}) => item.id === id);
    if (index < 0) manifest.provider.templates.push(registration); else manifest.provider.templates[index] = registration;
    for (const instruction of manifest.provider.instructions ?? []) {
      if (!instruction.path.includes("/article-catalog/") || !instruction.profiles.includes(ref.profile)) continue;
      const catalogPath = join(skill, instruction.path);
      const catalog = await readFile(catalogPath, "utf8");
      const updated = catalog.replaceAll(`\`${ref.id}\``, `\`${id}\``);
      if (catalog !== updated) await writeFile(catalogPath, updated);
    }
    count++;
  }
  await rm(join(skill, "templates/article-programs"), { recursive: true, force: true });
  await writeFile(manifestPath, YAML.stringify(JSON.parse(JSON.stringify(manifest)), {lineWidth: 120}));
}
process.stdout.write(`Generated ${count} profile-bound article programs.\n`);
