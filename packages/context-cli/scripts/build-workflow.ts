#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertSchemaDocument,
  buildProviderBundle,
  loadProvider,
  type LoadedProvider,
} from "@c4a/agent-graph";
import { syncIndexerActionSchema, syncApprovedRevisionSchema } from "./indexerActionSchema.js";

const CURRENT_ACTION_SCHEMA = "schemas/indexer-agent-step-result.schema.json";
const CURRENT_ACTION_SCHEMA_ID = "context.indexer.current-action-input/v2";

async function assertCurrentIndexerWorkflowContract(provider: LoadedProvider): Promise<void> {
  const graph = [...provider.graphs.values()].find(item => item.definition.id === "indexer");
  if (!graph) throw new Error("Context workflow Provider has no indexer Graph");
  const contracts = [
    { id: "plan-production-stage", resolution: false, runner: "agent" },
    { id: "work-production-stage", resolution: false, runner: "agent" },
    { id: "confirm-production-report", resolution: true, runner: "agent" },
    { id: "prepare-production-planning", resolution: false, runner: "command" },
    { id: "prepare-production-stage", resolution: false, runner: "command" },
    { id: "author-approved-revision", resolution: false, runner: "agent", schema: "schemas/approved-revision-result.schema.json" },
    { id: "inspect-source-update", resolution: false, runner: "agent", schema: "schemas/source-update-result.schema.json" },
    { id: "review-current-indexer-structure", resolution: true, runner: "agent", schema: CURRENT_ACTION_SCHEMA },
  ];
  for (const expected of contracts) {
    const node = graph.nodeById.get(expected.id);
    const reference = expected.resolution ? node?.kind === "gate" ? node.resolutionAction : undefined
      : node?.kind === "action" ? node.action : undefined;
    const action = reference ? provider.actions.get(resolve(provider.root, reference))?.definition : undefined;
    if (!action || action.runner !== expected.runner || action.effect !== "write" ||
        action.outputSchema !== expected.schema || expected.runner === "agent" && !action.skill) {
      throw new Error("Current workflow action contract is invalid: " + expected.id);
    }
  }
  const schemaPath = resolve(provider.root, CURRENT_ACTION_SCHEMA);
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { $id?: unknown };
  assertSchemaDocument(schema, schemaPath);
  if (schema.$id !== CURRENT_ACTION_SCHEMA_ID) throw new Error("Current maintenance action schema identity is invalid");
}

const packageRoot = resolve(import.meta.dir, "..");
const packageJson = JSON.parse(
  await readFile(resolve(packageRoot, "package.json"), "utf8"),
) as { version: string };
const providerPath = resolve(packageRoot, "context-workflow", "provider.yaml");
const outputPath = resolve(packageRoot, "dist", "providers", "context");
// SDK docs are the source of truth for Route manuals, including linked source guides.
const sdkManuals = [
  "reference/project-api.md",
  "reference/code-extractors.md",
  "reference/package-templates.md",
  "reference/template-variables.md",
  "guides/package-outputs.md",
  "guides/lark-resources.md",
  "guides/knowledge-updates.md",
  "guides/workspace-prepare.md",
  "guides/workspace-commit.md",
  "guides/workspace-restore.md",
  "guides/note.md",
  "guides/sessions.md",
  "guides/indexer-provider-and-customization.md",
  "guides/code-indexer-skill-authoring.md",
  "guides/markdown-indexer-skill-authoring.md",
];
for (const manual of sdkManuals) {
  const target = resolve(packageRoot, "context-workflow/resources/manuals", manual);
  const id = manual.split("/").at(-1)!.replace(/\.md$/u, "");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target,
    `---\nid: context.sdk.${id}\nkind: procedure\nmediaType: text/markdown\n---\n\n` +
    await readFile(resolve(packageRoot, "../context/docs", manual), "utf8"));
}
await syncIndexerActionSchema(resolve(packageRoot, "context-workflow", CURRENT_ACTION_SCHEMA));
await syncApprovedRevisionSchema(resolve(packageRoot, "context-workflow/schemas/approved-revision-result.schema.json"));
for (const sourceGuide of ["note", "sessions", "workspace-prepare", "workspace-commit", "workspace-restore"]) {
  await writeFile(resolve(packageRoot, `context-workflow/resources/procedures/${sourceGuide}.md`),
    `---\nid: procedure.${sourceGuide}\nkind: procedure\nmediaType: text/markdown\n---\n\n` +
    await readFile(resolve(packageRoot, `../context/docs/guides/${sourceGuide}.md`), "utf8"));
}
await writeFile(resolve(packageRoot, "context-workflow/resources/procedures/knowledge-updates.md"),
  "---\nid: procedure.knowledge-updates\nkind: procedure\nmediaType: text/markdown\n---\n\n" +
  await readFile(resolve(packageRoot, "../context/docs/guides/knowledge-updates.md"), "utf8"));
const provider = await loadProvider(providerPath);
await assertCurrentIndexerWorkflowContract(provider);

if (provider.manifest.version !== packageJson.version) {
  throw new Error(
    `Context workflow Provider version ${provider.manifest.version} does not match @c4a/context-cli ${packageJson.version}`,
  );
}

const manifest = await buildProviderBundle(provider, outputPath);
process.stdout.write(
  `  Context workflow → dist/providers/context/ (${manifest.files.length} files · ${manifest.digest})\n`,
);
