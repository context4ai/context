import { createHash } from "node:crypto";

export function contentHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
