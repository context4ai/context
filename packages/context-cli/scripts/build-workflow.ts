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

async function assertCurrentIndexerWorkflowContract(
  provider: LoadedProvider,
): Promise<void> {
  const graph = [...provider.graphs.values()].find((item) =>
    item.definition.id === "indexer"
  );
  if (graph === undefined) {
    throw new Error("Context workflow Provider has no indexer Graph");
  }
  const semanticNodes = [
    { id: "configure-indexer-providers", contract: "action", effect: "write" },
    { id: "run-current-indexer-agent", contract: "action", effect: "write" },
    { id: "review-current-indexer-structure", contract: "resolution", effect: "write" },
    { id: "confirm-current-indexer-obsolete-scope", contract: "resolution", effect: "write" },
    { id: "run-current-indexer-composer", contract: "action", effect: "write" },
    { id: "confirm-current-indexer-layout", contract: "resolution", effect: "write" },
    { id: "resolve-current-indexer-provider", contract: "action", effect: "external" },
    {
      id: "authorize-current-indexer-provider-program",
      contract: "resolution",
      effect: "external",
    },
  ] as const;
  for (const expected of semanticNodes) {
    const node = graph.nodeById.get(expected.id);
    if (node === undefined) {
      throw new Error(`Context indexer Graph has no ${expected.id} node`);
    }
    const reference = expected.contract === "action"
      ? node.kind === "action" ? node.action : undefined
      : node.kind === "gate" ? node.resolutionAction : undefined;
    if (reference === undefined) {
      throw new Error(
        `Context indexer ${expected.id} has no Graph-owned ${expected.contract} Action`,
      );
    }
    const action = provider.actions.get(resolve(provider.root, reference))?.definition;
    if (action === undefined) {
      throw new Error(`Context indexer ${expected.id} references missing Action ${reference}`);
    }
    if (
      action.runner !== "agent" ||
      action.effect !== expected.effect ||
      action.skill === undefined ||
      action.outputSchema !== CURRENT_ACTION_SCHEMA
    ) {
      throw new Error(
        `Context indexer ${expected.id} must use an Agent ${expected.effect} Action with Skill and ${CURRENT_ACTION_SCHEMA}`,
      );
    }
  }
  for (const id of [
    "advance-current-indexer-lifecycle",
    "finalize-current-indexer-provider-selection",
  ]) {
    const node = graph.nodeById.get(id);
    const reference = node?.kind === "action" ? node.action : undefined;
    const action = reference === undefined
      ? undefined
      : provider.actions.get(resolve(provider.root, reference))?.definition;
    if (
      action === undefined ||
      action.runner === "agent" ||
      action.effect !== "write" ||
      action.outputSchema !== undefined
    ) {
      throw new Error(
        `Context deterministic Indexer Action ${id} must not expose an Agent output contract`,
      );
    }
  }
  const schemaPath = resolve(provider.root, CURRENT_ACTION_SCHEMA);
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    $id?: unknown;
  };
  assertSchemaDocument(schema, schemaPath);
  if (schema.$id !== CURRENT_ACTION_SCHEMA_ID) {
    throw new Error(
      `Context current Action Schema must use ${CURRENT_ACTION_SCHEMA_ID}`,
    );
  }
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
// Ship the selection guide with its linked manuals, independent of the workspace SDK.
for (const manual of [
  "guides/indexer-provider-and-customization.md",
  "guides/code-indexer-skill-authoring.md",
  "guides/markdown-indexer-skill-authoring.md",
  "guides/note.md",
  "guides/sessions.md",
  "reference/indexer-provider-protocol.md",
]) {
  const target = resolve(packageRoot,
    "context-workflow/skills/configure-indexer-providers/references", manual);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(resolve(packageRoot, "../context/docs", manual), "utf8"));
}
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
