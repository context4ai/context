import type { IndexerArtifactFact } from "./indexerContentLayers.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
const text = (value: unknown): string => typeof value === "string" ? value : "";

/** Mechanically project already authorized declarations. No source traversal,
 * runtime evaluation, reader-purpose inference, or behavior classification. */
export function projectIndexerPublicContractTable(fact: IndexerArtifactFact): { columns: string[]; rows: string[][] } | undefined {
  const value = record(fact.value);
  if (value === undefined) return undefined;
  const rows: string[][] = [];
  const add = (field: Record<string, unknown>, owner: string): void => {
    rows.push([
      owner, text(field.name), text(field.typeAnnotation ?? field.type ?? field.signature),
      field.optional === true ? "optional" : field.optional === false ? "required" : "not declared",
      field.defaultValue === undefined ? "not declared" : typeof field.defaultValue === "string"
        ? field.defaultValue : JSON.stringify(field.defaultValue),
      [field.readonly === true ? "readonly" : "", field.rest === true ? "rest" : "",
        text(field.location), field.number === undefined ? "" : `field ${String(field.number)}`,
        field.repeated === true ? "repeated" : "", text(field.oneof), text(field.doc ?? field.description),
        field.constraints === undefined ? "" : JSON.stringify(field.constraints)].filter(Boolean).join("; "),
    ]);
    if (Array.isArray(field.fields)) for (const item of field.fields) {
      const child = record(item);
      if (child !== undefined) add(child, `${owner}.${text(field.name)}`);
    }
  };
  const owner = text(value.name ?? value.qualifiedName);
  if (typeof value.typeAnnotation === "string" || typeof value.initializer === "string") {
    rows.push([owner, "declaration", [text(value.typeAnnotation), typeof value.initializer === "string"
      ? `= ${value.initializer}` : ""].filter(Boolean).join(" "), "", "", ""]);
  }
  const registration = record(value.registration);
  if (registration !== undefined) rows.push([text(registration.kind), text(registration.key),
    text(registration.handler), "", "", [text(registration.method),
      Array.isArray(registration.middleware) ? registration.middleware.map(String).join(" → ") : ""].filter(Boolean).join("; ")]);
  if (Array.isArray(value.members)) for (const member of value.members) {
    const field = record(member);
    if (field !== undefined && field.visibility !== "internal" && field.visibility !== "private") add(field, owner);
  }
  // Resolved component Props are already the public input table. Do not repeat
  // the implementation's destructured parameter as an additional API field.
  if (Array.isArray(value.params) && !(value.kind === "component" && Array.isArray(value.members) && value.members.length > 0)) for (const parameter of value.params) {
    const field = record(parameter);
    if (field !== undefined) add(field, owner);
  }
  if (Array.isArray(value.fields)) for (const member of value.fields) {
    const field = record(member);
    if (field !== undefined) add(field, owner);
  }
  if (Array.isArray(value.throws)) for (const item of value.throws) {
    const field = record(item);
    if (field !== undefined) add(field, `${owner} throws`);
  }
  for (const [key, label] of [["input_type", "request"], ["output_type", "response"], ["return_type", "return"]] as const) {
    if (typeof value[key] === "string") rows.push([owner, label, value[key], "", "", [
      key === "input_type" && value.client_streaming === true ? "client streaming" : "",
      key === "output_type" && value.server_streaming === true ? "server streaming" : "",
      value.oneway === true ? "oneway" : ""].filter(Boolean).join("; ")]);
  }
  if (Array.isArray(value.overloads)) for (const signature of value.overloads) {
    if (typeof signature === "string") rows.push([owner, "signature", signature, "", "", ""]);
  } else if (typeof value.signature === "string") rows.push([owner, "signature", value.signature, "", "", ""]);
  if (Array.isArray(value.publicEntrypoints)) for (const entry of value.publicEntrypoints) {
    if (typeof entry === "string") rows.push([owner, "export entry", entry, "", "", ""]);
  }
  // Static route and operation records keep their declared roles. A call or an
  // exported function alone is never promoted to a server endpoint.
  if (typeof value.handler === "string" && (typeof value.path === "string" || typeof value.method === "string")) {
    rows.push([text(value.method), text(value.path), value.handler, "", "", Array.isArray(value.middleware) ? value.middleware.map(String).join(" → ") : ""]);
  }
  if (rows.length === 0) return undefined;
  return { columns: ["Contract", "Name", "Declaration", "Required", "Default", "Notes"], rows };
}
