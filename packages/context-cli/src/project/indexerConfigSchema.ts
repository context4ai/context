import { canonicalIndexerJson, type IndexerJson } from "@c4a/context";

const ALLOWED_KEYS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
]);
const JSON_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const MAX_SCHEMA_DEPTH = 16;
const MAX_SCHEMA_NODES = 1024;

interface ValidationBudget {
  nodes: number;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function numberKeyword(
  schema: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = schema[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`config schema ${key} must be a finite number`);
  }
  return value;
}

function integerKeyword(
  schema: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = numberKeyword(schema, key);
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new TypeError(`config schema ${key} must be a non-negative integer`);
  }
  return value;
}

function validateMetadata(schema: Record<string, unknown>): void {
  for (const key of ["$schema", "$id", "title", "description"]) {
    if (schema[key] !== undefined && typeof schema[key] !== "string") {
      throw new TypeError(`config schema ${key} must be a string`);
    }
  }
}

function assertJsonValue(value: unknown, field: string): asserts value is IndexerJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${field}.${index}`));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${field} must be a plain JSON object`);
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
      assertJsonValue(item, `${field}.${key}`)
    );
    return;
  }
  throw new TypeError(`${field} must be a JSON value`);
}

function validateLiteralKeywords(
  schema: Record<string, unknown>,
  schemaType: string,
  field: string,
): void {
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      throw new TypeError(`${field}.enum must be a non-empty array`);
    }
    schema.enum.forEach((item, index) => {
      assertJsonValue(item, `${field}.enum.${index}`);
      assertType(item, schemaType, `${field}.enum.${index}`);
    });
    if (new Set(schema.enum.map(canonicalIndexerJson)).size !== schema.enum.length) {
      throw new TypeError(`${field}.enum must contain unique values`);
    }
  }
  if (schema.const !== undefined) {
    assertJsonValue(schema.const, `${field}.const`);
    assertType(schema.const, schemaType, `${field}.const`);
  }
}

function validateObjectKeywords(
  schema: Record<string, unknown>,
  depth: number,
  budget: ValidationBudget,
  field: string,
): void {
  if (schema.type !== "object") {
    if (schema.properties !== undefined || schema.required !== undefined ||
      schema.additionalProperties !== undefined) {
      throw new TypeError(`${field} uses object keywords with type ${schema.type}`);
    }
    return;
  }
  if (schema.additionalProperties !== false) {
    throw new TypeError(`${field} object schemas require additionalProperties: false`);
  }
  const properties = record(schema.properties ?? {}, `${field}.properties`);
  Object.entries(properties).forEach(([key, child]) => {
    validateSchemaNode(child, depth + 1, budget, `${field}.properties.${key}`);
  });
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some((key) => typeof key !== "string")) {
    throw new TypeError(`${field}.required must be a string array`);
  }
  if (new Set(required).size !== required.length || required.some((key) => !(key in properties))) {
    throw new TypeError(`${field}.required must be unique and reference declared properties`);
  }
}

function validateArrayKeywords(
  schema: Record<string, unknown>,
  depth: number,
  budget: ValidationBudget,
  field: string,
): void {
  if (schema.type !== "array") {
    if (schema.items !== undefined || schema.minItems !== undefined ||
      schema.maxItems !== undefined || schema.uniqueItems !== undefined) {
      throw new TypeError(`${field} uses array keywords with type ${schema.type}`);
    }
    return;
  }
  if (schema.items === undefined) throw new TypeError(`${field} array schema requires items`);
  validateSchemaNode(schema.items, depth + 1, budget, `${field}.items`);
  const minItems = integerKeyword(schema, "minItems");
  const maxItems = integerKeyword(schema, "maxItems");
  if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
    throw new TypeError(`${field} minItems exceeds maxItems`);
  }
  if (schema.uniqueItems !== undefined && schema.uniqueItems !== true) {
    throw new TypeError(`${field}.uniqueItems only supports true when present`);
  }
}

function validateScalarKeywords(schema: Record<string, unknown>, field: string): void {
  const minimum = numberKeyword(schema, "minimum");
  const maximum = numberKeyword(schema, "maximum");
  if (schema.type !== "number" && schema.type !== "integer" &&
    (minimum !== undefined || maximum !== undefined)) {
    throw new TypeError(`${field} uses numeric keywords with type ${schema.type}`);
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new TypeError(`${field} minimum exceeds maximum`);
  }
  const minLength = integerKeyword(schema, "minLength");
  const maxLength = integerKeyword(schema, "maxLength");
  if (schema.type !== "string" && (minLength !== undefined || maxLength !== undefined)) {
    throw new TypeError(`${field} uses string keywords with type ${schema.type}`);
  }
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw new TypeError(`${field} minLength exceeds maxLength`);
  }
}

function validateSchemaNode(
  value: unknown,
  depth: number,
  budget: ValidationBudget,
  field: string,
): Record<string, unknown> {
  if (depth > MAX_SCHEMA_DEPTH) throw new TypeError("config schema exceeds its depth limit");
  budget.nodes += 1;
  if (budget.nodes > MAX_SCHEMA_NODES) throw new TypeError("config schema exceeds its node limit");
  const schema = record(value, field);
  const unknown = Object.keys(schema).find((key) => !ALLOWED_KEYS.has(key));
  if (unknown !== undefined) {
    throw new TypeError(`config schema uses unsupported keyword ${unknown}`);
  }
  validateMetadata(schema);
  if (typeof schema.type !== "string" || !JSON_TYPES.has(schema.type)) {
    throw new TypeError(`${field}.type must be one supported JSON type`);
  }
  validateLiteralKeywords(schema, schema.type, field);
  validateObjectKeywords(schema, depth, budget, field);
  validateArrayKeywords(schema, depth, budget, field);
  validateScalarKeywords(schema, field);
  return schema;
}

function assertType(value: IndexerJson, type: string, field: string): void {
  const valid = type === "null"
    ? value === null
    : type === "array"
      ? Array.isArray(value)
      : type === "object"
        ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "integer"
          ? typeof value === "number" && Number.isInteger(value)
          : typeof value === type;
  if (!valid) throw new TypeError(`${field} must have JSON type ${type}`);
}

function validateInstance(value: IndexerJson, schema: Record<string, unknown>, field: string): void {
  const type = schema.type as string;
  assertType(value, type, field);
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => canonicalIndexerJson(item) === canonicalIndexerJson(value))
  ) {
    throw new TypeError(`${field} is outside the config schema enum`);
  }
  if (
    schema.const !== undefined &&
    canonicalIndexerJson(schema.const) !== canonicalIndexerJson(value)
  ) {
    throw new TypeError(`${field} does not match the config schema const`);
  }
  if (type === "object") {
    const instance = value as Record<string, IndexerJson>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const required = (schema.required ?? []) as string[];
    const missing = required.find((key) => !(key in instance));
    if (missing !== undefined) throw new TypeError(`${field} is missing required property ${missing}`);
    const unknown = Object.keys(instance).find((key) => !(key in properties));
    if (unknown !== undefined) throw new TypeError(`${field} contains unknown property ${unknown}`);
    Object.entries(instance).forEach(([key, item]) => {
      validateInstance(item, properties[key]!, `${field}.${key}`);
    });
  }
  if (type === "array") {
    const array = value as IndexerJson[];
    const minItems = schema.minItems as number | undefined;
    const maxItems = schema.maxItems as number | undefined;
    if (minItems !== undefined && array.length < minItems) throw new TypeError(`${field} has too few items`);
    if (maxItems !== undefined && array.length > maxItems) throw new TypeError(`${field} has too many items`);
    if (schema.uniqueItems === true && new Set(array.map(canonicalIndexerJson)).size !== array.length) {
      throw new TypeError(`${field} must contain unique items`);
    }
    array.forEach((item, index) => {
      validateInstance(item, schema.items as Record<string, unknown>, `${field}.${index}`);
    });
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new TypeError(`${field} is below minimum`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new TypeError(`${field} is above maximum`);
    }
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      throw new TypeError(`${field} is shorter than minLength`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      throw new TypeError(`${field} is longer than maxLength`);
    }
  }
}

export function validateIndexerProviderConfig(
  schemaValue: unknown,
  config: Record<string, IndexerJson>,
): void {
  const schema = validateSchemaNode(schemaValue, 0, { nodes: 0 }, "config_schema");
  if (schema.type !== "object") throw new TypeError("Provider config schema root must be an object");
  validateInstance(config, schema, "config");
}
