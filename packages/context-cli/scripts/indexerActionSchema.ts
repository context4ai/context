import { readFile, writeFile } from "node:fs/promises";
import { indexerCurrentActionInputDefinitions } from "@c4a/context";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Export the accepted input, not the values produced by Zod transforms.
 * Cross-entry ownership and custom refinements remain runtime validation.
 */
function inputDefinition(name: keyof typeof indexerCurrentActionInputDefinitions) {
  const { $schema: _dialect, ...schema } = zodToJsonSchema(
    indexerCurrentActionInputDefinitions[name],
    {
      target: "jsonSchema2019-09",
      basePath: ["#", "$defs", name],
      effectStrategy: "input",
    },
  );
  if (name === "authorBatch") {
    // The CLI resolves the current task before parsing each Author result.
    // Standalone SDK semantic inputs retain their required group identity.
    const inheritGroup = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(inheritGroup); return; }
      const node = value as Record<string, unknown>;
      const properties = node.properties as Record<string, unknown> | undefined;
      if (properties?.group_key !== undefined && Array.isArray(node.required)) {
        node.required = node.required.filter(key => key !== "group_key");
        properties.group_key = { ...(properties.group_key as object),
          description: "May be omitted in a CLI batch to inherit the current task's group. An explicit value must match; standalone SDK results still require it." };
      }
      Object.values(node).forEach(inheritGroup);
    };
    inheritGroup(schema);
  }
  return schema;
}

export function indexerCurrentActionJsonSchema() {
  const names = Object.keys(indexerCurrentActionInputDefinitions) as Array<
    keyof typeof indexerCurrentActionInputDefinitions
  >;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "context.indexer.current-action-input/v2",
    $comment: "Generated from indexerCurrentActionInputDefinitions; do not edit by hand. Runtime validation additionally checks current-workset references, ownership and unique task keys.",
    oneOf: names.map((name) => ({ $ref: `#/$defs/${name}` })),
    $defs: Object.fromEntries(names.map((name) => [name, inputDefinition(name)])),
  };
}

export async function syncIndexerActionSchema(path: string): Promise<void> {
  const original = await readFile(path, "utf8");
  const document = indexerCurrentActionJsonSchema();
  const updated = `${JSON.stringify(document, null, 2)}\n`;
  if (updated !== original) await writeFile(path, updated);
}

export async function syncApprovedRevisionSchema(path: string): Promise<void> {
  const schema = zodToJsonSchema(indexerCurrentActionInputDefinitions.approvedRevision,
    { target: "jsonSchema2019-09", effectStrategy: "input" });
  const updated = `${JSON.stringify(schema, null, 2)}\n`;
  if (await readFile(path, "utf8") !== updated) await writeFile(path, updated);
}
