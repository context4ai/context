import { expect, test } from "bun:test";
import { openApiOperationFields } from "../openApiFields.js";

test("operation contract keeps parameter overrides, nested local refs, defaults and constraints", () => {
  const root = { components: { schemas: { Item: { type: "object", required: ["name"], properties: {
    name: { type: "string", minLength: 1 }, count: { type: "integer", default: 0 },
  } } } } };
  const fields = openApiOperationFields({ parameters: [{ in: "query", name: "limit", schema: { type: "integer" } }] }, {
    parameters: [{ in: "query", name: "limit", required: true, schema: { type: "integer", default: 10, maximum: 100 } }],
    requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } } },
    responses: { 200: { content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
  }, root);
  expect(fields[0]).toMatchObject({ name: "limit", optional: false, defaultValue: "10", constraints: { maximum: 100 } });
  expect(fields[1]?.fields).toMatchObject([{ name: "name", optional: false }, { name: "count", defaultValue: "0" }]);
  expect(fields[2]?.type).toBe("Array<string>");
});
