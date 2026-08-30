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
