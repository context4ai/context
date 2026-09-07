import type { ThriftToken } from "./thriftLexer.js";

export interface ThriftField {
  name: string;
  type: string;
  number: string;
  optional?: boolean;
  defaultValue?: string;
  location: { line: number; column: number };
}

export function thriftFields(tokens: readonly ThriftToken[]): ThriftField[] {
  const fields: ThriftField[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]?.kind !== "number" || tokens[index + 1]?.value !== ":") continue;
    const number = tokens[index]!.value;
    let cursor = index + 2;
    const label = tokens[cursor]?.value;
    if (label === "optional" || label === "required") cursor++;
    const typeStart = cursor++;
    if (tokens[cursor]?.value === "<") {
      let depth = 0;
      do {
        if (tokens[cursor]?.value === "<") depth++;
        if (tokens[cursor]?.value === ">") depth--;
        cursor++;
      } while (cursor < tokens.length && depth > 0);
    }
    const name = tokens[cursor];
    if (name?.kind !== "identifier") continue;
    const type = tokens.slice(typeStart, cursor).map((token) => token.value).join("");
    cursor++;
    let defaultValue: string | undefined;
    if (tokens[cursor]?.value === "=") {
      const start = ++cursor;
      let depth = 0;
      do {
        if (["[", "{"].includes(tokens[cursor]?.value ?? "")) depth++;
        if (["]", "}"].includes(tokens[cursor]?.value ?? "")) depth--;
        cursor++;
      } while (cursor < tokens.length && depth > 0);
      defaultValue = tokens.slice(start, cursor).map((token) => token.kind === "string" ? JSON.stringify(token.value) : token.value).join("");
    }
    fields.push({ name: name.value, type, number,
      ...(label === "optional" ? { optional: true } : label === "required" ? { optional: false } : {}),
      ...(defaultValue === undefined ? {} : { defaultValue }), location: { line: name.line, column: name.column } });
    index = cursor - 1;
  }
  return fields;
}
