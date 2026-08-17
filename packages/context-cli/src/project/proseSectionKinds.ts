export const PROSE_SECTION_KINDS = [
  "description",
  "principle",
  "decision",
  "spec",
  "warning",
  "comparison",
  "example",
  "faq",
  "incident",
  "changelog",
] as const;

export type ProseSectionKind = typeof PROSE_SECTION_KINDS[number];

export const PROSE_SECTION_KIND_PRIORITY: readonly ProseSectionKind[] = [
  "example",
  "comparison",
  "faq",
  "incident",
  "changelog",
  "decision",
  "spec",
  "warning",
  "principle",
  "description",
];

const PROSE_SECTION_KIND_SET = new Set<string>(PROSE_SECTION_KINDS);

const PROSE_SECTION_MOUNT_RULES: Record<string, ReadonlySet<ProseSectionKind>> = {
  domain: new Set<ProseSectionKind>(["description", "warning", "principle", "decision", "faq"]),
  entity: new Set<ProseSectionKind>(PROSE_SECTION_KINDS),
  action: new Set<ProseSectionKind>([
    "description",
    "decision",
    "spec",
    "warning",
    "faq",
    "incident",
  ]),
};

export function isKnownProseSectionKind(kind: string): kind is ProseSectionKind {
  return PROSE_SECTION_KIND_SET.has(kind);
}

export function mountableProseSectionKinds(nodeType: string): ProseSectionKind[] {
  const rules = PROSE_SECTION_MOUNT_RULES[nodeType];
  return rules === undefined ? [] : [...rules];
}

export function isProseSectionKindMountable(nodeType: string, kind: string): boolean {
  const rules = PROSE_SECTION_MOUNT_RULES[nodeType];
  return rules !== undefined && isKnownProseSectionKind(kind) && rules.has(kind);
}

export function proseSectionKindMountMatrix(): Record<string, ProseSectionKind[]> {
  return Object.fromEntries(Object.entries(PROSE_SECTION_MOUNT_RULES).map(([nodeType, kinds]) => [nodeType, [...kinds]]));
}
