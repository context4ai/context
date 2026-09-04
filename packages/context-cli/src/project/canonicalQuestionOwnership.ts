const QUESTION_PAYLOAD_KEYS = [
  "semantic",
  "version",
  "selector",
  "evidence_contract",
  "target_domain",
  "exclusion_semantics",
] as const;

export interface CanonicalQuestionPayloadFinding {
  path: string;
  pointer: string;
  payload_keys: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findCanonicalQuestionPayloads(
  path: string,
  value: unknown,
  pointer = "$",
): CanonicalQuestionPayloadFinding[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findCanonicalQuestionPayloads(path, item, `${pointer}[${index}]`)
    );
  }
  if (!isRecord(value)) return [];
  const payloadKeys = QUESTION_PAYLOAD_KEYS.filter((key) => Object.hasOwn(value, key));
  const hasQuestionIdentity = ["question", "question_id", "question_ref", "ref"]
    .some((key) => Object.hasOwn(value, key));
  const current: CanonicalQuestionPayloadFinding[] =
    payloadKeys.length >= 3 || (hasQuestionIdentity && payloadKeys.length >= 2)
    ? [{ path, pointer, payload_keys: [...payloadKeys] }]
    : [];
  return current.concat(Object.entries(value).flatMap(([key, child]) =>
    findCanonicalQuestionPayloads(path, child, `${pointer}.${key}`)
  ));
}

export function findCanonicalQuestionDefinitionKeys(source: string): string[] {
  return QUESTION_PAYLOAD_KEYS.filter((key) => {
    const property = new RegExp(`(?:^|[,{\\s])(?:["']${key}["']|${key})\\s*:`, "mu");
    return property.test(source);
  });
}

export function assertNoCanonicalQuestionDefinition(path: string, source: string): void {
  const keys = findCanonicalQuestionDefinitionKeys(source);
  if (keys.length >= 3) {
    throw new TypeError(
      `${path} duplicates canonical question contract payload fields: ${keys.join(", ")}`,
    );
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function inspectCanonicalQuestionPayloadsInBundle(input: {
  repositoryRoot: string;
  bundlePath: string;
}): Promise<CanonicalQuestionPayloadFinding[]> {
  const findings: CanonicalQuestionPayloadFinding[] = [];
  for (const absolute of await collectFiles(join(input.repositoryRoot, input.bundlePath))) {
    const extension = extname(absolute);
    const path = relative(input.repositoryRoot, absolute).split(sep).join("/");
    const source = await readFile(absolute, "utf8");
    if ([".json", ".yaml", ".yml"].includes(extension)) {
      const parsed = extension === ".json"
        ? JSON.parse(source) as unknown
        : YAML.parse(source) as unknown;
      findings.push(...findCanonicalQuestionPayloads(path, parsed));
      continue;
    }
    const payloadKeys = findCanonicalQuestionDefinitionKeys(source);
    if (payloadKeys.length >= 3) {
      findings.push({ path, pointer: "$text", payload_keys: payloadKeys });
    }
  }
  return findings;
}
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import YAML from "yaml";
