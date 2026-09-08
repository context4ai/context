import type { IndexerArtifactFact } from "./indexerContentLayers.js";
import type { IndexerJson } from "./indexerRegistry.js";
import { compareIndexerCanonicalText } from "./indexerProtocolCommon.js";

type RecordValue = { [key: string]: IndexerJson };
function record(value: IndexerJson | undefined): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function propsName(value: RecordValue): string | undefined {
  if (typeof value.propsType === "string" && /^[A-Za-z_$][\w$]*$/u.test(value.propsType)) return value.propsType;
  // This recognizes only a simple declared link; it does not parse or execute source.
  return typeof value.typeAnnotation === "string"
    ? /^(?:React\.)?(?:FC|FunctionComponent)\s*<\s*([A-Za-z_$][\w$]*)\s*>$/u.exec(value.typeAnnotation)?.[1]
    : undefined;
}

/** Supporting facts may inform a selected Props contract without becoming an
 * additional displayed contract. Only use already accepted same-subject facts. */
export function publicContractSupport(selected: readonly IndexerArtifactFact[], available: readonly IndexerArtifactFact[]): IndexerArtifactFact[] {
  const refs = new Set(selected.map(fact => fact.fact_ref));
  return available.filter(fact => {
    if (refs.has(fact.fact_ref)) return false;
    const value = record(fact.value);
    if (value?.kind !== "component" || value.visibility !== "exported" || !Array.isArray(value.members) || !value.members.length) return false;
    const name = propsName(value);
    if (!name) return false;
    return typeof value.file === "string" && selected.filter(target => {
      const type = record(target.value);
      return type?.name === name && type.file === value.file && type.visibility === "exported"
        && (type.kind === "type" || type.kind === "interface") && Array.isArray(type.members)
        && target.subject_key.namespace === fact.subject_key.namespace
        && target.subject_key.kind === fact.subject_key.kind
        && target.subject_key.local_key === fact.subject_key.local_key;
    }).length === 1;
  }).sort((left, right) => compareIndexerCanonicalText(left.fact_ref, right.fact_ref));
}

/** Reconcile structured parser facts at the shared rendering boundary. Never
 * change accepted facts, read source files, or infer defaults from expressions. */
export function reconcilePublicContractFacts(facts: readonly IndexerArtifactFact[]): IndexerArtifactFact[] {
  const owners = new Map<string, IndexerArtifactFact[]>();
  const types = new Map<string, IndexerArtifactFact>();
  for (const component of facts) {
    const value = record(component.value);
    if (value?.kind !== "component" || value.visibility !== "exported" || !Array.isArray(value.members) || !value.members.length) continue;
    const name = propsName(value);
    if (!name || typeof value.file !== "string") continue;
    const matches = facts.filter(fact => {
      const type = record(fact.value);
      return type?.name === name && type.file === value.file && type.visibility === "exported"
        && (type.kind === "type" || type.kind === "interface") && Array.isArray(type.members)
        && fact.subject_key.namespace === component.subject_key.namespace
        && fact.subject_key.kind === component.subject_key.kind
        && fact.subject_key.local_key === component.subject_key.local_key;
    });
    if (matches.length !== 1) continue;
    const type = matches[0]!;
    types.set(component.fact_ref, type);
    owners.set(type.fact_ref, [...(owners.get(type.fact_ref) ?? []), component]);
  }
  return facts.flatMap(fact => {
    if (owners.has(fact.fact_ref)) return [];
    const value = record(fact.value);
    const typeFact = types.get(fact.fact_ref);
    if (!value || !typeFact) return [fact];
    const type = record(typeFact.value)!;
    const implementations = new Map((value.members as IndexerJson[]).flatMap(item => {
      const member = record(item);
      return typeof member?.name === "string" ? [[member.name, member] as const] : [];
    }));
    const members = (type.members as IndexerJson[]).map(item => {
      const declaration = record(item);
      if (!declaration || typeof declaration.name !== "string") return item;
      const member = implementations.get(declaration.name);
      implementations.delete(declaration.name);
      if (!member) return item;
      const conflict = declaration.defaultValue !== undefined && member.defaultValue !== undefined
        && declaration.defaultValue !== member.defaultValue;
      // Props declares the fields and their types; partial implementation facts
      // may enrich defaults, but must not erase fields or declaration metadata.
      return { ...member, ...declaration,
        ...(member.defaultValue === undefined ? {} : { defaultValue: member.defaultValue }),
        doc: [declaration.doc || member.doc,
        conflict ? `Default for ${String(value.name)}; declaration documents ${String(declaration.defaultValue)}.` : "",
      ].filter(Boolean).join(" ") };
    });
    members.push(...implementations.values());
    const name = owners.get(typeFact.fact_ref)!.length === 1 ? String(type.name) : `${String(type.name)} (${String(value.name)})`;
    // Keep the component's export entry, but no second Props member table.
    return [{ ...fact, value: { ...value, members: [], params: [] } },
      { ...typeFact, fact_ref: fact.fact_ref, value: { ...type, name, members } }];
  });
}
