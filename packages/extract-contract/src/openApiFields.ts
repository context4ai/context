import type { ContractField } from "./contractTypes.js";

const record = (value: unknown): Record<string, unknown> => value !== null &&
  typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function resolved(value: unknown, root: unknown, seen = new Set<string>()): Record<string, unknown> {
  const schema = record(value);
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/") || seen.has(ref)) return schema;
  seen.add(ref);
  let target = root;
  for (const part of ref.slice(2).split("/")) target = record(target)[part.replace(/~1/gu, "/").replace(/~0/gu, "~")];
  return target === undefined ? schema : { ...resolved(target, root, seen), ...schema };
}
function declaredType(schema: Record<string, unknown>): string {
  if (typeof schema.$ref === "string") return schema.$ref;
  if (schema.type === "array") return `Array<${declaredType(record(schema.items))}>`;
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    return ((schema.oneOf ?? schema.anyOf) as unknown[]).map((item) => declaredType(record(item))).join(" | ");
  }
  return Array.isArray(schema.type) ? schema.type.join(" | ") : typeof schema.type === "string" ? schema.type : "not declared";
}
function constraints(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(["enum", "const", "format", "pattern", "minimum", "maximum", "minLength", "maxLength",
    "minItems", "maxItems", "nullable", "readOnly", "writeOnly", "additionalProperties"]
    .filter((key) => schema[key] !== undefined).map((key) => [key, schema[key]]));
}
export function openApiFields(value: unknown, depth = 0, root: unknown = value): ContractField[] {
  if (depth > 8) return [];
  const schema = resolved(value, root);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const own = Object.entries(record(schema.properties)).map(([name, raw]) => {
    const field = resolved(raw, root);
    return { name, type: declaredType(field),
      constraints: constraints(field),
      optional: !required.has(name),
      ...(field.default === undefined ? {} : { defaultValue: JSON.stringify(field.default) }),
      ...(typeof field.description === "string" ? { description: field.description } : {}),
      ...(field.properties === undefined ? {} : { fields: openApiFields(field, depth + 1, root) }),
    };
  });
  const inherited = Array.isArray(schema.allOf) ? schema.allOf.flatMap((part) => openApiFields(part, depth + 1, root)) : [];
  return [...new Map([...inherited, ...own].map((field) => [field.name, field])).values()];
}

export function openApiOperationFields(path: Record<string, unknown>, operation: Record<string, unknown>, root: unknown = {}): ContractField[] {
  const parameters = new Map<string, Record<string, unknown>>();
  for (const raw of [...(Array.isArray(path.parameters) ? path.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
    const parameter = resolved(raw, root);
    parameters.set(`${parameter.in}/${parameter.name}`, parameter);
  }
  const fields: ContractField[] = [...parameters.values()].map((parameter) => {
    const schema = resolved(parameter.schema ?? parameter, root);
    return { name: String(parameter.name ?? parameter.$ref ?? "parameter"),
      type: declaredType(schema), constraints: constraints(schema), optional: parameter.required !== true,
      location: String(parameter.in ?? "reference"),
      ...(schema.default === undefined ? {} : { defaultValue: JSON.stringify(schema.default) }),
      ...(typeof parameter.description === "string" ? { description: parameter.description } : {}),
    };
  });
  const body = resolved(operation.requestBody, root);
  for (const [media, value] of Object.entries(record(body.content))) {
    const schema = resolved(record(value).schema, root);
    fields.push({ name: `request (${media})`, type: declaredType(schema), constraints: constraints(schema),
      optional: body.required !== true, location: "body", fields: openApiFields(schema, 0, root) });
  }
  for (const [status, response] of Object.entries(record(operation.responses))) {
    const content = record(resolved(response, root).content);
    for (const [media, value] of Object.entries(content)) {
      const schema = resolved(record(value).schema, root);
      fields.push({ name: `response ${status} (${media})`, type: declaredType(schema), constraints: constraints(schema),
        optional: false, location: "response", fields: openApiFields(schema, 0, root) });
    }
  }
  return fields;
}
