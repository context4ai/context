#!/usr/bin/env bun
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import YAML from "yaml";
import { indexerTemplateContractSchema } from "../../context/src/indexerTemplateRendering.js";
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
    const variables = slots.map(slot => ({ id: slot.key, type: "string", content_layer: "semantic-prose", required: false, evidence_required: true }));
    const sections = slots.map(slot => ({ section_key: slot.key, presence: "optional", question_ref: `question:${blueprint}-${slot.key}`,
      reader_goal: goal, variable_ids: [slot.key], deterministic_block_ids: [], accepted_evidence_kinds: ["code", "contract", "configuration", "documentation"],
      minimum_evidence_items: 0, on_missing: "omit", deletion_condition: "Omit when not applicable or no supported value is supplied." }));
    const blocks = includeApi ? [{id: "api-table", renderer: "public-contract-table", source_variable_id: apiVariable}] : [];
    if (includeApi) sections.splice(3, 0, { ...sections[0]!, section_key: apiVariable, question_ref: "question:public-contract", variable_ids: [apiVariable], deterministic_block_ids: ["api-table"] });
    const contract = indexerTemplateContractSchema.parse({ protocol: "context.indexer.template/v1", template_id: id, profile: ref.profile, reader_goal: goal,
      applicability: { artifact_policy_variants: profile.artifact_policy_variants.map(item => item.id), condition_refs: [] },
      variables: [...variables, ...(includeApi ? [{id: apiVariable, type: "json", content_layer: "deterministic-fact", required: false, evidence_required: true}] : [])],
      deterministic_blocks: blocks,
      sections,
      page_policy: {split_suggestion: "Split by independently useful reader task when supported; preserve stable article identities.", semantic_boundaries: ["reader-task", "source-boundary"], keep_single_page_conditions: ["one-reader-subject"]},
      anonymous_section_examples: ["A source-backed explanation that names an entry and the next investigation step."],
      anti_examples: ["Invented relationships or current runtime values inferred from names alone."],
      forbidden_outputs: ["Unresolved internal identifiers in reader-facing prose."], maximum_rendered_bytes: 1048576 });
    const resource = `templates/article-programs/${id}.md`;
    await mkdir(join(skill, "templates/article-programs"), {recursive: true});
    const bodies = slots.map(slot => `<!-- context:indexer-section ${slot.key} -->\n## ${slot.heading}\n\n{{variable:${slot.key}}}\n<!-- /context:indexer-section -->`);
    if (includeApi) bodies.splice(3, 0, `<!-- context:indexer-section ${apiVariable} -->\n## API\n\n{{block:api-table}}\n<!-- /context:indexer-section -->`);
    const body = bodies.join("\n\n");
    await writeFile(join(skill, resource), `---\n${JSON.stringify(contract, null, 2)}\n---\n${body}\n`);
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
  await writeFile(manifestPath, YAML.stringify(JSON.parse(JSON.stringify(manifest)), {lineWidth: 120}));
}
process.stdout.write(`Generated ${count} profile-bound article programs.\n`);
