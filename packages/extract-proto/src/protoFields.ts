import type { ProtoToken } from "./protoLexer.js";

export interface ProtoField {
  name: string;
  type: string;
  number: string;
  optional?: boolean;
  repeated: boolean;
  oneof?: string;
  defaultValue?: string;
  location: { line: number; column: number };
}

export function protoFields(tokens: readonly ProtoToken[], kind: "message" | "enum", oneof?: string): ProtoField[] {
  const fields: ProtoField[] = [];
  let start = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.value === "{") {
      let end = index + 1;
      let depth = 1;
      for (; end < tokens.length && depth > 0; end++) {
        if (tokens[end]!.value === "{") depth++;
        if (tokens[end]!.value === "}") depth--;
      }
      if (tokens[start]?.value === "oneof") fields.push(...protoFields(tokens.slice(index + 1, end - 1), "message", tokens[start + 1]?.value));
      index = end - 1;
      start = end;
      continue;
    }
    if (tokens[index]!.value !== ";") continue;
    const statement = tokens.slice(start, index);
    start = index + 1;
    if (["option", "reserved", "extensions"].includes(statement[0]?.value ?? "")) continue;
    const equals = statement.findIndex((token) => token.value === "=");
    const name = statement[equals - 1];
    const number = statement[equals + 1];
    if (name?.kind !== "identifier" || number === undefined) continue;
    const label = statement[0]?.value;
    const offset = ["optional", "required", "repeated"].includes(label ?? "") ? 1 : 0;
    const defaultIndex = statement.findIndex((token, at) => token.value === "default" && statement[at + 1]?.value === "=");
    const defaultToken = statement[defaultIndex + 2];
    fields.push({ name: name.value, number: number.value,
      type: kind === "enum" ? "enum value" : statement.slice(offset, equals - 1).map((token) => token.value).join(""),
      ...(label === "optional" ? { optional: true } : label === "required" ? { optional: false } : {}),
      repeated: label === "repeated", ...(oneof === undefined ? {} : { oneof }),
      ...(defaultIndex < 0 || defaultToken === undefined ? {} : { defaultValue: defaultToken.kind === "string" ? JSON.stringify(defaultToken.value) : defaultToken.value }),
      location: { line: name.line, column: name.column },
    });
  }
  return fields;
}
