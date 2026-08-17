import { createHash, randomUUID } from "node:crypto";

export function generateId(type: string, parentId: string, name: string): string {
  const input = `${type}:${parentId}:${name}`;
  const hash = createHash("sha256").update(input).digest("hex");
  const hex32 = hash.slice(0, 32);
  return `${type}_${hex32}`;
}

export function generateUUID(): string {
  return randomUUID();
}
